import "./_env.ts";
/** 真实HTTP/CRDT：恢复历史、元数据与外部正文更新后，房间基线和现有客户端持续可用。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { and, eq } from "drizzle-orm";
import { db, sql, inTransaction } from "../src/db/index.ts";
import { deferAfterCommit } from "../src/db/context.ts";
import { member, role, roleAssignment, collabRoom, page, pageRevision, auditEntry, indexJob } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as documents from "../src/server/services/collab-document.service.ts";
import { lockProjectTree } from "../src/server/services/project-tree.ts";
import { subscribe, type SseEvent } from "../src/server/services/events.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const marker = randomUUID().slice(0, 6).toUpperCase();
let checks = 0, failures = 0, rpcId = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`OK ${name}`); };
const scenario = async (name: string, run: () => Promise<void>) => { try { await run(); } catch (error) { failures++; console.error(`FAIL ${name}:`, error); } };
await ensureInitialized();
const app = await buildApp({ logger: false });
const events: SseEvent[] = [];
const unsubscribe = subscribe(event => events.push(event));
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const password = `Crdt-${marker}-password`;
  const [person] = await db.insert(member).values({ username: `crdt-rev-${marker.toLowerCase()}`, name: "文档版本验收", status: "ACTIVE", passwordHash: await hashPassword(password) }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(person!.id))!;
  const project = await projects.createProject(actor, { key: `CR${marker}`, name: "文档基线验收" });
  const token = await tokens.createToken(actor, { name: "文档版本写入", tier: "READ_WRITE", projectWhitelist: [project.id] });
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT) });
  const login = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: person!.username, password }) });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  const headers = { "content-type": "application/json", "x-csrf-token": decodeURIComponent(loginBody.csrfToken), cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  const rest = async (path: string, method = "GET", body?: object, status = 200) => {
    const response = await fetch(`${process.env.BASE}/api/v1${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.notEqual(response.status, 429, "遇到限流，停止本轮");
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const call = async (name: string, args: object, error?: string) => {
    const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.error, undefined, JSON.stringify(envelope));
    const data = JSON.parse(envelope.result.content[0].text);
    if (error) { assert.equal(envelope.result.isError, true); assert.equal(data.code, error, JSON.stringify(data)); }
    else assert.notEqual(envelope.result.isError, true, JSON.stringify(data));
    return data;
  };
  const create = async (title: string) => {
    const first = await rest(`/projects/${project.id}/pages`, "POST", { title, content: "原始正文" }, 201);
    const second = await rest(`/pages/${first.id}`, "PATCH", { content: "第二版正文", expectedRevisionId: first.currentRevisionId });
    const path = `/collaboration/rooms/PAGE/${first.id}`;
    const joined = await rest(`${path}/join`, "POST", { clientId: `client-${first.id}` });
    const state = await rest(`${path}/state`);
    const client = new Y.Doc();
    Y.applyUpdate(client, Buffer.from(state.stateBase64, "base64"));
    return { first, second, path, client, roomId: joined.room.id, clientId: `client-${first.id}` };
  };
  const draft = async (fixture: Awaited<ReturnType<typeof create>>, text: string) => {
    const before = Y.encodeStateVector(fixture.client);
    fixture.client.getText("content").insert(fixture.client.getText("content").length, text);
    return rest(`${fixture.path}/updates`, "POST", { clientId: fixture.clientId, operationId: randomUUID(), updateBase64: Buffer.from(Y.encodeStateAsUpdate(fixture.client, before)).toString("base64") });
  };
  const sync = async (fixture: Awaited<ReturnType<typeof create>>) => {
    const state = await rest(`${fixture.path}/state`);
    Y.applyUpdate(fixture.client, Buffer.from(state.stateBase64, "base64"));
    return state;
  };
  const publish = (fixture: Awaited<ReturnType<typeof create>>, revision: string) => rest(`${fixture.path}/publish`, "POST", { expectedRevisionId: revision, userConfirmed: true });

  await scenario("历史恢复后继续协作发布", async () => {
    const f = await create("恢复保留Yjs历史");
    const draftResult = await draft(f, "，未发布草稿");
    const restored = await call("page.restoreRevision", { projectId: project.id, pageId: f.first.id, revisionId: f.first.currentRevisionId, expectedRevisionId: f.second.currentRevisionId, userConfirmed: true });
    const state = await sync(f);
    check("恢复将同一客户端已有Y.Doc准确替换为历史正文", f.client.getText("content").toString() === "原始正文");
    check("恢复日志序列、房间和快照基线一起推进", state.sequence === draftResult.sequence + 1 && state.baseRevisionId === restored.id && (await documents.loadDocument(f.roomId)).baseRevisionId === restored.id);
    await draft(f, "，恢复后继续编辑");
    const published = await publish(f, restored.id);
    check("发布响应返回同一事务实际保存的正文", published.page.content === "原始正文，恢复后继续编辑");
    check("恢复后继续编辑并发布成功", (await rest(`/pages/${f.first.id}`)).content === "原始正文，恢复后继续编辑" && published.publishedRevisionId !== restored.id);
    check("发布快照基线与房间一致", (await documents.loadDocument(f.roomId)).baseRevisionId === published.publishedRevisionId);
    check("恢复记录审计且提交后知识索引存在", (await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, f.first.id), eq(auditEntry.action, "wiki.restored")))).length === 1 && (await db.select().from(indexJob).where(eq(indexJob.pageId, f.first.id))).length > 0);
  });
  await scenario("元数据修改保留草稿", async () => {
    const f = await create("元数据不抹草稿");
    const draftResult = await draft(f, "，尚未发布");
    const metadata = await call("page.updateMetadata", { projectId: project.id, pageId: f.first.id, expectedRevisionId: f.second.currentRevisionId, title: "修改标题", userConfirmed: true });
    const state = await sync(f);
    check("metadata推进版本边界并保持未发布草稿", f.client.getText("content").toString() === "第二版正文，尚未发布" && state.sequence === draftResult.sequence + 1 && state.baseRevisionId === metadata.currentRevisionId);
    const published = await publish(f, metadata.currentRevisionId);
    check("metadata之后可发布原草稿且保留新标题", published.page.title === "修改标题" && (await rest(`/pages/${f.first.id}`)).content === "第二版正文，尚未发布");
  });
  await scenario("REST外部正文写入继续协作", async () => {
    const f = await create("REST外部正文替换");
    await draft(f, "，旧草稿");
    const external = await rest(`/pages/${f.first.id}`, "PATCH", { content: "外部替换正文", expectedRevisionId: f.second.currentRevisionId });
    const state = await sync(f);
    check("REST正文替换通过同一Y.Doc同步且基线更新", f.client.getText("content").toString() === "外部替换正文" && state.baseRevisionId === external.currentRevisionId);
    await draft(f, "，继续协作");
    await publish(f, external.currentRevisionId);
    check("REST外部更新后仍可发布新草稿", (await rest(`/pages/${f.first.id}`)).content === "外部替换正文，继续协作");
  });
  await scenario("REST恢复历史后继续协作", async () => {
    const f = await create("REST历史恢复");
    await draft(f, "，旧草稿");
    const restored = await rest(`/pages/${f.first.id}/revisions/${f.first.currentRevisionId}/restore`, "POST", {});
    const state = await sync(f);
    check("REST恢复同步旧客户端且推进基线", f.client.getText("content").toString() === "原始正文" && state.baseRevisionId === restored.id);
    await draft(f, "，REST恢复后编辑");
    await publish(f, restored.id);
    check("REST恢复后可继续发布", (await rest(`/pages/${f.first.id}`)).content === "原始正文，REST恢复后编辑");
  });
  await scenario("升级前分歧房间重新加入时修复", async () => {
    for (const contentChanged of [false, true]) {
      const f = await create(`旧房间${contentChanged ? "正文" : "元数据"}分歧`);
      await draft(f, "，旧房间草稿");
      // 仅在一次性数据库中模拟旧实现：页面新增版本，房间仍保留旧基线。
      const [revision] = await db.insert(pageRevision).values({ pageId: f.first.id, revisionNo: 3, content: contentChanged ? "升级前恢复正文" : "第二版正文", authorId: actor.memberId }).returning();
      await db.update(page).set({ currentRevisionId: revision!.id, title: "升级前标题" }).where(eq(page.id, f.first.id));
      const joined = await rest(`${f.path}/join`, "POST", { clientId: f.clientId });
      const state = await sync(f);
      check(`旧${contentChanged ? "正文" : "元数据"}分歧重入修复且保留正确草稿`, joined.room.baseRevisionId === revision!.id && state.baseRevisionId === revision!.id && f.client.getText("content").toString() === (contentChanged ? "升级前恢复正文" : "第二版正文，旧房间草稿"));
      await draft(f, "，修复后编辑");
      await publish(f, revision!.id);
      check(`旧${contentChanged ? "正文" : "元数据"}分歧修复后可发布`, (await rest(`/pages/${f.first.id}`)).content === `${contentChanged ? "升级前恢复正文" : "第二版正文，旧房间草稿"}，修复后编辑`);
    }
  });
  await scenario("MCP幂等发布提交后返回真实索引终态", async () => {
    const f = await create("MCP幂等索引");
    await draft(f, "，幂等发布");
    const args = { pageId: f.first.id, expectedRevisionId: f.second.currentRevisionId, userConfirmed: true, idempotencyKey: randomUUID() };
    const first = await call("collab.publishPage", args);
    const published = first.result;
    const jobs = await db.select().from(indexJob).where(eq(indexJob.pageId, f.first.id));
    const terminal = events.find(event => event.event === "collab.published" && event.data.revisionId === published.publishedRevisionId);
    check("幂等事务先标记QUEUED且提交后发送SUCCEEDED终态", first.replayed === false && published.indexing.status === "QUEUED" && (terminal?.data.indexing as { status?: string })?.status === "SUCCEEDED" && jobs.some(job => job.status === "SUCCEEDED"));
    const replay = await call("collab.publishPage", args);
    assert.deepEqual(replay.result, published);
    check("幂等重放不重复版本日志索引", replay.replayed === true && (await documents.loadDocument(f.roomId)).sequence === published.sequence && (await db.select().from(indexJob).where(eq(indexJob.pageId, f.first.id))).length === jobs.length);
    await inTransaction(async () => {
      deferAfterCommit(() => documents.finishPagePublication(actor, { pageId: f.first.id, revisionId: randomUUID(), roomId: f.roomId }));
    });
    const failure = events.filter(event => event.event === "collab.published" && event.data.pageId === f.first.id).at(-1);
    check("提交后索引异常通过终态事件报告FAILED", (failure?.data.indexing as { status?: string })?.status === "FAILED");
  });
  await scenario("无幂等键的MCP正文CAS失败不残留草稿", async () => {
    const f = await create("MCP失败保持状态");
    const before = await documents.loadDocument(f.roomId);
    await call("page.update", { pageId: f.first.id, expectedRevisionId: f.first.currentRevisionId, content: "不应残留的草稿", userConfirmed: true }, "VERSION_CONFLICT");
    assert.deepEqual(await documents.loadDocument(f.roomId), before);
    check("无幂等键CAS拒绝同时回滚CRDT增量", (await rest(`/pages/${f.first.id}`)).currentRevisionId === f.second.currentRevisionId);
    const published = (await call("page.update", { pageId: f.first.id, expectedRevisionId: f.second.currentRevisionId, content: "MCP直接发布正文", userConfirmed: true })).result;
    check("无幂等键正常发布正文及房间基线", (await sync(f)).baseRevisionId === published.publishedRevisionId && f.client.getText("content").toString() === "MCP直接发布正文");
  });
  await scenario("回滚不泄露事件索引或审计", async () => {
    const f = await create("事务回滚保留文档");
    await draft(f, "，保留草稿");
    const tables = ["page", "page_revision", "collab_room", "collab_snapshot", "collab_update", "audit_entry", "activity_entry", "index_job"];
    const snapshot = async () => Promise.all(tables.map(async table => (await sql.unsafe(`select to_jsonb(t) as row from "${table}" t order by id`)).map(row => row.row)));
    const before = await snapshot();
    const eventCount = events.length;
    await assert.rejects(inTransaction(async () => {
      await wiki.restoreRevision(actor, f.first.id, f.first.currentRevisionId, f.second.currentRevisionId);
      check("恢复在外层事务提交前不广播不启动索引", events.length === eventCount && (await db.select().from(indexJob)).length === before.at(-1)!.length);
      check("恢复审计与业务修改写入同一事务", (await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, f.first.id), eq(auditEntry.action, "wiki.restored")))).length === 1);
      throw new Error("ROLLBACK_FIXTURE");
    }), /ROLLBACK_FIXTURE/);
    assert.deepEqual(await snapshot(), before);
    check("外层回滚撤销版本、CRDT、索引、审计及广播", events.length === eventCount);
  });
  await scenario("并发读取的正文和基线属于同一版本", async () => {
    const f = await create("读取一致性");
    let completed = false, readCount = 0;
    const writer = (async () => {
      let expectedRevisionId = f.second.currentRevisionId;
      for (let i = 0; i < 8; i++) {
        const next = await rest(`/pages/${f.first.id}`, "PATCH", { content: `并发发布正文${i}`, expectedRevisionId });
        expectedRevisionId = next.currentRevisionId;
      }
    })().finally(() => { completed = true; });
    try {
      while (!completed || readCount < 8) {
        const state = await documents.loadDocument(f.roomId);
        const revision = (await db.select().from(pageRevision).where(eq(pageRevision.id, state.baseRevisionId!)))[0]!;
        assert.equal(documents.decodeDocumentState(state.state).getText("content").toString(), revision.content);
        readCount++;
      }
    } finally { await writer; }
    check("并发读写没有旧基线与新正文混合", readCount >= 8);
    const [emptyRoom] = await db.insert(collabRoom).values({ resourceType: "PLAN", resourceId: randomUUID(), projectId: project.id, mode: "COMMAND" }).returning();
    const empty = await documents.loadDocument(emptyRoom!.id);
    check("无快照COMMAND房间返回空state和null基线", empty.state.byteLength === 0 && empty.sequence === 0 && empty.baseRevisionId === null);
  });
  await scenario("发布锁顺序与外部修改一致", async () => {
    const f = await create("锁顺序验收");
    let pending!: Promise<unknown>;
    let updatedRevision = "";
    await inTransaction(async () => {
      await lockProjectTree(project.id);
      const [{ pid }] = await sql`select pg_backend_pid() as pid`;
      pending = rest(`${f.path}/publish`, "POST", { expectedRevisionId: f.second.currentRevisionId, userConfirmed: true }, 409);
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const rows = await sql`select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`;
        blocked = rows.length > 0;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      check("发布请求实际等待项目锁", blocked);
      const [{ acquired }] = await sql`select pg_try_advisory_xact_lock(hashtextextended(${f.roomId},0)) as acquired`;
      check("发布在等待项目锁时尚未持有房间锁", acquired);
      const updated = await wiki.updatePage(actor, f.first.id, { content: "并发外部写入胜出", expectedRevisionId: f.second.currentRevisionId });
      updatedRevision = updated.currentRevisionId!;
    }).finally(async () => { if (pending) await pending; });
    const rejected = await pending as { code: string };
    check("外部写入先提交时并发旧基线发布被CAS拒绝", rejected.code === "VERSION_CONFLICT" && (await sync(f)).baseRevisionId === updatedRevision && f.client.getText("content").toString() === "并发外部写入胜出");
    await draft(f, "，冲突后继续编辑");
    await publish(f, updatedRevision);
    check("并发冲突后读取新基线可继续发布", (await rest(`/pages/${f.first.id}`)).content === "并发外部写入胜出，冲突后继续编辑");
  });
  console.log(`文档CRDT版本闭环 ${checks}通过/${failures}失败`);
  if (failures) process.exitCode = 1;
} finally { unsubscribe(); await app.close(); await sql.end({ timeout: 5 }); }
