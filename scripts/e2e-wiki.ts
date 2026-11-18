import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** Wiki 自检（第十二期）：可见性矩阵、版本 append-only、slug 规则、乐观锁、检索不泄露 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, page, pagePermission, pageRevision, workItem, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w12-admin", INSIDER = "w12-insider", OUTSIDER = "w12-outsider";
const KEY = "W12PROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, INSIDER, OUTSIDER]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w12-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(ADMIN, "Wiki 管理员"), ins = await mk(INSIDER, "项目内成员"), outs = await mk(OUTSIDER, "项目外成员");
await db.insert(roleAssignment).values({ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W12 知识库" });
// 项目内成员（项目档），项目外成员：无任何指派
await db.insert(roleAssignment).values({ memberId: ins.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: pid });
const insider = (await loadActor(ins.id))!;
const outsider = (await loadActor(outs.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3985), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3985";

try {
  // ── 建页与 slug ──
  const pub = await wiki.createPage(admin, pid, { title: "公开文档 入门", content: "第一版正文" });
  ok("建页（PROJECT 可见）", pub!.visibility === "PROJECT" && pub!.slug === "公开文档-入门", pub!.slug);
  const dup = await wiki.createPage(admin, pid, { title: "公开文档 入门", content: "同名" });
  ok("同名 slug 自动追加 -2（不把唯一冲突抛给用户）", dup!.slug === "公开文档-入门-2", dup!.slug);
  const child = await wiki.createPage(admin, pid, { title: "子页面", content: "子正文", parentId: pub!.id });
  ok("子页面可建（页面树）", child!.parentId === pub!.id);

  // ── 版本 append-only ──
  const v2 = await wiki.updatePage(admin, pub!.id, { content: "第二版正文", changeSummary: "补充说明" });
  ok("改页生成新版本（版本号自增）", v2!.revisionNo === 2, String(v2!.revisionNo));
  const revs = await wiki.listRevisions(admin, pub!.id);
  ok("版本历史按新旧倒序", revs.length === 2 && revs[0]!.revisionNo === 2);
  const v1 = revs.find((r) => r.revisionNo === 1)!;
  const restored = await wiki.restoreRevision(admin, pub!.id, v1.id);
  ok("回滚生成**新**版本（append-only，不删旧版）", restored!.revisionNo === 3 && (await wiki.listRevisions(admin, pub!.id)).length === 3);
  ok("回滚后正文回到旧版内容", (await wiki.getPage(admin, pub!.id)).content === "第一版正文");
  const revCount = await sql<{ n: number }[]>`select count(*)::int as n from page_revision where page_id = ${pub!.id}`;
  ok("旧版本记录仍在库里", revCount[0]!.n === 3, String(revCount[0]!.n));

  // ── search_vector 与内容同步 ──
  const vec = await sql<{ t: string | null }[]>`select search_vector::text as t from page where id = ${pub!.id}`;
  ok("search_vector 已同步（派生列随 revision 更新）", (vec[0]!.t ?? "").includes("第一版"), (vec[0]!.t ?? "").slice(0, 40));

  // ── 乐观锁 ──
  const current = await wiki.getPage(admin, pub!.id);
  let versionConflict = false, code = "";
  try {
    await wiki.updatePage(admin, pub!.id, { content: "并发写", expectedRevisionId: v1.id });
  } catch (e) { versionConflict = true; code = (e as { code?: string }).code ?? ""; }
  ok("乐观锁：期望版本不符 → VERSION_CONFLICT", versionConflict && code === "VERSION_CONFLICT", code);
  await wiki.updatePage(admin, pub!.id, { content: "正常写", expectedRevisionId: current.currentRevisionId! });
  ok("期望版本相符则写入成功", (await wiki.getPage(admin, pub!.id)).content === "正常写");

  // ── 防环 ──
  let cycle = false;
  try { await wiki.updatePage(admin, pub!.id, { parentId: child!.id }); } catch (e) { cycle = (e as { code?: string }).code === "VALIDATION"; }
  ok("父子成环 → VALIDATION", cycle);

  // ── 可见性矩阵（本期核心）──
  const restricted = await wiki.createPage(admin, pid, { title: "受限文档", content: "机密", visibility: "RESTRICTED" });
  ok("建受限页需 page:manage_visibility（管理员可）", restricted!.visibility === "RESTRICTED");
  ok("PROJECT 页：项目内成员可见", (await wiki.listPages(insider, pid)).some((p) => p.id === pub!.id));
  ok("RESTRICTED 页：创建者可读（同事务自动授权，否则连 ACL 都设不了）", (await wiki.listPages(admin, pid)).some((p) => p.id === restricted!.id));
  ok("RESTRICTED 页：项目内成员**不可见**（未授权）", !(await wiki.listPages(insider, pid)).some((p) => p.id === restricted!.id));
  let directDenied = false;
  try { await wiki.getPage(insider, restricted!.id); } catch { directDenied = true; }
  ok("直链也拒绝（不可见与不存在同形）", directDenied);
  ok("搜索不泄露受限页", (await wiki.searchPages(insider, pid, "受限")).length === 0);
  // 授 MEMBER 读权
  await wiki.setPermissions(admin, restricted!.id, [{ principalType: "MEMBER", principalId: ins.id, canRead: true, canWrite: false }]);
  ok("授读权后：可见", (await wiki.listPages(insider, pid)).some((p) => p.id === restricted!.id));
  ok("搜索也能搜到（同一可见性条件）", (await wiki.searchPages(insider, pid, "受限")).length === 1);
  ok("只读：不能改", await (async () => { try { await wiki.updatePage(insider, restricted!.id, { content: "偷改" }); return false; } catch { return true; } })());
  // 授 ROLE 写权（MEMBER 角色）
  await wiki.setPermissions(admin, restricted!.id, [
    { principalType: "MEMBER", principalId: ins.id, canRead: true, canWrite: false },
    { principalType: "ROLE", principalId: memberRole!.id, canRead: true, canWrite: true },
  ]);
  const insiderEdited = await wiki.updatePage(insider, restricted!.id, { content: "成员通过 ROLE 授权写入" });
  ok("ROLE 主体授权生效（可写）", insiderEdited!.revisionNo === 2);
  // 项目外成员：即便有 ACL 也应被项目数据范围挡住
  // 同时给内成员与项目外成员授读权：前者应能读、后者应被项目范围挡住
  await wiki.setPermissions(admin, restricted!.id, [
    { principalType: "MEMBER", principalId: ins.id, canRead: true, canWrite: false },
    { principalType: "MEMBER", principalId: outs.id, canRead: true, canWrite: true },
  ]);
  let outsiderDenied = false;
  try { await wiki.getPage(outsider, restricted!.id); } catch { outsiderDenied = true; }
  ok("项目外成员即便被授 ACL 也读不到（项目范围优先）", outsiderDenied);

  // ── ACL 只对 RESTRICTED 有意义 ──
  let aclOnPublic = false;
  try { await wiki.setPermissions(admin, pub!.id, [{ principalType: "MEMBER", principalId: ins.id, canRead: true, canWrite: true }]); } catch (e) { aclOnPublic = (e as { code?: string }).code === "VALIDATION"; }
  ok("给 PROJECT 页设 ACL → VALIDATION", aclOnPublic);

  // ── 软删改写 slug ──
  const beforeSlug = pub!.slug;
  await wiki.deletePage(admin, pub!.id);
  ok("软删后列表不含", !(await wiki.listPages(admin, pid)).some((p) => p.id === pub!.id));
  const deletedRow = await sql<{ slug: string }[]>`select slug from page where id = ${pub!.id}`;
  ok("软删**改写 slug**（否则同名重建撞唯一键）", deletedRow[0]!.slug.startsWith(`${beforeSlug}--deleted-`), deletedRow[0]!.slug);
  const rebuilt = await wiki.createPage(admin, pid, { title: "公开文档 入门", content: "重建" });
  ok("软删后同名可再建（slug 不被占用）", rebuilt!.slug === beforeSlug, rebuilt!.slug);

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: INSIDER, password: "w12-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const httpList = await fetch(`${BASE}/api/v1/projects/${pid}/pages`, { headers: { cookie } });
  const listBody = (await httpList.json()) as { pages: { id: string }[]; mode: string };
  // 此刻内成员**已获读权**，受限页本就应出现在列表里（早先不在其中的断言对应的是未授权状态）
  ok("HTTP 列表 200（有读权的受限页也在其中）", httpList.status === 200 && listBody.pages.some((p) => p.id === restricted!.id), JSON.stringify(listBody.mode));
  const httpGet = await fetch(`${BASE}/api/v1/pages/${restricted!.id}`, { headers: { cookie } });
  ok("HTTP 详情：有读权返回正文", httpGet.status === 200 && !!((await httpGet.json()) as { content: string }).content, String(httpGet.status));
  const httpListNoBody = await fetch(`${BASE}/api/v1/projects/${pid}/pages?q=受限`, { headers: { cookie } });
  ok("HTTP 检索模式标记正确", ((await httpListNoBody.json()) as { mode: string }).mode === "search");
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(pageRevision);
  await db.delete(pagePermission);
  await db.delete(page);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [ADMIN, INSIDER, OUTSIDER]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
