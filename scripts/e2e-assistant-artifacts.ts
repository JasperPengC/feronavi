/** 真正 HTTP、会话/令牌、随机隔离数据库的助手文件与凭据边界验收。 */
import assert from "node:assert/strict";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../src/db/index.ts");
const schema = await import("../src/db/schema.ts");
const { member, role, roleAssignment, apiToken, project: projectTable } = schema;
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../src/server/auth/actor-loader.ts");
const { createProject } = await import("../src/server/services/project.service.ts");
const { createSession } = await import("../src/server/auth/session.ts");
const { createToken, authenticateToken } = await import("../src/server/services/token.service.ts");
const { closeCache } = await import("../src/server/auth/cache.ts");
const { ensureInitialized } = await import("./_test-helpers.ts");
const { buildApp } = await import("../src/server/app.ts");
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL ${name}: ${(error as Error).message}`); }
}
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person, other] = await db.insert(member).values([
    { username: "artifact-owner", name: "资料所有者", passwordHash: "no-login", status: "ACTIVE", mustChangePassword: false },
    { username: "artifact-other", name: "其他成员", passwordHash: "no-login", status: "ACTIVE", mustChangePassword: false },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(person!.id))!;
  const otherActor = (await loadActor(other!.id))!;
  const first = await createProject(actor, { key: "ARTONE", name: "文件范围一" });
  const second = await createProject(actor, { key: "ARTTWO", name: "文件范围二" });
  app = await buildApp({ logger: false });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const session = await createSession({ memberId: person!.id });
  const csrfResponse = await fetch(`${base}/api/v1/auth/csrf`, { headers: { cookie: `feronavi_session=${session.token}` } });
  const csrfCookie = csrfResponse.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const csrfToken = (await csrfResponse.json() as { csrfToken: string }).csrfToken;
  const browserHeaders = { cookie: `feronavi_session=${session.token}; ${csrfCookie}`, "x-csrf-token": csrfToken };
  async function upload(projectIds = [first.id], data = Buffer.from("文件字节不会进入模型上下文"), options: { filename?: string; mimeType?: string; headers?: Record<string, string> } = {}) {
    const form = new FormData();
    form.append("projectIds", JSON.stringify(projectIds));
    form.append("file", new Blob([new Uint8Array(data)], { type: options.mimeType ?? "text/plain" }), options.filename ?? "fixture.txt");
    return fetch(`${base}/api/v1/rag/artifacts/files`, { method: "POST", headers: options.headers ?? browserHeaders, body: form });
  }
  async function credential(input: Record<string, unknown> = {}, headers = browserHeaders) {
    return fetch(`${base}/api/v1/rag/artifacts/credentials`, { method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ token: "fixture-credential-opaque-channel", projectIds: [first.id], kind: "GITHUB", baseUrl: "https://1.1.1.1", ...input }) });
  }
  let fileId = "", credentialRef = "";
  await check("真实multipart直传返回元数据且数据库只存密文", async () => {
    const bytes = Buffer.from("文件字节不会进入模型上下文");
    const response = await upload([first.id], bytes);
    assert.equal(response.status, 201);
    const result = await response.json() as { artifactId: string; filename: string; mimeType: string; sizeBytes: number; allowedProjectIds: string[]; expiresAt: string };
    fileId = result.artifactId; assert.match(fileId, /^[a-f0-9-]{36}$/u);
    assert.equal(result.filename, "fixture.txt"); assert.equal(result.sizeBytes, bytes.length);
    assert.deepEqual(result.allowedProjectIds, [first.id]);
    assert.ok(Date.parse(result.expiresAt) > Date.now());
    assert.equal(JSON.stringify(result).includes(bytes.toString("base64")), false);
    const [stored] = await sql`select payload_encrypted from assistant_artifact where id=${fileId}`;
    assert.match(stored!.payload_encrypted, /^enc:v1:/u);
    assert.equal(stored!.payload_encrypted.includes(bytes.toString("base64")), false);
    const { resolveAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    const resolved = await resolveAssistantFile(actor, fileId, first.id);
    assert.deepEqual(Buffer.from(resolved.contentBase64, "base64"), bytes);
  });
  await check("凭据专用JSON直配仅返回不透明引用并绑定目标", async () => {
    const response = await credential(); assert.equal(response.status, 201);
    const result = await response.json() as { credentialRef: string; allowedProjectIds: string[] };
    credentialRef = result.credentialRef;
    assert.deepEqual(result.allowedProjectIds, [first.id]);
    assert.equal(JSON.stringify(result).includes("fixture-credential"), false);
    const { resolveAssistantCredential, resolveAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    assert.equal(await resolveAssistantCredential(actor, credentialRef, first.id, undefined, { kind: "GITHUB", baseUrl: "https://1.1.1.1/" }), "fixture-credential-opaque-channel");
    await assert.rejects(resolveAssistantCredential(actor, credentialRef, first.id, undefined, { kind: "GITLAB", baseUrl: "https://1.1.1.1" }), { code: "NOT_FOUND" });
    await assert.rejects(resolveAssistantCredential(actor, credentialRef, first.id, undefined, { kind: "GITHUB", baseUrl: "https://8.8.8.8" }), { code: "NOT_FOUND" });
    await assert.rejects(resolveAssistantFile(actor, credentialRef, first.id), { code: "NOT_FOUND" });
    await assert.rejects(resolveAssistantCredential(actor, fileId, first.id, undefined, { kind: "GITHUB", baseUrl: "https://1.1.1.1" }), { code: "NOT_FOUND" });
  });
  await check("本轮资料描述只返回选中范围交集的元信息且不解密内容", async () => {
    const { describeAssistantArtifacts, createAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    const multi = await createAssistantFile(actor, { filename: "scope.txt", mimeType: "text/plain", data: Buffer.from("metadata-only"), projectIds: [first.id, second.id] });
    const description = await describeAssistantArtifacts(actor, { artifactIds: [multi.artifactId], credentialRefs: [credentialRef] }, [first.id]);
    assert.deepEqual(description.files[0]!.allowedProjectIds, [first.id]);
    assert.equal(description.files[0]!.filename, "scope.txt");
    assert.equal(description.credentials[0]!.kind, "GITHUB");
    assert.equal(description.credentials[0]!.baseUrl, "https://1.1.1.1");
    assert.equal(JSON.stringify(description).includes("fixture-credential"), false);
    assert.equal(JSON.stringify(description).includes("contentBase64"), false);
    await assert.rejects(describeAssistantArtifacts(actor, { artifactIds: [fileId] }, [second.id]), { code: "NOT_FOUND" });
    await assert.rejects(describeAssistantArtifacts(actor, { artifactIds: [credentialRef] }, [first.id]), { code: "NOT_FOUND" });
    await assert.rejects(describeAssistantArtifacts(actor, { credentialRefs: [fileId] }, [first.id]), { code: "NOT_FOUND" });
    await assert.rejects(describeAssistantArtifacts(otherActor, { artifactIds: [fileId] }, [first.id]), { code: "NOT_FOUND" });
    await assert.rejects(describeAssistantArtifacts(actor, { artifactIds: [fileId] }, []), { code: "NOT_FOUND" });
    assert.deepEqual(await describeAssistantArtifacts(actor, {}, []), { files: [], credentials: [] });
  });
  await check("禁用外联工具不能通过历史建议与凭据引用恢复执行", async () => {
    const { randomUUID } = await import("node:crypto");
    const { createIntegration, listIntegrations } = await import("../src/server/services/integration.service.ts");
    const { assistantRegistry } = await import("../src/server/services/assistant-tools.ts");
    const conversations = await import("../src/server/services/rag-conversation.service.ts");
    const integration = await createIntegration(actor, { projectId: first.id, kind: "GITHUB", name: "禁用能力验收", baseUrl: "https://1.1.1.1", token: "fixture-before-rebind", config: { repo: "fixture/disabled-check" } });
    assert.equal((await assistantRegistry()).some(row => /^(integration|webhook|im)\./u.test(row.name)), false);
    const action: import("../src/shared/rag.ts").RagActionProposal = {
      id: randomUUID(), toolName: "integration.update", projectId: first.id, targetId: null, expectedVersion: null,
      parameters: { projectId: first.id, integrationId: integration.id, credentialRef }, status: "pending",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const conversation = await conversations.createConversation(actor, { projectId: first.id });
    const requestId = randomUUID();
    await db.insert(schema.ragMessage).values({ conversationId: conversation.id, requestId, question: "历史集成凭据修改", status: "completed", requestMetadata: { credentialRefs: [credentialRef] }, reply: { ok: true, answer: "历史建议", citations: [], mode: "none", scope: { projectIds: [first.id], projectCount: 1 }, actions: [action] } });
    for (let replay = 0; replay < 2; replay++) {
      const response = await fetch(base + "/api/v1/rag/conversations/" + conversation.id + "/requests/" + requestId + "/actions/" + action.id, { method: "POST", headers: { ...browserHeaders, "content-type": "application/json" }, body: JSON.stringify({ decision: "confirm" }) });
      const body = await response.json() as { code: string };
      assert.equal(response.status, 403, JSON.stringify(body));
      assert.equal(body.code, "NOT_FOUND");
      assert.equal(JSON.stringify(body).includes("fixture-credential"), false);
    }
    const current = (await listIntegrations(actor, first.id)).find(row => row.id === integration.id)!;
    assert.equal(current.baseUrl, "https://1.1.1.1");
    const [stored] = await db.select().from(schema.ragMessage).where(eq(schema.ragMessage.requestId, requestId));
    assert.equal(stored!.reply!.actions![0]!.status, "pending");
  });
  await check("上传范围必须明确且最多20项目，类型和字节数受限", async () => {
    assert.equal((await upload([])).status, 400);
    assert.equal((await upload(Array(21).fill(first.id))).status, 400);
    assert.equal((await upload([first.id], Buffer.alloc(0))).status, 400);
    assert.equal((await upload([first.id], Buffer.from("bad"), { filename: "fixture.exe" })).status, 400);
    assert.equal((await upload([first.id], Buffer.from("bad"), { filename: "fixture.txt", mimeType: "image/png" })).status, 400);
    assert.equal((await upload([first.id], Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await credential({ projectIds: [] })).status, 400);
    assert.equal((await credential({ baseUrl: "https://127.0.0.1" })).status, 400);
  });
  await check("所有者/项目快照/TTL边界和浏览器CSRF不能绕过", async () => {
    const { resolveAssistantFile, resolveAssistantCredential } = await import("../src/server/services/assistant-artifact.service.ts");
    await assert.rejects(resolveAssistantFile(otherActor, fileId, first.id), { code: "NOT_FOUND" });
    await assert.rejects(resolveAssistantFile(actor, fileId, second.id), { code: "NOT_FOUND" });
    await assert.rejects(resolveAssistantCredential(otherActor, credentialRef, first.id, undefined, { kind: "GITHUB", baseUrl: "https://1.1.1.1" }), { code: "NOT_FOUND" });
    assert.equal((await upload([first.id], undefined, { headers: { cookie: browserHeaders.cookie } })).status, 403);
    assert.equal((await credential({}, { cookie: browserHeaders.cookie } as typeof browserHeaders)).status, 403);
    await sql`update assistant_artifact set expires_at=now()-interval '1 second' where id=${fileId}`;
    await assert.rejects(resolveAssistantFile(actor, fileId, first.id), { code: "NOT_FOUND" });
  });
  await check("令牌原范围不可因扩权放大且撤销/降级/缩范围实时生效", async () => {
    const issued = await createToken(actor, { name: "artifact-token", tier: "READ_WRITE", projectWhitelist: [first.id] });
    const identity = (await authenticateToken(issued.token, null))!;
    const response = await upload([first.id], undefined, { headers: { authorization: `Bearer ${issued.token}` } });
    assert.equal(response.status, 201);
    const id = (await response.json() as { artifactId: string }).artifactId;
    const { resolveAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    await db.update(apiToken).set({ projectWhitelist: [] }).where(eq(apiToken.id, identity.ctx.tokenId));
    await assert.rejects(resolveAssistantFile(actor, id, second.id, identity.ctx), { code: "NOT_FOUND" });
    await db.update(apiToken).set({ projectWhitelist: [second.id] }).where(eq(apiToken.id, identity.ctx.tokenId));
    await assert.rejects(resolveAssistantFile(actor, id, first.id, identity.ctx), { code: "NOT_FOUND" });
    await db.update(apiToken).set({ projectWhitelist: [first.id], tier: "READ_ONLY" }).where(eq(apiToken.id, identity.ctx.tokenId));
    await assert.rejects(resolveAssistantFile(actor, id, first.id, identity.ctx), { code: "NOT_FOUND" });
    assert.equal((await upload([first.id], undefined, { headers: { authorization: `Bearer ${issued.token}` } })).status, 403);
    await db.update(apiToken).set({ tier: "READ_WRITE", revokedAt: new Date() }).where(eq(apiToken.id, identity.ctx.tokenId));
    await assert.rejects(resolveAssistantFile(actor, id, first.id), { code: "NOT_FOUND" });
  });
  await check("当前调用令牌范围与成员/项目实时状态独立收紧", async () => {
    const fresh = await upload([first.id]); assert.equal(fresh.status, 201);
    const id = (await fresh.json() as { artifactId: string }).artifactId;
    const issued = await createToken(actor, { name: "artifact-current-scope", tier: "READ_WRITE", projectWhitelist: [second.id] });
    const identity = (await authenticateToken(issued.token, null))!;
    const { resolveAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    await assert.rejects(resolveAssistantFile(actor, id, first.id, identity.ctx), { code: "NOT_FOUND" });
    await db.update(projectTable).set({ archivedAt: new Date() }).where(eq(projectTable.id, first.id));
    await assert.rejects(resolveAssistantFile(actor, id, first.id), { code: "NOT_FOUND" });
    await db.update(projectTable).set({ archivedAt: null }).where(eq(projectTable.id, first.id));
    await db.update(member).set({ status: "DISABLED" }).where(eq(member.id, actor.memberId));
    await assert.rejects(resolveAssistantFile(actor, id, first.id), { code: "NOT_FOUND" });
    await db.update(member).set({ status: "ACTIVE" }).where(eq(member.id, actor.memberId));
  });
  await check("凭据到期不解密且删除暂存资料也受当前令牌写权限限制", async () => {
    const { resolveAssistantCredential, resolveAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    await sql`update assistant_artifact set expires_at=now()-interval '1 second' where id=${credentialRef}`;
    await assert.rejects(resolveAssistantCredential(actor, credentialRef, first.id, undefined, { kind: "GITHUB", baseUrl: "https://1.1.1.1" }), { code: "NOT_FOUND" });
    const fresh = await upload([first.id]); assert.equal(fresh.status, 201);
    const id = (await fresh.json() as { artifactId: string }).artifactId;
    const issued = await createToken(actor, { name: "artifact-delete-readonly", tier: "READ_ONLY", projectWhitelist: [first.id] });
    const denied = await fetch(`${base}/api/v1/rag/artifacts/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${issued.token}` } });
    assert.ok(denied.status === 403 || denied.status === 404);
    assert.ok((await resolveAssistantFile(actor, id, first.id)).contentBase64);
    const removed = await fetch(`${base}/api/v1/rag/artifacts/${id}`, { method: "DELETE", headers: browserHeaders });
    assert.equal(removed.status, 200);
    await assert.rejects(resolveAssistantFile(actor, id, first.id), { code: "NOT_FOUND" });
  });
  await check("系统备份注册表完整覆盖新表且两种模式均排除临时秘密", async () => {
    const { classifyDatabaseTable, orderedDatasets } = await import("../src/server/services/system-backup/registry.ts");
    const { getTableName, isTable } = await import("drizzle-orm");
    assert.equal(classifyDatabaseTable("assistant_artifact"), "exclude");
    for (const value of Object.values(schema)) if (isTable(value)) assert.ok(classifyDatabaseTable(getTableName(value)), `未分类数据表 ${getTableName(value)}`);
    for (const mode of ["safe", "full"] as const) assert.equal(orderedDatasets(mode).some(dataset => dataset.tableName === "assistant_artifact"), false);
    const messages = await sql`select question, reply, request_metadata from rag_message`;
    assert.equal(JSON.stringify(messages).includes("fixture-credential"), false);
    assert.equal(JSON.stringify(messages).includes("fixture-before-rebind"), false);
  });
  await check("不接受被替换为明文的暂存内容或损坏密文", async () => {
    const fresh = await upload([first.id]); assert.equal(fresh.status, 201);
    const id = (await fresh.json() as { artifactId: string }).artifactId;
    const { resolveAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    const [stored] = await sql`select payload_encrypted from assistant_artifact where id=${id}`;
    await sql`update assistant_artifact set payload_encrypted=${JSON.stringify({ contentBase64: Buffer.from("文件字节不会进入模型上下文").toString("base64") })} where id=${id}`;
    await assert.rejects(resolveAssistantFile(actor, id, first.id), { code: "NOT_FOUND" });
    await sql`update assistant_artifact set payload_encrypted=${stored!.payload_encrypted + "tampered"} where id=${id}`;
    await assert.rejects(resolveAssistantFile(actor, id, first.id), { code: "NOT_FOUND" });
  });
  await check("所有者暂存配额有界且过期资料被清理释放空间", async () => {
    const { createAssistantFile } = await import("../src/server/services/assistant-artifact.service.ts");
    const [existing] = await sql`select count(*)::int as count from assistant_artifact where owner_id=${actor.memberId} and expires_at>now()`;
    const input = { filename: "quota.txt", mimeType: "text/plain", data: Buffer.from("quota"), projectIds: [first.id] };
    for (let index = existing!.count; index < 20; index++) await createAssistantFile(actor, input);
    await assert.rejects(createAssistantFile(actor, input), { code: "VALIDATION" });
    await sql`update assistant_artifact set expires_at=now()-interval '1 second' where owner_id=${actor.memberId}`;
    const replacement = await createAssistantFile(actor, input);
    assert.ok(replacement.artifactId);
    assert.equal((await sql`select count(*)::int as count from assistant_artifact where owner_id=${actor.memberId}`)[0]!.count, 1);
  });
  assert.deepEqual(failures, [], "助手artifact边界回归失败");
} finally { await app?.close(); await closeCache(); await sql.end({ timeout: 5 }); }
