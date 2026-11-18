import "./_env.ts";   // 环境预设必须最先加载
/**
 * 集成同步自检（Round 25 长任务第 38 项）：外部提交 → dev_activity_daily + sync_cursor。
 * 用注入 fetch 模拟 GitHub/GitLab 响应（生产路径仍过 SSRF 校验与信封加密令牌）。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
import { startLocalHttpResponder } from "../tests/support/local-outbound.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, devActivityDaily, integration, member, project, role, roleAssignment, syncCursor } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as integrationService from "../src/server/services/integration.service.ts";
import { syncIntegration, getSyncCursor } from "../src/server/services/integration-sync.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "isync-admin";
const DEV = "isync-dev";
const GUEST = "isync-guest";
const PW = "isync-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, DEV, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "同步管理员", ar!.id);
const devId = await mk(DEV, "同步开发者", mr!.id);
await mk(GUEST, "同步成员", mr!.id);
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `ISY${SUFFIX}`, name: "同步项目" } as never);

const gh = await integrationService.createIntegration(admin, {
  kind: "GITHUB", name: "GitHub 同步", baseUrl: "https://1.1.1.1", token: "ghp_sync_token",
  config: { repo: "acme/app", userMap: { alice: DEV, bob: "nobody" } },
});
const gl = await integrationService.createIntegration(admin, {
  kind: "GITLAB", name: "GitLab 同步", baseUrl: "https://1.1.1.1", token: "glpat_sync", projectId: proj.id,
  config: { repo: "group/app", userMap: { carol: DEV } },
});
const noCfg = await integrationService.createIntegration(admin, {
  kind: "GITEE", name: "未配置同步", baseUrl: "https://1.1.1.1", token: "gitee_sync",
});

const ghCommits = [
  { sha: "a1", author: { login: "alice" }, commit: { author: { name: "Alice", date: "2026-10-20T10:00:00Z" } } },
  { sha: "a2", author: { login: "alice" }, commit: { author: { name: "Alice", date: "2026-10-21T09:00:00Z" } } },
  { sha: "b1", author: { login: "bob" }, commit: { author: { name: "Bob", date: "2026-10-21T11:00:00Z" } } },
];
const seenUrls: string[] = [];
const fakeGh = (async (url: string | URL | Request, _init?: RequestInit) => {
  const u = String(url);
  seenUrls.push(u);
  if (u.includes("/repos/acme/app/commits")) {
    const hasSince = /[?&]since=/.test(u);
    return new Response(JSON.stringify(hasSince ? [] : ghCommits), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (/\/repos\/acme\/app\/pulls\/\d+\/reviews/.test(u)) {
    return new Response(JSON.stringify([
      { user: { login: "alice" }, submitted_at: "2026-10-21T12:00:00Z", state: "APPROVED" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("/repos/acme/app/pulls")) {
    return new Response(JSON.stringify([
      { number: 1, user: { login: "alice" }, created_at: "2026-10-20T12:00:00Z" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;
const fakeGl = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  seenUrls.push(u);
  if (u.includes("/api/v4/projects/group%2Fapp/repository/commits")) {
    ok("GitLab 使用 PRIVATE-TOKEN 头", (init?.headers as Record<string, string> | undefined)?.["private-token"] === "glpat_sync");
    return new Response(JSON.stringify([
      { id: "c1", author_name: "carol", committed_date: "2026-10-22T08:00:00Z" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("/api/v4/projects/group%2Fapp/merge_requests")) {
    return new Response(JSON.stringify([
      { iid: 1, author: { username: "carol" }, created_at: "2026-10-22T09:00:00Z" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

const app = await buildApp({ logger: false });
const ghTransport = await startLocalHttpResponder("https://1.1.1.1", fakeGh);
const glTransport = await startLocalHttpResponder("https://1.1.1.1", fakeGl);
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return {
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(csrfToken),
  };
};
try {
  // ① GitHub：首次同步 3 条 → 2 条映射成功 + 1 条跳过
  const r1 = await syncIntegration(admin, gh.id, { fetchImpl: ghTransport.fetchImpl });
  ok("首次同步统计正确（提交3/写入2/跳过1/1人）",
    r1.fetched === 3 && r1.synced === 2 && r1.skipped === 1 && r1.members === 1, JSON.stringify(r1));
  ok("PR 同步统计正确（拉取1/写入1）", r1.pulls.fetched === 1 && r1.pulls.synced === 1, JSON.stringify(r1.pulls));
  ok("GitHub 评审同步统计正确（拉取1/写入1）", r1.reviews.fetched === 1 && r1.reviews.synced === 1, JSON.stringify(r1.reviews));
  ok("首次请求不带 since", !seenUrls[0]!.includes("since="), seenUrls[0]);
  const rows = await db.select().from(devActivityDaily).where(eq(devActivityDaily.memberId, devId));
  ok("dev_activity_daily 写入两天各 1 次提交",
    rows.length === 2 && rows.every((x) => x.commits === 1) && rows.map((x) => x.date).sort().join(",") === "2026-10-20,2026-10-21",
    JSON.stringify(rows));
  ok("dev_activity_daily 记录 PR 数（10-20 一条）", rows.find((x) => x.date === "2026-10-20")?.prs === 1
    && rows.find((x) => x.date === "2026-10-21")?.prs === 0, JSON.stringify(rows.map((x) => ({ d: x.date, prs: x.prs }))));
  ok("dev_activity_daily 记录评审数（10-21 一条）", rows.find((x) => x.date === "2026-10-21")?.reviews === 1
    && rows.find((x) => x.date === "2026-10-20")?.reviews === 0, JSON.stringify(rows.map((x) => ({ d: x.date, rev: x.reviews }))));
  const reviewsCursor = (await db.select().from(syncCursor).where(eq(syncCursor.integrationId, gh.id))).find((c) => c.entity === "reviews");
  ok("reviews 游标单独记录", reviewsCursor?.cursor === "2026-10-21T12:00:00.000Z", JSON.stringify(reviewsCursor));
  const pullsCursor = (await db.select().from(syncCursor).where(eq(syncCursor.integrationId, gh.id))).find((c) => c.entity === "pulls");
  ok("pulls 游标单独记录", pullsCursor?.cursor === "2026-10-20T12:00:00.000Z", JSON.stringify(pullsCursor));
  const cursor = await getSyncCursor(admin, gh.id);
  ok("sync_cursor 记录最新提交时间", cursor?.entity === "commits" && cursor?.cursor === "2026-10-21T11:00:00.000Z", JSON.stringify(cursor));

  // ② 重复同步：带 since，空结果 → 不重复计数
  const r2 = await syncIntegration(admin, gh.id, { fetchImpl: ghTransport.fetchImpl });
  ok("第二次同步带 since 且零新增", seenUrls.some((u) => u.includes("since=2026-10-21")) && r2.fetched === 0 && r2.synced === 0, JSON.stringify(r2));
  ok("第二次同步 PR 也按游标本地过滤为零", r2.pulls.fetched === 0 && r2.pulls.synced === 0, JSON.stringify(r2.pulls));
  ok("第二次同步评审按游标归零", r2.reviews.fetched === 0 && r2.reviews.synced === 0, JSON.stringify(r2.reviews));
  const rows2 = await db.select().from(devActivityDaily).where(eq(devActivityDaily.memberId, devId));
  ok("活跃度未被重复累加", rows2.length === 2 && rows2.every((x) => x.commits === 1), JSON.stringify(rows2));

  // ③ GitLab 项目集成：写项目活动
  const r3 = await syncIntegration(admin, gl.id, { fetchImpl: glTransport.fetchImpl });
  ok("GitLab 同步提交 1 条 + MR 1 条，且评审按边界为 0", r3.fetched === 1 && r3.synced === 1 && r3.pulls.fetched === 1 && r3.pulls.synced === 1
    && r3.reviews.fetched === 0, JSON.stringify(r3));
  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, proj.id));
  ok("项目活动记录同步事件（含数量）", acts.some((x) => x.action === "integration.synced" && x.summary.includes("1 条提交")), JSON.stringify(acts.map((x) => x.summary)));

  // ④ HTTP 端点与权限
  const H = { ...(await login(ADMIN)), "content-type": "application/json" };
  ok("HTTP 同步缺少 config.repo → 400", (await fetch(`${BASE}/api/v1/integrations/${noCfg.id}/sync`, { method: "POST", headers: H })).status === 400);
  ok("GET 游标端点可读", (await fetch(`${BASE}/api/v1/integrations/${gh.id}/cursor`, { headers: { cookie: H.cookie } })).status === 200);
  const guest = await login(GUEST);
  const G = { cookie: guest.cookie, "x-csrf-token": guest["x-csrf-token"] };
  const guestSync = await fetch(`${BASE}/api/v1/integrations/${gh.id}/sync`, { method: "POST", headers: G });
  ok("无 integration:manage 同步 → 403", guestSync.status === 403, `${guestSync.status} ${await guestSync.clone().text()}`);

  // ⑤ 审计
  const audits = (await db.select().from(auditEntry)).filter((a) => a.action === "integration.synced");
  ok("每次同步写 SECURITY 审计", audits.length === 3 && audits.every((a) => a.severity === "SECURITY"), String(audits.length));
} finally {
  ok("仓库同步经过本地真实 HTTP 接收端", ghTransport.requests > 0 && glTransport.requests > 0);
  await ghTransport.close(); await glTransport.close();
  await app.close();
  await db.delete(devActivityDaily).where(eq(devActivityDaily.memberId, devId));
  await db.delete(syncCursor);
  await db.delete(integration);
  await db.delete(activityEntry);
  await db.delete(auditEntry);
  await db.delete(project).where(eq(project.id, proj.id));
  for (const u of [ADMIN, DEV, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
