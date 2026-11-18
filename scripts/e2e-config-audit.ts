import "./_env.ts";   // 环境预设必须最先加载
/**
 * 配置类安全审计补全自检（Round 25 长任务第 30 项）：
 * 项目集（portfolio）与 Webhook 端点的增删改此前**没有任何审计** —— 这类配置能改变数据暴露面
 * （项目集汇总可见范围、Webhook 出站目标），必须可追责。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, portfolio, portfolioProject, project, role, roleAssignment, webhookDelivery, webhookEndpoint } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as portfolioService from "../src/server/services/portfolio.service.ts";
import * as whService from "../src/server/services/webhook.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "cfgaudit-admin";
const PW = "cfgaudit-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(ADMIN);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "cfgaudit@x.test", name: "配置审计员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const proj = await projectService.createProject(admin, { key: `CFA${SUFFIX}`, name: "配置审计项目" } as never);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
let portfolioId = "";
try {
  // ① 项目集：创建 → 改名 → 加项目 → 移除项目 → 删除
  const pf = await portfolioService.createPortfolio(admin, { name: "配置审计项目集" });
  portfolioId = pf.id;
  await portfolioService.updatePortfolio(admin, portfolioId, { name: "配置审计项目集（改）" });
  await portfolioService.addProject(admin, portfolioId, proj.id);
  await portfolioService.removeProject(admin, portfolioId, proj.id);
  await portfolioService.deletePortfolio(admin, portfolioId);

  // ② Webhook：创建 → 更新 → 删除
  const ep = await whService.createEndpoint(admin, { name: "配置审计端点", url: "https://example.com/hook", events: ["work_item.created"] });
  await whService.updateEndpoint(admin, ep.endpoint.id, { name: "配置审计端点（改）" });
  await whService.deleteEndpoint(admin, ep.endpoint.id);

  const rows = await db.select().from(auditEntry);
  const of = (a: string) => rows.filter((r) => r.action === a);
  ok("项目集 5 类动作全部落审计",
    of("portfolio.created").length === 1 && of("portfolio.updated").length === 1
    && of("portfolio.project_added").length === 1 && of("portfolio.project_removed").length === 1
    && of("portfolio.deleted").length === 1,
    JSON.stringify(rows.map((r) => r.action)));
  ok("Webhook 3 类动作全部落审计",
    of("webhook.created").length === 1 && of("webhook.updated").length === 1 && of("webhook.deleted").length === 1,
    JSON.stringify(rows.map((r) => r.action)));
  ok("审计均为 SECURITY 级", rows.filter((r) => r.action.startsWith("portfolio.") || r.action.startsWith("webhook.")).every((r) => r.severity === "SECURITY"));
  ok("项目集加/减项目记录了 projectId",
    (of("portfolio.project_added")[0]?.changes as { projectId?: string } | null)?.projectId === proj.id
    && (of("portfolio.project_removed")[0]?.changes as { projectId?: string } | null)?.projectId === proj.id);
  ok("Webhook 审计不含签名密钥明文",
    !JSON.stringify(rows.filter((r) => r.action.startsWith("webhook."))).includes("whsec_"));

  const list = await fetch(`${BASE}/api/v1/audit-entries?pageSize=100&q=portfolio.`, {
    headers: { cookie: (await (async () => {
      const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ADMIN, password: PW }) });
      return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    })()) },
  });
  const body = await list.json() as { total?: number };
  ok("审计端点可按 portfolio. 检索到 5 条", list.status === 200 && body.total === 5, JSON.stringify(body));
} finally {
  await app.close();
  if (portfolioId) {
    await db.delete(portfolioProject).where(eq(portfolioProject.portfolioId, portfolioId));
    await db.delete(portfolio).where(eq(portfolio.id, portfolioId));
  }
  await db.delete(webhookDelivery);
  await db.delete(webhookEndpoint);
  await db.delete(auditEntry);
  await db.delete(project).where(eq(project.id, proj.id));
  await deleteTestMember(ADMIN);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
