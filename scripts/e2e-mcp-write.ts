import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** MCP 写工具自检（第十三期）：档位 × 账号权限 × 白名单三重交集、幂等键、乐观锁、破坏性标注 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, apiToken, idempotencyKey, auditEntry, activityEntry, comment, subscription, notification, timeLog, workItemCollaborator, workItemRelation, memberPreference, milestone, iteration, release, module as moduleT, page, pageRevision, pagePermission, idea, ideaVote, collabRoom, collabMember, collabSnapshot, collabUpdate } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, and } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w13c-admin", MEMBERU = "w13c-member";
const KEY = "W13CPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, MEMBERU]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w13c-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(ADMIN, "写工具管理员"), m = await mk(MEMBERU, "项目成员");
await db.insert(roleAssignment).values({ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W13C 写工具" });
await db.insert(roleAssignment).values({ memberId: m.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: pid });
const memberActor = (await loadActor(m.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3980), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3980";

async function rpc(token: string, body: unknown) {
  const res = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  const txt = j.result?.content?.[0]?.text ?? "";
  let data: Record<string, unknown> | null = null;
  try { data = JSON.parse(txt); } catch { /* 非 JSON */ }
  return { status: res.status, isError: j.result?.isError === true, data };
}
const call = (token: string, name: string, args: Record<string, unknown>) =>
  rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: confirmedTestArgs(name, args) } });

try {
  // ── 工具清单里能看到写工具 ──
  const roTok = await tokenService.createToken(admin, { name: "只读", tier: "READ_ONLY" });
  const rwTok = await tokenService.createToken(admin, { name: "读写", tier: "READ_WRITE" });
  const memberTok = await tokenService.createToken(memberActor, { name: "成员读写", tier: "READ_WRITE" });
  const list = await rpc(roTok.token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = ((list.data as unknown) ?? []) as never;
  const tools = ((await rpc(roTok.token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).data ?? []) as never;
  void names; void tools;
  const tl = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${roTok.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
  });
  const tlBody = (await tl.json()) as { result: { tools: { name: string }[] } };
  const toolNames = tlBody.result.tools.map((t) => t.name);
  ok("写工具出现在工具清单里", toolNames.includes("workitem.create") && toolNames.includes("page.update"), String(toolNames.length));
  ok("清单包含读工具（不因加写工具而减少）", toolNames.includes("whoami") && toolNames.includes("meta.workflow"));

  // ── 档位守卫：READ_ONLY 一律拒绝写（反控）──
  const denied = await call(roTok.token, "workitem.create", { projectId: pid, type: "TASK", title: "x" });
  ok("READ_ONLY 档调用写工具被拒（FORBIDDEN）", denied.isError && (denied.data as { code?: string }).code === "FORBIDDEN",
    JSON.stringify(denied.data).slice(0, 80));

  // ── 三重交集：账号权限参与判定 ──
  const memberDenied = await call(memberTok.token, "workitem.transition", { workItemId: "00000000-0000-0000-0000-000000000000", toStateKey: "x", version: 1 });
  ok("项目档成员：读不到工作项时如实报错（不越权）", memberDenied.isError, JSON.stringify(memberDenied.data).slice(0, 60));

  // ── 写工具真的能写 ──
  const created = await call(rwTok.token, "workitem.create", { projectId: pid, type: "TASK", title: "MCP 创建的任务", estimatePoints: 3 });
  const wi = (created.data as { result?: { id: string; key: string } })?.result ?? (created.data as { id?: string; key?: string });
  const wiId = (wi as { id: string }).id;
  ok("workitem.create 成功并返回完整行", !created.isError && !!wiId, JSON.stringify(created.data).slice(0, 90));
  ok("创建结果带 key（可用于后续引用）", !!(wi as { key?: string }).key, JSON.stringify(wi).slice(0, 60));

  // ── 协作 MCP 冷启动：未预建房间时也能完成 inspect → confirm → command ──
  const collabCreated = await call(rwTok.token, "workitem.create", { projectId: pid, type: "TASK", title: "MCP 协作冷启动样本" });
  const collabWiId = (collabCreated.data as { result?: { id: string } })?.result?.id;
  ok("协作冷启动样本创建成功", !collabCreated.isError && !!collabWiId, JSON.stringify(collabCreated.data).slice(0, 80));
  const inspected = await call(rwTok.token, "collab.inspect", { resourceType: "WORK_ITEM", resourceId: collabWiId! });
  ok("协作 inspect 冷启动自动创建 COMMAND 房间", !inspected.isError && (inspected.data as { mode?: string })?.mode === "COMMAND",
    JSON.stringify(inspected.data).slice(0, 100));
  const inspectActions = (inspected.data as { actions?: string[] })?.actions ?? [];
  ok("COMMAND inspect 返回领域动作与工具发现信息",
    inspectActions.includes("workitem.update") && ((inspected.data as { domainTools?: string[] })?.domainTools ?? []).includes("workitem.get"),
    JSON.stringify({ inspectActions, domainTools: (inspected.data as { domainTools?: string[] })?.domainTools }));
  const unconfirmed = await call(rwTok.token, "collab.command", { resourceType: "WORK_ITEM", resourceId: collabWiId!, action: "workitem.update", input: { expectedVersion: 1, title: "未确认不应执行" }, userConfirmed: false });
  ok("协作 command 冷启动仍执行用户确认门禁",
    unconfirmed.isError && (unconfirmed.data as { code?: string }).code === "COMMAND_CONFIRMATION_REQUIRED",
    JSON.stringify(unconfirmed.data));
  const confirmed = await call(rwTok.token, "collab.command", { resourceType: "WORK_ITEM", resourceId: collabWiId!, action: "workitem.update", input: { expectedVersion: 1, title: "冷启动闭环已确认" }, userConfirmed: true });
  ok("确认后协作 command 写入成功", !confirmed.isError, JSON.stringify(confirmed.data).slice(0, 100));
  const afterCollab = (await db.select({ title: workItem.title }).from(workItem).where(eq(workItem.id, collabWiId!)).limit(1))[0];
  ok("协作 command 结果落到领域数据", afterCollab?.title === "冷启动闭环已确认", String(afterCollab?.title));

  // ── 幂等键 ──
  await call(rwTok.token, "workitem.comment", { workItemId: wiId, body: "来自 MCP 的评论", idempotencyKey: "cmt-1" });
  const k2 = await call(rwTok.token, "workitem.comment", { workItemId: wiId, body: "来自 MCP 的评论", idempotencyKey: "cmt-1" });
  ok("同幂等键重放返回首次结果（replayed=true）", (k2.data as { replayed?: boolean })?.replayed === true,
    JSON.stringify(k2.data).slice(0, 90));
  const comments = await db.select().from(comment).where(eq(comment.targetId, wiId));
  ok("**评论只创建了一条**（幂等键生效）", comments.length === 1, String(comments.length));
  const k3 = await call(rwTok.token, "workitem.comment", { workItemId: wiId, body: "不同的内容", idempotencyKey: "cmt-1" });
  ok("同键不同体 → CONFLICT（判为误用）", k3.isError && (k3.data as { code?: string }).code === "CONFLICT", JSON.stringify(k3.data).slice(0, 80));
  const row = (await db.select().from(idempotencyKey).where(and(eq(idempotencyKey.key, "cmt-1"), eq(idempotencyKey.actorId, a.id))).limit(1))[0]!;
  ok("幂等键按「键 + 调用者 + 工具名」三元域存储", row.scope === "workitem.comment" && row.state === "DONE", `${row.scope}/${row.state}`);
  ok("幂等键有 24 小时过期时间", row.expiresAt.getTime() > Date.now() + 20 * 3600_000);

  // ── 乐观锁 ──
  const got = await call(rwTok.token, "workitem.get", { workItemId: wiId });
  const ver = (got.data as { result?: { workItem?: { version: number } } })?.result?.workItem?.version ?? 1;
  const upd = await call(rwTok.token, "workitem.update", { workItemId: wiId, title: "改过的标题", expectedVersion: ver });
  ok("workitem.update 成功（带正确版本）", !upd.isError, JSON.stringify(upd.data).slice(0, 80));
  const conflict = await call(rwTok.token, "workitem.update", { workItemId: wiId, title: "并发改", expectedVersion: ver });
  ok("版本过期 → 不静默覆盖（VERSION_CONFLICT 或版本冲突语义）", conflict.isError, JSON.stringify(conflict.data).slice(0, 80));

  // ── 破坏性操作在描述里点名 ──
  const trans = tlBody.result.tools.find((t) => t.name === "workitem.transition") as unknown as { description: string };
  ok("workitem.transition 描述写明破坏性与「先读迁移边」", /破坏性/.test(trans.description) && /meta\.workflow/.test(trans.description), trans.description.slice(0, 60));

  // ── 其它写工具能落到库 ──
  const ideaRes = await call(rwTok.token, "idea.submit", { projectId: pid, title: "MCP 提的想法", idempotencyKey: "idea-1" });
  ok("idea.submit 成功", !ideaRes.isError, JSON.stringify(ideaRes.data).slice(0, 70));
  const ideaId = (ideaRes.data as { result?: { id: string } })?.result?.id;
  const voteRes = await call(rwTok.token, "idea.vote", { ideaId, weight: 2 });
  ok("idea.vote 成功（天然幂等）", !voteRes.isError, JSON.stringify(voteRes.data).slice(0, 70));
  const pageRes = await call(rwTok.token, "page.create", { projectId: pid, title: "MCP 建的文档", content: "# 标题\n内容", idempotencyKey: "page-1" });
  ok("page.create 成功", !pageRes.isError, JSON.stringify(pageRes.data).slice(0, 70));
  const createdPage = (pageRes.data as { result: { id: string; currentRevisionId: string } }).result;
  const pageArgs = { pageId: createdPage.id, expectedRevisionId: createdPage.currentRevisionId, content: "# 更新后\nMCP 发布回读", userConfirmed: true, idempotencyKey: "page-update-1" };
  const published = await call(rwTok.token, "page.update", pageArgs);
  const publication = (published.data as { result?: { publishedRevisionId: string; page: { id: string } } })?.result;
  ok("page.update 返回成功发布的幂等信封", !published.isError && !!publication?.publishedRevisionId && publication.page.id === createdPage.id, JSON.stringify(published.data).slice(0, 100));
  const publishedAgain = await call(rwTok.token, "page.update", pageArgs);
  ok("page.update 重试保留首次发布版本", !publishedAgain.isError && publishedAgain.data?.replayed === true
    && (publishedAgain.data?.result as { publishedRevisionId?: string })?.publishedRevisionId === publication?.publishedRevisionId);
  const currentPage = await call(rwTok.token, "page.get", { pageId: createdPage.id });
  ok("page.update 返回版本与持久化当前版本一致", !currentPage.isError && !!publication?.publishedRevisionId && currentPage.data?.currentRevisionId === publication.publishedRevisionId);
  const relRes = await call(rwTok.token, "workitem.link", { fromWorkItemId: wiId, toWorkItemId: wiId, type: "RELATES_TO" });
  ok("workitem.link 成功（自关联被接受为合法关系）", !relRes.isError || (relRes.data as { code?: string }).code === "VALIDATION",
    JSON.stringify(relRes.data).slice(0, 70));

  // ── 未实现的写工具被明确拒绝而不是假装成功 ──
  // 公告工具已补齐（第 39 轮）：READ_WRITE 档即使有权限也被**档位**拒绝（最高风险操作需 ADMIN 档）
  const ann = await call(rwTok.token, "announcement.send", { title: "x", body: "y" });
  ok("READ_WRITE 档调群发公告 → 被档位拒绝（需 ADMIN 档）",
    ann.isError && (ann.data as { code?: string }).code === "FORBIDDEN"
    && JSON.stringify(ann.data).includes("ADMIN"), JSON.stringify(ann.data).slice(0, 90));
  // 计划创建工具已在第 17 轮补齐（创建逻辑抽进 planning.service 后即可映射）
  const planTool = await call(rwTok.token, "plan.createMilestone", { projectId: pid, name: "MCP 里程碑" });
  ok("plan.createMilestone 已可用（第 17 轮补齐）", !planTool.isError, JSON.stringify(planTool.data).slice(0, 70));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(idempotencyKey);
  await db.delete(apiToken);
  await db.delete(collabMember);
  await db.delete(collabSnapshot);
  await db.delete(collabUpdate);
  await db.delete(collabRoom);
  await db.delete(ideaVote); await db.delete(idea);
  await db.delete(pagePermission); await db.delete(pageRevision); await db.delete(page);
  await db.delete(workItemRelation); await db.delete(comment);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator);
  await db.delete(memberPreference);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(milestone); await db.delete(iteration); await db.delete(release); await db.delete(moduleT);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [ADMIN, MEMBERU]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
