import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 项目集自检（第十一期）：分组 + 汇总视图 + 范围边界（不做跨项目依赖）+ 权限 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, portfolio, portfolioProject, workItem, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as pf from "../src/server/services/portfolio.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w11e-admin", LIMITED = "w11e-limited";
const K1 = "W11E-A", K2 = "W11E-B", K3 = "W11E-C";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, LIMITED]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const [a] = await db.insert(member).values({ username: ADMIN, email: "w11e@x.test", name: "项目集管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w11e-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [m] = await db.insert(member).values({ username: LIMITED, email: "w11em@x.test", name: "受限成员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w11e-password-1234") }).returning({ id: member.id });

for (const k of [K1, K2, K3]) await db.delete(project).where(eq(project.key, k));
const { id: p1 } = await projectService.createProject(admin, { key: K1, name: "项目 A" });
const { id: p2 } = await projectService.createProject(admin, { key: K2, name: "项目 B" });
const { id: p3 } = await projectService.createProject(admin, { key: K3, name: "项目 C（受限）" });
// 受限成员只被指派到项目 A
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: p1 });
const limited = (await loadActor(m!.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3986), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3986";

try {
  // ── 建项目集与分组 ──
  const pf1 = await pf.createPortfolio(admin, { name: "2026 上半年" });
  ok("建项目集", !!pf1!.id && pf1!.projectCount === 0);
  await pf.addProject(admin, pf1!.id, p1);
  await pf.addProject(admin, pf1!.id, p2);
  await pf.addProject(admin, pf1!.id, p1);      // 重复加：幂等
  const detail = await pf.getPortfolio(admin, pf1!.id);
  ok("重复加入项目是幂等的（复合 PK）", detail.projects.length === 2, String(detail.projects.length));
  ok("汇总视图：项目数", detail.projectCount === 2, String(detail.projectCount));

  // 两个项目各建工作项，验证汇总口径
  await wiService.createWorkItem(admin, p1, { type: "TASK", title: "A-1" });
  await wiService.createWorkItem(admin, p1, { type: "TASK", title: "A-2" });
  await wiService.createWorkItem(admin, p2, { type: "TASK", title: "B-1" });
  const d2 = await pf.getPortfolio(admin, pf1!.id);
  ok("汇总视图：活跃工作项数（跨项目聚合）", d2.workItemCount === 3, String(d2.workItemCount));
  const list = await pf.listPortfolios(admin);
  ok("列表带汇总计数", list.find((x) => x.id === pf1!.id)!.workItemCount === 3);

  // ── 范围边界：不做跨项目依赖 ──
  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns where table_name = 'portfolio_project' order by column_name`;
  ok("portfolio_project 只有两列（不加依赖/顺序等跨项目语义）",
    JSON.stringify(cols.map((c) => c.column_name)) === JSON.stringify(["portfolio_id", "project_id"]),
    cols.map((c) => c.column_name).join(","));

  // ── 数据范围：汇总视图不越权 ──
  await pf.addProject(admin, pf1!.id, p3);
  const limitedView = await pf.getPortfolio(limited, pf1!.id);
  ok("受限成员只看到自己范围内的项目", limitedView.projects.length === 1 && limitedView.projects[0]!.key === K1,
    limitedView.projects.map((x) => x.key).join(","));
  ok("汇总计数同样被数据范围过滤", limitedView.projectCount === 1 && limitedView.workItemCount === 2,
    `${limitedView.projectCount}/${limitedView.workItemCount}`);
  const limitedList = await pf.listPortfolios(limited);
  ok("列表也不泄露不可见项目的计数", limitedList.find((x) => x.id === pf1!.id)!.projectCount === 1);

  // ── 移除项目 ──
  await pf.removeProject(admin, pf1!.id, p2);
  ok("移除项目后不再计入", (await pf.getPortfolio(admin, pf1!.id)).projectCount === 2);

  // ── 改名与删除 ──
  await pf.updatePortfolio(admin, pf1!.id, { name: "2026 上半年（改）" });
  ok("改名", (await pf.getPortfolio(admin, pf1!.id)).name === "2026 上半年（改）");
  const pf2 = await pf.createPortfolio(admin, { name: "临时集" });
  await pf.addProject(admin, pf2!.id, p1);
  await pf.deletePortfolio(admin, pf2!.id);
  const orphan = await db.select().from(portfolioProject).where(eq(portfolioProject.portfolioId, pf2!.id));
  ok("删项目集级联清掉关联行（项目本身保留）", orphan.length === 0);

  // ── 权限：沿用 project:create（无 portfolio:* 动作）──
  let deniedCreate = false;
  try { await pf.createPortfolio(limited, { name: "x" }); } catch { deniedCreate = true; }
  ok("无 project:create 者不能建项目集", deniedCreate);
  let deniedAdd = false;
  try { await pf.addProject(limited, pf1!.id, p3); } catch { deniedAdd = true; }
  ok("无 project:create 者不能改分组", deniedAdd);
  let deniedDelete = false;
  try { await pf.deletePortfolio(limited, pf1!.id); } catch { deniedDelete = true; }
  ok("无 project:create 者不能删项目集", deniedDelete);
  let missing = false;
  try { await pf.addProject(admin, pf1!.id, "00000000-0000-0000-0000-000000000000"); } catch (e) { missing = (e as { code?: string }).code === "NOT_FOUND"; }
  ok("加入不存在的项目 → NOT_FOUND", missing);

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: "w11e-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const httpList = await fetch(`${BASE}/api/v1/portfolios`, { headers: { cookie } });
  const httpBody = (await httpList.json()) as { portfolios: { projectCount: number }[] };
  ok("HTTP 列表 200 且带汇总", httpList.status === 200 && httpBody.portfolios[0]!.projectCount >= 1, JSON.stringify(httpBody).slice(0, 80));
  const httpCreate = await fetch(`${BASE}/api/v1/portfolios`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ name: "HTTP 建的集" }),
  });
  ok("HTTP 建项目集 201", httpCreate.status === 201, String(httpCreate.status));
  const httpBad = await fetch(`${BASE}/api/v1/portfolios`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ name: "" }),
  });
  ok("HTTP 空名称 400", httpBad.status === 400, String(httpBad.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(portfolioProject);
  await db.delete(portfolio);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  for (const id of [p1, p2, p3]) await db.delete(workItem).where(eq(workItem.projectId, id));
  for (const k of [K1, K2, K3]) await db.delete(project).where(eq(project.key, k));
  for (const u of [ADMIN, LIMITED]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
