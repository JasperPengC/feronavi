import assert from "node:assert/strict";
import Fastify from "fastify";
import type { ToolCtx } from "../../src/server/application/capabilities/tools.ts";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const wiki = await import("../../src/server/services/wiki.service.ts");
const documents = await import("../../src/server/services/collab-document.service.ts");
const rooms = await import("../../src/server/services/collab-room.persistence.ts");
const { createContentUpdate } = await import("../../src/server/services/collab-document-core.ts");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const app = Fastify();
const invalid = (error: unknown) => (error as { code?: string }).code === "VALIDATION";
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [owner] = await db.insert(member).values({ username: "links-admin", name: "文档验证", passwordHash: "no-login", status: "ACTIVE" }).returning();
  assert.ok(owner && adminRole);
  await db.insert(roleAssignment).values({ memberId: owner.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(owner.id))!;
  const project = await createProject(actor, { key: "LINKS", name: "文档链接验收" });
  const counts = async () => (await sql`select (select count(*) from page)::int as pages, (select count(*) from page_revision)::int as revisions, (select count(*) from index_job)::int as jobs`)[0];
  const before = await counts();
  await assert.rejects(wiki.createPage(actor, project.id, { title: "错误链接", content: "[文件](/Users/dev/doc.md)" }), invalid);
  assert.deepEqual(await counts(), before);
  const page = await wiki.createPage(actor, project.id, { title: "有效文档", content: "路径示例 `/Users/dev/doc.md`" });
  const baseline = await wiki.getPage(actor, page.id);
  const currentCounts = await counts();
  await assert.rejects(wiki.updatePage(actor, page.id, { content: "![图片](C:/tmp/a.png)", expectedRevisionId: page.currentRevisionId! }), invalid);
  assert.deepEqual(await wiki.getPage(actor, page.id), baseline);
  assert.deepEqual(await counts(), currentCounts);

  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async req => { req.actor = actor; });
  app.setErrorHandler((error, _req, reply) => { const e = error as { httpStatus?: number; code?: string; message?: string; details?: unknown }; reply.status(e.httpStatus ?? 500).send({ code: e.code, message: e.message, details: e.details }); });
  await (await import("../../src/server/routes/pages.ts")).registerPageRoutes(app);
  const rest = await app.inject({ method: "PATCH", url: `/api/v1/pages/${page.id}`, payload: { content: "[文件](../local.md)", expectedRevisionId: page.currentRevisionId } });
  assert.equal(rest.statusCode, 400);
  assert.equal(rest.json().details.issues[0].line, 1);

  // 浏览器协同草稿允许暂存不完整输入，但发布失败不能推进正文或清掉草稿。
  const room = await rooms.getOrCreateRoom(actor, "PAGE", page.id);
  await rooms.joinRoom(actor, "PAGE", page.id, "links-client");
  const state = await documents.loadDocument(room.id);
  const content = "[来源](/home/dev/file.md)";
  const delta = createContentUpdate(state.state, content);
  await documents.applyUpdate({ roomId: room.id, actorId: actor.memberId, clientId: "links-client", operationId: "invalid-draft", updateBase64: Buffer.from(delta!).toString("base64") });
  const draft = await documents.loadDocument(room.id);
  await assert.rejects(documents.publishPage(actor, room.id, { expectedRevisionId: page.currentRevisionId! }), invalid);
  assert.deepEqual((await documents.loadDocument(room.id)).state, draft.state);
  assert.deepEqual(await wiki.getPage(actor, page.id), baseline);
  assert.deepEqual(await counts(), currentCounts);

  const { ALL_TOOLS } = await import("../../src/server/application/capabilities/tools.ts");
  const ctx = { actor, token: { tokenId: "link-contract", memberId: actor.memberId, tier: "READ_WRITE", projectWhitelist: [project.id] } } as ToolCtx;
  const tool = ALL_TOOLS.find(tool => tool.name === "page.update")!;
  assert.match(tool.description, /本地\/相对文件路径/);
  await assert.rejects(tool.handler(ctx, { pageId: page.id, expectedRevisionId: page.currentRevisionId, content: "[另一个坏链接](./file.md)", userConfirmed: true }), invalid);
  assert.deepEqual((await documents.loadDocument(room.id)).state, draft.state, "MCP整篇更新失败应回滚自身写入的协作日志");
  assert.deepEqual(await wiki.getPage(actor, page.id), baseline);
  assert.deepEqual(await counts(), currentCounts);
  console.log("document link contracts passed");
} finally { await app.close(); await sql.end(); }
