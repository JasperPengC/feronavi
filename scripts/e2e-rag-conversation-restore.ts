/** 真实系统备份→上传→预检→确认→worker恢复；仅允许随机隔离库。 */
import "./_env.ts";
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, page, ragConversation, ragMessage, role, roleAssignment, setting, setupState, systemRestore } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { createProject } from "../src/server/services/project.service.ts";
import { createPage, setPermissions } from "../src/server/services/wiki.service.ts";
import { reindexPage } from "../src/server/services/knowledge.service.ts";
import { putSettings } from "../src/server/services/setting.service.ts";
import * as conversations from "../src/server/services/rag-conversation.service.ts";
import { masterKey, resetKeyCache } from "../src/server/services/crypto.service.ts";
import { createEncryptionEnvelope } from "../src/server/services/system-backup/crypto.ts";
import { exportSystemBackup } from "../src/server/services/system-backup/exporter.ts";
import { writeTemporaryKeyHandle } from "../src/server/services/system-backup/storage.ts";
import { authenticateAndReadManifest } from "../src/server/services/system-backup/restore-archive.ts";
import { assertBusinessEmpty, preflightRestore, restoreOwnerHash, streamRestoreUpload } from "../src/server/services/system-backup/validator.ts";
import { confirmSystemRestore } from "../src/server/services/system-backup/importer.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
const isolationRoot = process.env.FERONAVI_TEST_DIRECTORY;
assert.ok(isolationRoot && process.env.DATA_DIR, "必须经随机隔离runner执行");
const sourceDataDir = resolve(process.env.DATA_DIR!);
assert.ok(sourceDataDir.startsWith(`${resolve(isolationRoot)}${sep}`), "数据目录必须在本次隔离目录内");
const realFetch = globalThis.fetch;
const password = "synthetic-rag-restore-password-2026";
const ownerSessionHash = restoreOwnerHash(randomBytes(32).toString("base64url"));
const request = (question = "银桥月结") => ({ requestId: randomUUID(), question });
const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
let passed = 0, providerFailure = false;
const check = (name: string, condition: unknown) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [owner] = await db.insert(member).values({ username: "rag_restore_owner", name: "合成恢复所有者", passwordHash: await hashPassword(password), status: "ACTIVE" }).returning();
  const [other] = await db.insert(member).values({ username: "rag_restore_other", name: "合成另一个账号", passwordHash: "no-login", status: "ACTIVE" }).returning();
  await db.insert(roleAssignment).values({ memberId: owner!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(owner!.id))!;
  const a = await createProject(actor, { key: "RAGRESTOREA", name: "恢复甲项目" }), b = await createProject(actor, { key: "RAGRESTOREB", name: "恢复乙项目" });
  await db.delete(setting).where(inArray(setting.key, ["ai.enabled", "ai.baseUrl", "ai.model", "ai.apiKey", "ai.chatModel", "ai.chatBaseUrl", "ai.chatApiKey"]));
  const pageA = (await createPage(actor, a.id, { title: "银桥月结公开规则", content: "# 银桥月结\n银桥月结每月第三个工作日完成。" }))!;
  const pageB = (await createPage(actor, b.id, { title: "银桥月结私有规则", content: "# 银桥月结\n恢复私有摘录，银桥月结乙项目第七个工作日完成。" }))!;
  for (const p of [pageA, pageB]) await reindexPage(actor, p.id, "FULL", { skipEmbedding: true });
  await putSettings({ "ai.chatBaseUrl": "https://1.1.1.1/v1", "ai.chatModel": "synthetic-rag-restore" });
  globalThis.fetch = (async (_url,init) => {
    const body=JSON.parse(String(init?.body??'{}')) as {stream:boolean;tools?:unknown[];messages:{role:string;content:string}[]};assert.equal(body.stream,true);
    const firstTurn=!!body.tools?.length&&!body.messages.some(m=>m.role==='tool');
    const projectId=/"id":"([^"]+)"/u.exec(body.messages[0]!.content)?.[1];
    const question=body.messages.filter(m=>m.role==='user').at(-1)?.content??'银桥月结';
if(providerFailure)return new Response('synthetic unavailable',{status:503});
    const delta=firstTurn?{tool_calls:[{index:0,id:'knowledge-read',type:'function',function:{name:'knowledge_search',arguments:JSON.stringify({projectId,q:question,limit:5})}}]}:body.tools?.length?{content:'规划，不输出'}:{content:'银桥月结按照本项目规则完成 [1]。'};
    return new Response(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }) as typeof fetch;
  const active = await conversations.createConversation(actor, { projectId: a.id });
  const deleted = await conversations.createConversation(actor, { projectId: b.id, title: "手工命名的已删除会话" });
  const untouched = await conversations.createConversation(actor, { projectId: a.id });
  const activeMessage = await conversations.sendMessage(actor, active.id, request());
  const deletedMessage = await conversations.sendMessage(actor, deleted.id, request());
  providerFailure = true; const failedMessage = await conversations.sendMessage(actor, active.id, request("银桥月结供应商失败轮")); providerFailure = false;
  const cancelledRequest = request("取消先到保留的问题");
  await conversations.cancelMessage(actor, untouched.id, cancelledRequest.requestId);
  await conversations.sendMessage(actor, untouched.id, cancelledRequest);
  const [pending] = await db.insert(ragMessage).values({ conversationId: untouched.id, ...request("恢复前中断的等待轮"), status: "pending", updatedAt: new Date(0) }).returning();
  await conversations.updateConversation(actor, deleted.id, { deleted: true });
  // 先撤销来源读权再备份：系统包保留原始快照，业务恢复不能因此重新泄露。
  await db.update(page).set({ visibility: "RESTRICTED" }).where(eq(page.id, pageB.id));
  await setPermissions(actor, pageB.id, [{ principalType: "MEMBER", principalId: other!.id, canRead: true, canWrite: false }]);
  check("源会话含真实RAG回复、失败、取消、pending与软删", activeMessage.message.status === "completed" && !!activeMessage.message.reply?.answer && deletedMessage.message.status === "completed" && failedMessage.message.status === "failed");
  const sourceConversations = normalize(await db.select().from(ragConversation).orderBy(asc(ragConversation.id)));
  const sourceMessages = normalize(await db.select().from(ragMessage).orderBy(asc(ragMessage.id)));
  const sourceVisible = await conversations.getConversation(actor, active.id), sourceHidden = await conversations.getConversation(actor, deleted.id);
  check("源失权会话投影清空回复，原始备份数据仍有答案", sourceHidden.messages[0]?.status === "unavailable" && sourceHidden.messages[0]?.reply === null && !!deletedMessage.message.reply?.answer);
  const packages = new Map<"safe" | "full", string>();
  for (const mode of ["full", "safe"] as const) {
    const backupId = randomUUID(), envelope = await createEncryptionEnvelope(password);
    try {
      const handle = await writeTemporaryKeyHandle(backupId, envelope.dataKey);
      const exported = await exportSystemBackup({ backupId, mode, requestedBy: actor.memberId, dataKeyHandle: handle.handle, keyEnvelope: envelope.keyEnvelope });
      packages.set(mode, exported.packagePath);
      const verified = await authenticateAndReadManifest(exported.packagePath, password);
      try {
        const c = verified.manifest.datasets.find(d => d.name === "operations.rag_conversation"), m = verified.manifest.datasets.find(d => d.name === "operations.rag_message");
        check(`${mode}真实加密系统包包含会话和消息dataset`, exported.bytes > 0 && c?.rows === 3 && m?.rows === 5 && m.dependsOn.includes("operations.rag_conversation"));
      } finally { verified.dataKey.fill(0); }
    } finally { envelope.dataKey.fill(0); }
  }
  registerBuiltinJobHandlers();
  for (const mode of ["full", "safe"] as const) {
    // 仅截断本脚本经runner创建的随机库；所有源文件在隔离目录下保留供上传。
    assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
    const names = (await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname='public'`).map(row => row.tablename);
    await sql`truncate table ${sql(names)} restart identity cascade`;
    process.env.DATA_DIR = join(sourceDataDir, `${mode}-restore-target`); resetKeyCache(); masterKey();
    await assertBusinessEmpty();
    const uploaded = await streamRestoreUpload(createReadStream(packages.get(mode)!), ownerSessionHash);
    assert.equal(uploaded.status, "UPLOADED");
    const preflighted = await preflightRestore(uploaded.id, password);
    assert.equal(preflighted.status, "PREFLIGHT_PASSED");
    await confirmSystemRestore(uploaded.id, password);
    const stats = await runJobWorkerOnce(`rag-conversation-${mode}-restore`, 1);
    assert.equal(stats.succeeded, 1, JSON.stringify(stats));
    const [record] = await db.select().from(systemRestore).where(eq(systemRestore.id, uploaded.id));
    const [setup] = await db.select().from(setupState).limit(1);
    check(`${mode}真实上传预检确认worker恢复提交成功`, record?.status === "SUCCEEDED" && !!setup?.initializedAt && setup.restoredPackageId === record.packageId);
    assert.deepEqual(normalize(await db.select().from(ragConversation).orderBy(asc(ragConversation.id))), sourceConversations);
    check(`${mode}owner/project/title/titleIsDefault/软删与时间完整恢复`, true);
    assert.deepEqual(normalize(await db.select().from(ragMessage).orderBy(asc(ragMessage.id))), sourceMessages);
    check(`${mode}消息requestId/status/reply/时间逐字段完整恢复`, true);
    const restoredActor = (await loadActor(actor.memberId))!, restoredOther = (await loadActor(other!.id))!;
    const visible = await conversations.getConversation(restoredActor, active.id), hidden = await conversations.getConversation(restoredActor, deleted.id);
    assert.deepEqual(visible, sourceVisible); assert.deepEqual(hidden, sourceHidden);
    check(`${mode}恢复后读取权限投影与源一致且失权回复不泄漏`, hidden.messages[0]?.status === "unavailable" && hidden.messages[0]?.reply === null && visible.messages.some(m => m.reply?.answer));
    const recycled = await conversations.getConversation(restoredActor, untouched.id);
    check(`${mode}恢复pending轮可回收且保留默认标题与取消问题`, recycled.conversation.title === "新对话" && recycled.messages.find(m => m.id === pending!.id)?.status === "failed" && recycled.messages.some(m => m.question === cancelledRequest.question && m.status === "cancelled"));
    await assert.rejects(() => conversations.getConversation(restoredOther, active.id), { code: "NOT_FOUND" });
    const exportedPersonal = await conversations.exportConversationData(restoredActor);
    check(`${mode}恢复所有权不串账号且个人导出继续隐藏失权快照`, exportedPersonal.conversations.length === 3 && exportedPersonal.messages.find(m => m.id === deletedMessage.message.id)?.reply === null && (await conversations.exportConversationData(restoredOther)).conversations.length === 0);
    const restored = await conversations.updateConversation(restoredActor, deleted.id, { deleted: false });
    check(`${mode}软删除会话恢复后原消息与固定范围仍在`, restored.deletedAt === null && restored.projectId === b.id && (await conversations.getConversation(restoredActor, deleted.id)).messages[0]?.id === deletedMessage.message.id);
  }
  console.log(`RAG会话真实系统备份恢复：${passed}项通过（full+safe完整恢复链路，合成模型传输）`);
} finally {
  globalThis.fetch = realFetch; process.env.DATA_DIR = sourceDataDir; resetKeyCache(); await closeCache(); await sql.end();
}
