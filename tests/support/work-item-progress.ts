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
const progress = await import("../../src/server/services/issues.service.ts");
const app = Fastify();
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [admin, reader] = await db.insert(member).values([
    { username: "progress-admin", name: "进展验收", passwordHash: "no-login", status: "ACTIVE" },
    { username: "progress-reader", name: "只读协作者", passwordHash: "no-login", status: "ACTIVE" },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(admin!.id))!, readonly = (await loadActor(reader!.id))!;
  const project = await createProject(actor, { key: "PROGRESS", name: "结构化进展验收" });
  const parent = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "TASK", title: "主任务" })))!;
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async req => { req.actor = req.headers["x-reader"] ? readonly : actor; });
  app.setErrorHandler((error, _req, reply) => { const e = error as { code: string; httpStatus: number }; reply.status(e.httpStatus ?? 400).send({ code: e.code }); });
  await (await import("../../src/server/routes/work-items.ts")).registerWorkItemRoutes(app);
  const { ALL_TOOLS } = await import("../../src/server/application/capabilities/tools.ts");
  const read = ALL_TOOLS.find(t => t.name === "workitem.progressUpdates")!, write = ALL_TOOLS.find(t => t.name === "workitem.addProgressUpdate")!;
  const ctx = { actor, token: { tokenId: crypto.randomUUID(), memberId: actor.memberId, tier: "READ_WRITE", projectWhitelist: [project.id] } } as ToolCtx;
  const validator = new AjvJsonSchemaValidator().getValidator(read.outputSchema!);
  for (const type of ["REQUIREMENT", "TASK", "SUBTASK", "DEFECT"] as const) {
    const item = (await inTransaction(() => items.createWorkItem(actor, project.id, { type, title: type, ...(type === "SUBTASK" ? { parentId: parent.id } : {}) })))!;
    const url = `/api/v1/work-items/${item.id}/progress-updates`;
    const args = { workItemId: item.id, summary: "Agent完成接口", nextSteps: "页面验收", blockers: "待复核", idempotencyKey: `progress-${type}`, userConfirmed: true };
    await write.handler(ctx, args); await write.handler(ctx, args);
    const http = await app.inject({ method: "GET", url });
    assert.equal(http.statusCode, 200); assert.equal(http.json().updates.length, 1);
    const record = http.json().updates[0]; assert.equal(record.summary, args.summary); assert.equal(record.authorId, actor.memberId);
    const mcp = JSON.parse(JSON.stringify(await read.handler(ctx, { workItemId: item.id })));
    assert.deepEqual(mcp, http.json()); assert.equal(validator(mcp).valid, true);
    assert.equal((await app.inject({ method: "GET", url, headers: { "x-reader": "yes" } })).statusCode, 403);
    await db.insert(workItemCollaborator).values({ workItemId: item.id, memberId: reader!.id });
    assert.equal((await app.inject({ method: "GET", url, headers: { "x-reader": "yes" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url, headers: { "x-reader": "yes" }, payload: { summary: "越权更新" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/work-item-progress-updates/${record.id}`, headers: { "x-reader": "yes" } })).statusCode, 403);
    const posted = await app.inject({ method: "POST", url, payload: { summary: "人完成验收", nextSteps: "汇总结果", blockers: null } });
    assert.equal(posted.statusCode, 201);
    const reread = await read.handler(ctx, { workItemId: item.id }) as { updates: { summary: string }[] };
    assert.equal(reread.updates[0]?.summary, "人完成验收");
    await assert.rejects(read.handler({ ...ctx, token: { ...ctx.token, projectWhitelist: [crypto.randomUUID()] } }, { workItemId: item.id }), { code: "NOT_FOUND" });
    // 作者被移出负责人后仍可删除自己的历史记录，但不能新建或删除他人记录。
    await db.update(workItem).set({ assigneeId: reader!.id }).where(eq(workItem.id, item.id));
    const own = await inTransaction(() => progress.addProgressUpdate(readonly, item.id, { summary: "我的旧进展" }));
    await db.update(workItem).set({ assigneeId: null }).where(eq(workItem.id, item.id));
    await assert.rejects(progress.addProgressUpdate(readonly, item.id, { summary: "不再有编辑权" }), { code: "FORBIDDEN" });
    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/work-item-progress-updates/${own!.id}`, headers: { "x-reader": "yes" } })).statusCode, 200);
    assert.equal((await progress.listProgressUpdates(actor, item.id)).length, 2);
  }
  console.log("work item progress contracts passed");
} finally { await app.close(); await sql.end({ timeout: 5 }); }
