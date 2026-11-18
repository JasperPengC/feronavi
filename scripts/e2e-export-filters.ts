import "./_env.ts";   // 环境预设必须最先加载
/** 全量筛选导出（Round 80）：项目/全局 CSV 过滤、行数头、权限、格式 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, project, role, roleAssignment, workItem, workflowState } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "ex-admin";
const GUEST = "ex-guest";
const PW = "ex-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
const csvRows = (text: string): string[][] => text.replace(/^\uFEFF/, "").trim().split("\r\n").map((line) => {
  const out: string[] = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
});
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "导出管理员", ar!.id);
// 无任何角色/项目关系 → 不可见任何项目（验证导出权限边界）
const [guestRow] = await db.insert(member).values({ username: GUEST, email: `${GUEST}@x.test`, name: "导出成员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
void guestRow; void mr;
const admin = (await loadActor(adminId))!;
const p1 = await projectService.createProject(admin, { key: `EX${SUFFIX}A`, name: "筛选导出项目一" } as never);
const p2 = await projectService.createProject(admin, { key: `EX${SUFFIX}B`, name: "筛选导出项目二" } as never);
const d1 = await wiService.createWorkItem(admin, p1.id, { type: "DEFECT", title: `登录崩溃${SUFFIX}`, severity: "S1", priority: "URGENT" } as never);
await wiService.createWorkItem(admin, p1.id, { type: "DEFECT", title: `列表分页${SUFFIX}`, severity: "S2", priority: "HIGH" } as never);
const d3 = await wiService.createWorkItem(admin, p1.id, { type: "DEFECT", title: `已修复问题${SUFFIX}`, severity: "S1" } as never);
await wiService.createWorkItem(admin, p2.id, { type: "DEFECT", title: `另一个项目缺陷${SUFFIX}`, severity: "S3" } as never);
for (let i = 0; i < 6; i++) {
  const wi = await wiService.getWorkItem(admin, d3.id);
  const allowed = await wiService.allowedTransitions(admin, wi as never);
  const target = allowed.find((t) => t.toCategory === "DONE" || t.toCategory === "TERMINAL") ?? allowed[0];
  if (!target) break;
  await wiService.transitionWorkItem(admin, d3.id, { toStateKey: target.toStateKey, version: (wi as { version: number }).version } as never);
  const [state] = await db.select({ category: workflowState.category }).from(workflowState).where(eq(workflowState.id, (await wiService.getWorkItem(admin, d3.id) as { statusId: string }).statusId));
  if (state && ["DONE", "TERMINAL"].includes(state.category)) break;
}

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken) };
};
try {
  const H = await login(ADMIN);
  const G = await login(GUEST);
  const projectAll = await fetch(`${BASE}/api/v1/projects/${p1.id}/work-items/export?type=DEFECT`, { headers: { cookie: H.cookie } });
  const bytes = new Uint8Array(await projectAll.clone().arrayBuffer());
  const allCsv = await projectAll.text();
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  ok("项目导出带 BOM/CRLF 与 x-row-count", projectAll.status === 200 && hasBom && bytes.includes(0x0d) && bytes.includes(0x0a)
    && projectAll.headers.get("x-row-count") === "3", `${projectAll.status} ${projectAll.headers.get("x-row-count")} bom=${hasBom}`);
  ok("项目导出包含 3 个缺陷", csvRows(allCsv).length === 4, String(csvRows(allCsv).length));

  const s1 = await fetch(`${BASE}/api/v1/projects/${p1.id}/work-items/export?type=DEFECT&severity=S1`, { headers: { cookie: H.cookie } });
  const s1Csv = await s1.text();
  ok("项目导出 severity=S1 只含 2 行", s1.headers.get("x-row-count") === "2" && csvRows(s1Csv).length === 3, `${s1.headers.get("x-row-count")} ${csvRows(s1Csv).length}`);
  const open = await fetch(`${BASE}/api/v1/projects/${p1.id}/work-items/export?type=DEFECT&statusCategory=OPEN`, { headers: { cookie: H.cookie } });
  ok("项目导出 statusCategory=OPEN 只含未关闭 2 行", open.headers.get("x-row-count") === "2", String(open.headers.get("x-row-count")));
  const q = await fetch(`${BASE}/api/v1/projects/${p1.id}/work-items/export?type=DEFECT&q=${encodeURIComponent("分页")}`, { headers: { cookie: H.cookie } });
  ok("项目导出关键字命中 1 行", q.headers.get("x-row-count") === "1" && q.url.includes(encodeURIComponent("分页")), String(q.headers.get("x-row-count")));

  const global = await fetch(`${BASE}/api/v1/issues/export`, { headers: { cookie: H.cookie } });
  const globalCsv = await global.text();
  const globalCount = Number(global.headers.get("x-row-count"));
  ok("全局导出含两项目缺陷（≥4 行）", global.status === 200 && globalCount >= 4 && globalCsv.includes("EX" + SUFFIX + "A") && globalCsv.includes("EX" + SUFFIX + "B"), `${global.status} ${globalCount}`);
  const globalS1 = await fetch(`${BASE}/api/v1/issues/export?severity=S1`, { headers: { cookie: H.cookie } });
  ok("全局导出 severity=S1 行数 >=2 且少于全量", Number(globalS1.headers.get("x-row-count")) >= 2 && Number(globalS1.headers.get("x-row-count")) < globalCount, `${globalS1.headers.get("x-row-count")}/${globalCount}`);
  const globalProject = await fetch(`${BASE}/api/v1/issues/export?projectId=${p2.id}`, { headers: { cookie: H.cookie } });
  ok("全局导出按项目过滤 1 行", globalProject.headers.get("x-row-count") === "1", String(globalProject.headers.get("x-row-count")));
  ok("不可见成员导出项目一 → 403", (await fetch(`${BASE}/api/v1/projects/${p1.id}/work-items/export?type=DEFECT`, { headers: { cookie: G.cookie } })).status === 403);
  ok("不可见成员全局导出为空（仅自己可见）", Number((await fetch(`${BASE}/api/v1/issues/export`, { headers: { cookie: G.cookie } })).headers.get("x-row-count")) === 0);
  void d1;
} finally {
  await app.close();
  for (const p of [p1, p2]) {
    await db.delete(workItem).where(eq(workItem.projectId, p.id));
    await db.delete(project).where(eq(project.id, p.id));
  }
  await db.delete(auditEntry); await db.delete(activityEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
