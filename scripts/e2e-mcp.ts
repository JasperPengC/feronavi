import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** MCP 只读最小集 + API 令牌自检（第六期，判据 M1–M10） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, apiToken, milestone, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "mcp-admin", LOW = "mcp-low";
const KEY = "MCPPROJ", KEY2 = "MCPOTHER";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, LOW]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [guestRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));
const [a] = await db.insert(member).values({ username: U, email: "mcp@x.test", name: "MCP 管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("mcp-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
// ⚠️ 「低可见」的正确构造是**无任何角色指派**：GUEST@ORG 属于"全组织可见"
//    （本项目既定语义，第二期已踩过同一处 —— ORG 档是数据范围，不是权限档位）
const [lo] = await db.insert(member).values({ username: LOW, email: "mcplow@x.test", name: "受限成员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("mcp-password-1234") }).returning({ id: member.id });
const lowActor = (await loadActor(lo!.id))!;
// 此时还没指派角色：权限集为空，且**无权创建令牌**（服务正确拒绝）
ok("无指派账号权限集为空", lowActor.permissions.size === 0, String(lowActor.permissions.size));
let noPermToken = false;
try { await tokenService.createToken(lowActor, { name: "x", tier: "READ_ONLY" }); } catch (e) { noPermToken = (e as { code?: string }).code === "FORBIDDEN"; }
ok("无 apikey:manage_own 的账号不能建令牌", noPermToken);

await db.delete(project).where(eq(project.key, KEY));
await db.delete(project).where(eq(project.key, KEY2));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "MCP 项目" });
const { id: pid2 } = await projectService.createProject(admin, { key: KEY2, name: "另一个项目" });
const wi = await wiService.createWorkItem(admin, pid, { type: "TASK", title: "MCP 工作项" });
await db.insert(milestone).values({ projectId: pid, name: "M1" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3994), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3994";

/** 打 MCP 端点的 JSON-RPC */
async function rpc(token: string | null, body: unknown) {
  const res = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP 响应为任意 JSON，按 fixture 断言
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON（SSE）时留原文 */ }
  return { status: res.status, json, text };
}
const call = (token: string, name: string, args: Record<string, unknown> = {}) =>
  rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

try {
  // ── M9：令牌明文只在创建时返回一次，库里只有 hash ──
  const created = await tokenService.createToken(admin, { name: "只读令牌", tier: "READ_ONLY" });
  const TOKEN = created.token;
  ok("创建令牌返回明文（fero_ 前缀）", TOKEN.startsWith("fero_"), TOKEN.slice(0, 8));
  ok("库里查不到明文", (await sql<{ n: number }[]>`select count(*)::int as n from api_token where token_hash = ${TOKEN}`)[0]!.n === 0);
  ok("列出的令牌不含 hash/明文", !JSON.stringify(created.row).includes(TOKEN));
  ok("前缀形如 fero_…xxxx", /^fero_…/.test(created.row.tokenPrefix), created.row.tokenPrefix);

  // ── M1：无令牌 / 伪造 / 吊销 → 同一形状 401 ──
  const noTok = await rpc(null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const badTok = await rpc("fero_definitely-not-a-real-token", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  ok("无令牌 → 401", noTok.status === 401, String(noTok.status));
  ok("伪造令牌 → 401 且形状相同",
    badTok.status === 401 && JSON.stringify(badTok.json) === JSON.stringify(noTok.json),
    JSON.stringify(badTok.json));

  // ── M5：initialize + tools/list ──
  const init = await rpc(TOKEN, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  ok("initialize 成功", init.status === 200 && init.json?.result?.serverInfo?.name === "feronavi", JSON.stringify(init.json?.result?.serverInfo));
  const list = await rpc(TOKEN, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (list.json?.result?.tools ?? []) as { name: string; inputSchema: unknown }[];
  // 当前协议清单：读 24 + 写 30，含协作、SLA、审批、自动化和通知工具。
  ok("tools/list 返回 54 个工具", tools.length === 54, `${tools.length}: ${tools.map((t) => t.name).join(",")}`);
  ok("写工具出现在清单里", tools.some((t) => t.name === "workitem.create") && tools.some((t) => t.name === "page.update"));
  ok("每个工具都带 inputSchema", tools.every((t) => t.inputSchema && (t.inputSchema as { type?: string }).type === "object"));
  for (const n of ["ping", "whoami", "meta.workflow", "meta.fields", "project.members", "plan.getMilestone"]) {
    ok(`含工具 ${n}`, tools.some((t) => t.name === n));
  }

  // ── M6：逐个工具调用返回真实数据 ──
  const pick = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(TOKEN, name, args);
    const txt = r.json?.result?.content?.[0]?.text ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP 响应为任意 JSON，按 fixture 断言
    let data: any = null; try { data = JSON.parse(txt); } catch { /* 保留原文 */ }
    return { isError: r.json?.result?.isError === true, data, txt, raw: r.json };
  };
  const ping = await pick("ping");
  ok("ping", ping.data?.ok === true);
  const me = await pick("whoami");
  ok("whoami 返回档位与可见项目", me.data?.tokenTier === "READ_ONLY" && me.data?.visibleProjects?.length >= 2, JSON.stringify(me.data?.tokenTier));
  const pl = await pick("project.list");
  ok("project.list 有项目", (pl.data?.items ?? []).length >= 2, String((pl.data?.items ?? []).length));
  const pg = await pick("project.get", { projectId: pid });
  ok("project.get 返回该项目", pg.data?.key === KEY || pg.data?.project?.key === KEY, JSON.stringify(pg.data).slice(0, 80));
  const pm = await pick("project.members", { projectId: pid });
  ok("project.members 返回成员", Array.isArray(pm.data?.members), JSON.stringify(pm.data).slice(0, 60));
  const wl = await pick("workitem.list", { projectId: pid });
  ok("workitem.list 返回工作项", (wl.data?.items ?? []).some((i: { id?: string }) => i.id === wi.id), JSON.stringify(wl.data?.total));
  const wg = await pick("workitem.get", { workItemId: wi.id });
  ok("workitem.get 含可用流转", wg.data?.workItem?.id === wi.id && Array.isArray(wg.data?.allowedTransitions), JSON.stringify(wg.data?.allowedTransitions)?.slice(0, 60));
  const wc = await pick("workitem.comments", { workItemId: wi.id });
  ok("workitem.comments", Array.isArray(wc.data?.comments));
  const ms = await pick("plan.listMilestones", { projectId: pid });
  ok("plan.listMilestones", (ms.data?.milestones ?? []).length === 1, String((ms.data?.milestones ?? []).length));
  const msg = await pick("plan.getMilestone", { milestoneId: ms.data.milestones[0].id });
  ok("plan.getMilestone 含其下工作项字段", msg.data?.milestone?.name === "M1" && Array.isArray(msg.data?.workItems));
  ok("plan.listIterations", Array.isArray((await pick("plan.listIterations", { projectId: pid })).data?.iterations));
  ok("plan.listReleases", Array.isArray((await pick("plan.listReleases", { projectId: pid })).data?.releases));
  const nt = await pick("notification.list");
  ok("notification.list 含 unreadCount", typeof nt.data?.unreadCount === "number");
  const ac = await pick("activity.project", { projectId: pid });
  ok("activity.project", typeof ac.data?.total === "number", JSON.stringify(ac.data?.total));
  const mw = await pick("meta.workflow", { projectId: pid });
  ok("meta.workflow 返回状态与迁移边", (mw.data?.workflows ?? []).length === 3 && Array.isArray(mw.data.workflows[0].states),
    JSON.stringify((mw.data?.workflows ?? []).map((w: { appliesToType?: string }) => w.appliesToType)));
  const mf = await pick("meta.fields");
  ok("meta.fields 返回字段定义", (mf.data?.fields ?? []).length >= 10, String((mf.data?.fields ?? []).length));

  // 写工具已开放：READ_ONLY 档调用 → 被**档位守卫**拒绝（FORBIDDEN，而非"工具不存在"）
  const write = await call(TOKEN, "workitem.create", { projectId: pid, type: "TASK", title: "x" });
  ok("READ_ONLY 档调用写工具 → isError + FORBIDDEN（档位是上限）",
    write.json?.result?.isError === true && JSON.parse(write.json.result.content[0].text).code === "FORBIDDEN",
    write.text.slice(0, 80));
  // 假装存在的工具名仍然明确拒绝
  const ghost = await call(TOKEN, "workitem.deleteForever", {});
  ok("不存在的工具名 → isError + NOT_FOUND",
    ghost.json?.result?.isError === true && JSON.parse(ghost.json.result.content[0].text).code === "NOT_FOUND",
    ghost.text.slice(0, 70));

  // ── M7：错误信封与 REST 同形状 ──
  const badArg = await pick("workitem.list", { projectId: "00000000-0000-0000-0000-000000000000" });
  ok("错误信封含 code/message/details",
    badArg.isError && typeof badArg.data?.code === "string" && "details" in (badArg.data ?? {}),
    JSON.stringify(badArg.data));

  // ── M8：last_used_at 被更新 ──
  const used = await sql<{ last_used_at: Date | null }[]>`select last_used_at from api_token where id = ${created.row.id}`;
  ok("last_used_at 已写入", used[0]!.last_used_at !== null, String(used[0]!.last_used_at));

  // ── M2：项目白名单 ──
  const scoped = await tokenService.createToken(admin, { name: "限定项目", tier: "READ_ONLY", projectWhitelist: [pid] });
  const inScope = await call(scoped.token, "workitem.list", { projectId: pid });
  ok("白名单内项目可读", inScope.json?.result?.isError !== true);
  const outScope = await call(scoped.token, "workitem.list", { projectId: pid2 });
  const outScopedData = JSON.parse(outScope.json?.result?.content?.[0]?.text ?? "{}");
  ok("白名单外项目 → NOT_FOUND（与不存在同形）", outScope.json?.result?.isError === true && outScopedData.code === "NOT_FOUND",
    JSON.stringify(outScopedData).slice(0, 80));
  const whoScoped = await call(scoped.token, "whoami");
  const whoScopedData = JSON.parse(whoScoped.json?.result?.content?.[0]?.text ?? "{}");
  ok("whoami 的可见项目按白名单收窄", (whoScopedData.visibleProjects ?? []).length === 1, String((whoScopedData.visibleProjects ?? []).length));
  const listScoped = await call(scoped.token, "project.list");
  const listScopedData = JSON.parse(listScoped.json?.result?.content?.[0]?.text ?? "{}");
  ok("project.list 也按白名单过滤", (listScopedData.items ?? []).length === 1, String((listScopedData.items ?? []).length));

  // ── M3：档位是**上限**不是授权 —— ADMIN 档不得绕过账号权限（规范 4.9 明文）──
  // ⚠️ 测试期间发现的产品边界：只有 PROJECT 档授权的账号**无法创建个人令牌**
  //    （scopeCovers 无法用项目档覆盖「无项目」的令牌资源）。这是权限引擎的语义边界，
  //    已记入 Spec 的已知边界，不在本期修。
  await db.insert(roleAssignment).values({ memberId: lo!.id, roleId: guestRole!.id, scopeType: "ORG", scopeId: null });
  const lowActor2 = (await loadActor(lo!.id))!;
  const lowTok = await tokenService.createToken(lowActor2, { name: "受限令牌", tier: "ADMIN" });
  const lowWho = await call(lowTok.token, "whoami");
  const lowData = JSON.parse(lowWho.json?.result?.content?.[0]?.text ?? "{}");
  ok("ADMIN 档令牌：档位自报为 ADMIN", lowData.tokenTier === "ADMIN", String(lowData.tokenTier));
  ok("ADMIN 档**不绕过**账号权限：权限集与账号完全一致",
    JSON.stringify(lowData.permissions) === JSON.stringify([...lowActor2.permissions].sort()),
    `${(lowData.permissions ?? []).length} vs ${lowActor2.permissions.size}`);
  ok("受限账号权限集小于管理员", lowActor2.permissions.size < admin.permissions.size,
    `${lowActor2.permissions.size} < ${admin.permissions.size}`);
  ok("受限账号令牌不含删除类权限", !(lowData.permissions ?? []).includes("work_item:delete"));

  // ── M1b：过期令牌 ──
  const expired = await tokenService.createToken(admin, { name: "过期", tier: "READ_ONLY", expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const expRes = await rpc(expired.token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  ok("过期令牌 → 401", expRes.status === 401, String(expRes.status));

  // ── M4：吊销立即生效 ──
  const rev = await tokenService.createToken(admin, { name: "待吊销", tier: "READ_ONLY" });
  ok("吊销前可用", (await rpc(rev.token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status === 200);
  await tokenService.revokeToken(admin, rev.row.id);
  ok("吊销后立即 401", (await rpc(rev.token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status === 401);

  // ── IP 白名单 ──
  ok("IP 规则：空数组不限制", tokenService.ipAllowed("1.2.3.4", []) === true);
  ok("IP 规则：CIDR 命中", tokenService.ipAllowed("10.1.2.3", ["10.0.0.0/8"]) === true);
  ok("IP 规则：CIDR 不命中", tokenService.ipAllowed("11.1.2.3", ["10.0.0.0/8"]) === false);

  // ── M10：stdio 形态 ──
  const stdioToken = (await tokenService.createToken(admin, { name: "stdio", tier: "READ_ONLY" })).token;
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "src/server/cli/mcp-stdio.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, FERONAVI_TOKEN: stdioToken },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => { child.kill(); resolve(buf); }, 12_000);
    child.stdout.on("data", (d) => { buf += String(d); if (buf.includes("tools") && buf.includes("ping")) { clearTimeout(timer); child.kill(); resolve(buf); } });
    child.stderr.on("data", () => { /* 协议流之外的日志 */ });
    child.on("error", reject);
    // stdio 模式：initialize → initialized 通知 → tools/list
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) + "\n");
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    }, 1200);
  });
  ok("stdio 形态返回 tools/list", out.includes("tools") && out.includes("whoami"), out.slice(0, 90));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`);
} finally {
  await app.close();
  await db.delete(apiToken);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(milestone);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(workItem).where(eq(workItem.projectId, pid2));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(project).where(eq(project.key, KEY2));
  for (const u of [U, LOW]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
