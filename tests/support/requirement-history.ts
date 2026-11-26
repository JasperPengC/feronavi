import assert from "node:assert/strict";
import Fastify from "fastify";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ToolCtx } from "../../src/server/application/capabilities/tools.ts";

assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { db, sql, inTransaction } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, workItem } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const items = await import("../../src/server/services/work-item.service.ts");
const app = Fastify();
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const snapshotFailure = (error: unknown) => (error as { cause?: Error }).cause?.message === "revision fixture failure";
const rows = (id: string) => sql`select * from requirement_revision where work_item_id=${id} order by revision_no`;

try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [admin, outsider] = await db.insert(member).values([
    { username: "history-admin", name: "版本验收", passwordHash: "no-login", status: "ACTIVE" },
    { username: "history-outsider", name: "无权用户", passwordHash: "no-login", status: "ACTIVE" },
  ]).returning();
  assert.ok(admin && outsider && adminRole);
  await db.insert(roleAssignment).values({ memberId: admin.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(admin.id))!;
  const denied = (await loadActor(outsider.id))!;
  const project = await createProject(actor, { key: "REV", name: "需求历史验收" });
  // 模拟升级前已有需求；旧库尚无历史表，不能通过新版需求创建入口。
  const legacy = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "TASK", title: "既有需求", description: "原有正文" })))!;
  await db.update(workItem).set({ type: "REQUIREMENT", version: 7, createdAt: new Date("2020-01-01") }).where(eq(workItem.id, legacy.id));
  await (await import("../../src/db/migrate.ts")).runMigrations();
  const baseline = await rows(legacy.id);
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0]!.source, "BASELINE");
  assert.equal(baseline[0]!.author_id, null);
  assert.equal(baseline[0]!.work_item_version, 7);
  assert.equal(baseline[0]!.description, "原有正文");
  assert.ok(new Date(baseline[0]!.created_at).getFullYear() > 2020);

  let item = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "REQUIREMENT", title: "第一版", description: "第一行\n第二行" })))!;
  let history = await rows(item.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.revision_no, 1);
  assert.equal(history[0]!.work_item_version, 1);
  assert.equal(history[0]!.source, "INITIAL");
  assert.equal(history[0]!.author_id, actor.memberId);
  item = (await inTransaction(() => items.updateWorkItem(actor, item.id, { version: item.version, priority: "HIGH" })))!;
  item = (await inTransaction(() => items.updateWorkItem(actor, item.id, { version: item.version, title: item.title, description: item.description })))!;
  assert.equal((await rows(item.id)).length, 1, "元数据和正文原值不生成版本");
  item = (await inTransaction(() => items.updateWorkItem(actor, item.id, { version: item.version, title: "第二版", description: null })))!;
  history = await rows(item.id);
  assert.deepEqual(history.map(r => r.revision_no), [1, 2]);
  assert.equal(history[1]!.description, null);
  assert.equal(history[1]!.work_item_version, 4);
  assert.equal(history[0]!.description, "第一行\n第二行");
  item = (await inTransaction(() => items.updateWorkItem(actor, item.id, { version: item.version, description: "" })))!;
  assert.equal((await rows(item.id)).length, 3, "null 与空串区分");

  const expectedVersion = item.version;
  const racing = await Promise.allSettled(["并发A", "并发B"].map(title => inTransaction(() => items.updateWorkItem(actor, item.id, { version: expectedVersion, title }))));
  assert.equal(racing.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(racing.some(result => result.status === "rejected" && code("VERSION_CONFLICT")(result.reason)));
  history = await rows(item.id);
  assert.deepEqual(history.map(r => r.revision_no), [1, 2, 3, 4]);
  item = await items.getWorkItem(actor, item.id);
  assert.equal(history[3]!.title, item.title);

  // 数据库插入故障必须回滚正文、CAS版本和新建序号；不靠 mock 模拟事务。
  await sql`create function fail_revision_fixture() returns trigger language plpgsql as $$ begin raise exception 'revision fixture failure'; end $$`;
  await sql`create trigger fail_revision_fixture before insert on requirement_revision for each row execute function fail_revision_fixture()`;
  const beforeFailure = await items.getWorkItem(actor, item.id);
  const [{ next_issue_number: next }] = await sql`select next_issue_number from project where id=${project.id}`;
  await assert.rejects(items.updateWorkItem(actor, item.id, { version: item.version, description: "不应保存" }), snapshotFailure);
  assert.deepEqual(await items.getWorkItem(actor, item.id), beforeFailure);
  await assert.rejects(items.createWorkItem(actor, project.id, { type: "REQUIREMENT", title: "不应创建" }), snapshotFailure);
  assert.equal((await sql`select next_issue_number from project where id=${project.id}`)[0]!.next_issue_number, next);
  assert.equal((await rows(item.id)).length, 4);
  await sql`drop trigger fail_revision_fixture on requirement_revision`;
  await sql`drop function fail_revision_fixture()`;
  await assert.rejects(sql`update requirement_revision set title='篡改' where id=${history[0]!.id}`, /immutable/u);

  const revisions = await import("../../src/server/services/requirement-revision.service.ts");
  const first = await revisions.listRequirementRevisions(actor, item.id, { limit: 2 });
  assert.deepEqual(first.items.map(r => r.revisionNo), [4, 3]);
  assert.equal(first.nextCursor, 3);
  assert.equal(Object.hasOwn(first.items[0]!, "description"), false);
  // 下一页期间插入新版本不使之前页的游标漂移。
  item = (await inTransaction(() => items.updateWorkItem(actor, item.id, { version: item.version, title: "并发之后" })))!;
  const second = await revisions.listRequirementRevisions(actor, item.id, { before: first.nextCursor!, limit: 2 });
  assert.deepEqual(second.items.map(r => r.revisionNo), [2, 1]);
  assert.equal(second.nextCursor, null);
  assert.equal((await revisions.getRequirementRevision(actor, item.id, String(history[0]!.id))).title, "第一版");
  await assert.rejects(revisions.getRequirementRevision(actor, legacy.id, String(history[0]!.id)), code("FORBIDDEN"));
  await assert.rejects(revisions.listRequirementRevisions(denied, item.id), code("FORBIDDEN"));
  await assert.rejects(revisions.getRequirementRevision(denied, item.id, String(history[0]!.id)), code("FORBIDDEN"));
  await assert.rejects(revisions.listRequirementRevisions(actor, item.id, { limit: 51 }), code("VALIDATION"));
  const task = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "TASK", title: "普通任务" })))!;
  assert.equal((await rows(task.id)).length, 0);
  await assert.rejects(revisions.listRequirementRevisions(actor, task.id), code("VALIDATION"));

  const restored = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "TASK", title: "旧包恢复内容" })))!;
  await db.update(workItem).set({ type: "REQUIREMENT", version: 12 }).where(eq(workItem.id, restored.id));
  const restoreHistory = await import("../../src/server/repos/requirement-revision.repo.ts");
  assert.equal(await restoreHistory.restoredHistoryIsConsistent(), false);
  await inTransaction(() => restoreHistory.captureRestoredBaselines());
  await inTransaction(() => restoreHistory.captureRestoredBaselines());
  const restoredRows = await rows(restored.id);
  assert.equal(restoredRows.length, 1);
  assert.equal(restoredRows[0]!.source, "BASELINE");
  assert.equal(restoredRows[0]!.author_id, null);
  assert.equal(restoredRows[0]!.work_item_version, 12);
  assert.equal(await restoreHistory.restoredHistoryIsConsistent(), true);

  // HTTP真实路由 + 领域服务 + 隔离DB；仅身份由测试钩子注入。
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async req => { req.actor = req.headers["x-denied"] ? denied : actor; });
  app.setErrorHandler((error, _req, reply) => { const e = error as { code: string; httpStatus: number }; reply.status(e.httpStatus ?? 400).send({ code: e.code }); });
  await (await import("../../src/server/routes/work-items.ts")).registerWorkItemRoutes(app);
  const base = `/api/v1/work-items/${item.id}/revisions`;
  const response = await app.inject({ method: "GET", url: `${base}?limit=2` });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items.map((r: { revisionNo: number }) => r.revisionNo), [5, 4]);
  assert.equal((await app.inject({ method: "GET", url: `${base}/${history[0]!.id}` })).json().description, "第一行\n第二行");
  assert.equal((await app.inject({ method: "GET", url: base, headers: { "x-denied": "1" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: `${base}?limit=0` })).statusCode, 400);

  const { BUSINESS_TOOLS } = await import("../../src/server/application/capabilities/tools.ts");
  const ctx = { actor, token: { tokenId: crypto.randomUUID(), memberId: actor.memberId, tier: "READ_ONLY", projectWhitelist: [project.id] } } as ToolCtx;
  const validator = new AjvJsonSchemaValidator();
  for (const name of ["workitem.listRequirementRevisions", "workitem.getRequirementRevision"]) {
    const tool = BUSINESS_TOOLS.find(tool => tool.name === name)!;
    assert.ok(tool?.outputSchema);
    const args = { projectId: project.id, workItemId: item.id, ...(name.includes("getRequirement") ? { revisionId: String(history[0]!.id) } : { limit: 2 }) };
    const result = await tool.handler(ctx, args);
    assert.equal(validator.getValidator(tool.outputSchema)(JSON.parse(JSON.stringify(result))).valid, true);
    await assert.rejects(tool.handler({ ...ctx, token: { ...ctx.token, projectWhitelist: [crypto.randomUUID()] } }, args), code("NOT_FOUND"));
  }
  await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, item.id));
  await assert.rejects(revisions.listRequirementRevisions(actor, item.id), code("FORBIDDEN"));
  await assert.rejects(revisions.getRequirementRevision(actor, item.id, String(history[0]!.id)), code("FORBIDDEN"));
  console.log("requirement history contracts passed");
} finally { await app.close(); await sql.end({ timeout: 5 }); }
