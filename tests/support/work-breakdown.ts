import assert from "node:assert/strict";
import Fastify from "fastify";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ToolCtx } from "../../src/server/application/capabilities/tools.ts";

assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { db, sql, inTransaction } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, workItem, workItemCollaborator } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const items = await import("../../src/server/services/work-item.service.ts");
const plans = await import("../../src/server/services/planning.service.ts");
const app = Fastify();
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [admin, outsider] = await db.insert(member).values([
    { username: "breakdown-admin", name: "分解验收", passwordHash: "no-login", status: "ACTIVE" },
    { username: "breakdown-outsider", name: "父项协作者", passwordHash: "no-login", status: "ACTIVE" },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(admin!.id))!, denied = (await loadActor(outsider!.id))!;
  const project = await createProject(actor, { key: "BRK", name: "需求分解验收" });
  const otherProject = await createProject(actor, { key: "BRKOTHER", name: "其他项目" });
  const parent = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "REQUIREMENT", title: "账户需求" })))!;
  const iteration = await plans.createPlan(actor, project.id, "iteration", { name: "研发迭代", startDate: "2026-11-26", endDate: "2026-12-02" });
  let child = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "TASK", title: "实现账户", parentId: parent.id, assigneeId: admin!.id, priority: "HIGH", dueDate: "2026-12-02", iterationId: iteration.id })))!;
  const subtask = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "SUBTASK", title: "接口开发", parentId: child.id })))!;
  const sibling = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "TASK", title: "未授权子项", parentId: parent.id })))!;
  const foreign = (await inTransaction(() => items.createWorkItem(actor, otherProject.id, { type: "TASK", title: "其他项目任务" })))!;
  assert.notEqual(parent.workflowId, child.workflowId);
  assert.equal(subtask.workflowId, child.workflowId);
  await assert.rejects(items.getWorkItem(denied, parent.id), code("FORBIDDEN"));
  await db.insert(workItemCollaborator).values({ workItemId: parent.id, memberId: outsider!.id });
  assert.equal((await items.getWorkItem(denied, parent.id)).id, parent.id);
  // 只协作父项不代表能看全部子项；旧实现会泄露两个子项。
  assert.equal((await items.listChildren(denied, parent.id)).children.length, 0);
  await db.insert(workItemCollaborator).values({ workItemId: child.id, memberId: outsider!.id });
  assert.deepEqual((await items.listChildren(denied, parent.id)).children.map(row => row.id), [child.id]);
  const summary = (await items.listChildren(actor, parent.id)).children.find(row => row.id === child.id)!;
  assert.equal(summary.assigneeName, "分解验收");
  assert.equal(summary.statusKey, "TODO");
  assert.equal(summary.statusCategory, "NOT_STARTED");
  assert.equal(summary.dueDate, "2026-12-02");
  assert.equal(summary.status_id, child.statusId); // 保留已发布字段。
  child = (await inTransaction(() => items.updateWorkItem(actor, child.id, { title: "更新实现范围", parentId: parent.id, iterationId: iteration.id, version: child.version })))!;
  assert.equal(child.parentId, parent.id);
  await assert.rejects(inTransaction(() => items.updateWorkItem(actor, child.id, { title: "过期覆盖", version: 1 })), code("VERSION_CONFLICT"));
  await assert.rejects(inTransaction(() => items.updateWorkItem(actor, child.id, { parentId: foreign.id, version: child.version })), code("VALIDATION"));
  await assert.rejects(inTransaction(() => items.updateWorkItem(actor, parent.id, { parentId: subtask.id, version: parent.version })), code("VALIDATION"));
  await assert.rejects(inTransaction(() => items.updateWorkItem(actor, subtask.id, { parentId: null, version: subtask.version })), code("VALIDATION"));
  assert.equal((await items.getWorkItem(actor, child.id)).title, "更新实现范围");
  await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, sibling.id));
  assert.equal((await items.listChildren(actor, parent.id)).children.length, 1);

  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async req => { req.actor = req.headers["x-denied"] ? denied : actor; });
  app.setErrorHandler((error, _req, reply) => { const e = error as { code: string; httpStatus: number }; reply.status(e.httpStatus ?? 400).send({ code: e.code }); });
  await (await import("../../src/server/routes/work-items.ts")).registerWorkItemRoutes(app);
  const response = await app.inject({ method: "GET", url: `/api/v1/work-items/${parent.id}/children` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().children[0].title, "更新实现范围");
  const found = await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/work-items?view=list&q=${encodeURIComponent("实现范围")}` });
  assert.deepEqual(found.json().items.map((row: { id: string }) => row.id), [child.id]);
  const { ALL_TOOLS } = await import("../../src/server/application/capabilities/tools.ts");
  const tool = ALL_TOOLS.find(tool => tool.name === "workitem.children")!;
  const ctx = { actor, token: { tokenId: crypto.randomUUID(), memberId: actor.memberId, tier: "READ_ONLY", projectWhitelist: [project.id] } } as ToolCtx;
  const result = await tool.handler(ctx, { workItemId: parent.id });
  const validation = new AjvJsonSchemaValidator().getValidator(tool.outputSchema!)(JSON.parse(JSON.stringify(result)));
  assert.equal(validation.valid, true, JSON.stringify(validation));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), response.json());
  await assert.rejects(tool.handler({ ...ctx, token: { ...ctx.token, projectWhitelist: [otherProject.id] } }, { workItemId: parent.id }), code("NOT_FOUND"));
  console.log("work breakdown contracts passed");
} finally { await app.close(); await sql.end({ timeout: 5 }); }
