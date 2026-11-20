import "./_env.ts";
/** 与MCP同一21场景：读走助手授权执行器；写只能由持久化会话的真实HTTP确认触发。 */
/* eslint-disable @typescript-eslint/no-explicit-any -- 隔离E2E按各业务真实JSON断言 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { buildApp } from "../src/server/app.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as repo from "../src/server/repos/rag-conversation.repo.ts";
import { assistantRegistry, executeAssistantTool, proposeAssistantAction } from "../src/server/services/assistant-tools.ts";
import { listRagProjects } from "../src/server/services/rag-projects.ts";
import { projectForMcpResource } from "../src/server/services/mcp-resource.service.ts";
import { registerAssistantExternalActionJobs } from "../src/server/services/assistant-external-action.service.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import { BUSINESS_WORKFLOWS } from "../src/server/application/capabilities/intelligence-tools.ts";
import type { RagActionProposal } from "../src/shared/rag.ts";
import { createFullBusinessWorkflows } from "./support/full-business-workflows.ts";
import { ensureInitialized } from "./_test-helpers.ts";

type Json = Record<string, any>;
type Evidence = { id: string; calls: { tool: string; ok: boolean; kind: string; expectedError?: string }[]; assertions: number; status: string; error?: string };
const evidence: Evidence[] = [];
let active: Evidence;
let assertions = 0, httpConfirmations = 0, proposals = 0, downloads = 0, uploads = 0;
const proof = (condition: unknown, label: string) => { assert.ok(condition, `${active.id}: ${label}`); assertions++; active.assertions++; };
const equal = (actual: unknown, expected: unknown, label: string) => { assert.deepEqual(actual, expected, `${active.id}: ${label}`); assertions++; active.assertions++; };
const username = "assistant-full-admin", password = "isolated-workflows-password-12345";
await ensureInitialized();
const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select().from(role).where(eq(role.key, "MEMBER"));
const [admin, colleague] = await db.insert(member).values([
  { username, email: "assistant-full-admin@test.invalid", name: "助手全流程管理员", passwordHash: await hashPassword(password), status: "ACTIVE", timezone: "UTC" },
  { username: "assistant-full-colleague", name: "全流程协作者", passwordHash: "test-fixture-only", status: "ACTIVE", timezone: "UTC" },
]).returning();
await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG" });
const actor = (await loadActor(admin!.id))!;
const bearer = (await tokens.createToken(actor, { name: "助手全21业务验收", tier: "ADMIN" })).token;
const readOnly = (await tokens.createToken(actor, { name: "只读反控", tier: "READ_ONLY" })).token;
const app = await buildApp({ logger: false });
const base = await app.listen({ port: 0, host: "127.0.0.1" });
registerAssistantExternalActionJobs();
const registry = await assistantRegistry();
const captures = new Map<string, { value?: any; error?: any }[]>();
const writeCount = () => [...captures.values()].reduce((count, rows) => count + rows.length, 0);
const originals = new Map(registry.map(tool => [tool, tool.handler]));
// 只观测确认层调用同一个guarded handler的真实返回；适配器从不直接调用写handler。
for (const tool of registry.filter(t => t.kind === "write")) {
  const original = tool.handler;
  captures.set(tool.name, []);
  tool.handler = async (ctx, args) => {
    const entry: { value?: any; error?: any } = {}; captures.get(tool.name)!.push(entry);
    try { entry.value = await original(ctx, args); return entry.value; }
    catch (error) { entry.error = error; throw error; }
  };
}
type Stored = { conversationId: string; requestId: string; action: RagActionProposal; raw: any };
const idempotent = new Map<string, Stored>();
async function confirm(stored: Pick<Stored, "conversationId" | "requestId" | "action">, token: string) {
  httpConfirmations++;
  const response = await fetch(`${base}/api/v1/rag/conversations/${stored.conversationId}/requests/${stored.requestId}/actions/${stored.action.id}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ decision: "confirm" }),
  });
  const value = await response.json() as Json;
  if (response.status !== 200) throw Object.assign(new Error(value.error?.message ?? value.message ?? `确认HTTP ${response.status}`), { code: value.error?.code ?? value.code ?? `HTTP_${response.status}` });
  if (!value.message?.reply) {
    const message = await repo.findMessage(stored.conversationId, stored.requestId);
    assert.ok(message?.reply, "确认必须保留持久化回复");
    const { assertAssistantReplyReadable } = await import("../src/server/services/assistant-access.ts");
    await assertAssistantReplyReadable(actor, message.reply, (await listRagProjects(actor, undefined, true)).map(p => p.id));
    assert.fail("确认后的回复未通过HTTP可读性投影");
  }
  return value.message.reply.actions.find((a: Json) => a.id === stored.action.id) as RagActionProposal;
}
async function references(name: string, input: Json, token: string) {
  const args = { ...input }, artifactIds: string[] = [], credentialRefs: string[] = [];
  if (name === "attachment.upload" || name === "import.create") {
    const projectId = args.projectId ?? await projectForMcpResource("workItem", args.targetId);
    assert.ok(projectId, "文件必须属于实际项目");
    const form = new FormData(); form.append("projectIds", JSON.stringify([projectId]));
    form.append("file", new Blob([Buffer.from(args.dataBase64 ?? args.contentBase64, "base64")], { type: args.mimeType ?? "text/csv" }), args.originalName ?? args.filename);
    const response = await fetch(`${base}/api/v1/rag/artifacts/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    equal(response.status, 201, "专用文件入口返回opaque引用"); uploads++;
    const file = await response.json() as Json; artifactIds.push(file.artifactId);
    delete args.contentBase64; delete args.dataBase64; args.artifactId = file.artifactId;
  }
  if ((name === "integration.create" || name === "integration.update") && args.token) {
    const response = await fetch(`${base}/api/v1/rag/artifacts/credentials`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ token: args.token, projectIds: [args.projectId], kind: args.kind, baseUrl: args.baseUrl }) });
    equal(response.status, 201, "专用凭据入口返回opaque引用"); uploads++;
    const credential = await response.json() as Json; credentialRefs.push(credential.credentialRef);
    delete args.token; args.credentialRef = credential.credentialRef;
  }
  return { args, artifactIds, credentialRefs };
}
async function invoke(name: string, input: Json = {}, token = bearer): Promise<Json> {
  const tool = registry.find(t => t.name === name); assert.ok(tool, `${name}向助手开放`);
  const authenticated = (await tokens.authenticateToken(token, "127.0.0.1"))!;
  const projectIds = (await listRagProjects(authenticated.actor, undefined, true)).map(p => p.id);
  const { args, artifactIds, credentialRefs } = await references(name, input, token);
  const access = { actor: authenticated.actor, token: authenticated.ctx, projectIds, allowAccount: true, artifactIds, credentialRefs, check: async () => {} };
  if (tool.kind === "read") {
    const { value } = await executeAssistantTool(access, tool, args);
    if (name === "attachment.download" || name === "project.report") {
      const projected = value as Json;
      proof(typeof projected.downloadUrl === "string" && !Object.hasOwn(projected, "contentBase64"), "助手输出只包含授权下载链接");
      const response = await fetch(new URL(projected.downloadUrl, base), { headers: { authorization: `Bearer ${token}` } });
      equal(response.status, 200, "真实安全下载HTTP成功"); downloads++;
      const bytes = Buffer.from(await response.arrayBuffer());
      return { ...projected, contentBase64: bytes.toString("base64"), sizeBytes: bytes.length };
    }
    return value as Json;
  }
  const key = input.idempotencyKey ? `${name}:${input.idempotencyKey}` : undefined;
  const previous = key ? idempotent.get(key) : undefined;
  if (previous) {
    const count = captures.get(name)!.length;
    const replay = await confirm(previous, token);
    equal(replay.status, "confirmed", "同一业务幂等键复用已确认建议");
    equal(captures.get(name)!.length, count, "同一业务幂等键不再次调用写handler");
    return previous.raw;
  }
  const count = captures.get(name)!.length;
  const allWrites = writeCount();
  const action = await proposeAssistantAction(access, tool, args); proposals++;
  equal(writeCount(), allWrites, "propose未执行任何业务写handler");
  proof(!JSON.stringify(action).includes("contentBase64") && !Object.hasOwn(action.parameters, "token"), "保存建议不携带文件字节或明文凭据");
  const conversation = await repo.insertConversation({ ownerId: actor.memberId, projectId: null, title: "全流程待确认", titleIsDefault: false });
  const requestId = randomUUID();
  await repo.insertMessage({ conversationId: conversation.id, requestId, question: `验收 ${name}`, status: "completed", requestMetadata: { artifactIds, credentialRefs },
    reply: { ok: true, answer: "等待用户确认", citations: [], mode: "none", scope: { projectIds, projectCount: projectIds.length }, actions: [action] } });
  equal(writeCount(), allWrites, "持久化待确认消息仍未执行任何写handler");
  const stored = { conversationId: conversation.id, requestId, action };
  let confirmed = await confirm(stored, token);
  if (name === "integration.sync") {
    equal(confirmed.status, "queued", "外部同步确认只入持久化队列");
    equal(captures.get(name)!.length, count, "queued不是外部同步成功");
    await runJobWorkerOnce("assistant-full-workflows", 100);
    confirmed = (await repo.findMessage(conversation.id, requestId))!.reply!.actions![0]!;
    equal(confirmed.result?.value.executionStatus, "succeeded", "worker执行后持久化同步成功");
  }
  equal(confirmed.status, "confirmed", "真实HTTP确认后保存完成状态");
  const after = captures.get(name)!.length;
  equal(after, count + 1, "确认恰好执行一次guarded写handler");
  const replay = await confirm(stored, token);
  equal(replay.status, "confirmed", "重复HTTP确认返回既有完成状态");
  equal(captures.get(name)!.length, after, "重复HTTP确认不重复执行handler");
  const capture = captures.get(name)![count]!;
  if (capture.error) throw capture.error;
  const raw = tool.resultEnvelope || capture.value?.replayed !== undefined ? capture.value.result : capture.value;
  if (key) idempotent.set(key, { ...stored, raw });
  return raw;
}
async function call(name: string, args: Json = {}) {
  const value = await invoke(name, args);
  active.calls.push({ tool: name, ok: true, kind: registry.find(t => t.name === name)!.kind });
  console.log(`  ASSISTANT ${active.id} ${name}`); return value;
}
async function denied(name: string, args: Json, code: string, token = bearer) {
  let error: any;
  try { await invoke(name, args, token); } catch (caught) { error = caught; }
  proof(error, `${name}必须拒绝`);
  equal(error.code, code, `${name}保留领域拒绝码`);
  active.calls.push({ tool: name, ok: false, kind: registry.find(t => t.name === name)!.kind, expectedError: code });
  return { code: error.code };
}
try {
  const workflows = createFullBusinessWorkflows({ call, denied, proof, equal, base, username, password, readOnly, adminId: admin!.id, colleagueId: colleague!.id, memberRoleId: memberRole!.id });
  assert.deepEqual(Object.keys(workflows).sort(), BUSINESS_WORKFLOWS.map(f => f.id).sort());
  console.log("助手全21业务闭环：共享业务场景；真实持久化proposal→HTTP确认；固定业务输入；不覆盖自然语言规划质量。");
  for (const flow of BUSINESS_WORKFLOWS) {
    active = { id: flow.id, calls: [], assertions: 0, status: "RUNNING" }; evidence.push(active);
    console.log(`开始 ${flow.id} ${flow.purpose}`);
    try {
      await workflows[flow.id]();
      for (const name of new Set(flow.steps)) proof(active.calls.filter(c => c.tool === name && c.ok).length >= flow.steps.filter(s => s === name).length, `${name}实际完成声明步骤`);
      active.status = "PASS"; console.log(`通过 ${flow.id}：${active.calls.length}次助手调用、${active.assertions}断言`);
    } catch (error) { active.status = "FAIL"; active.error = error instanceof Error ? error.message : String(error); console.error(`失败 ${flow.id}: ${active.error}`); }
  }
  const failures = evidence.filter(e => e.status !== "PASS");
  console.log(`结果：${evidence.length - failures.length}/21流程通过；${proposals}建议；${httpConfirmations}次真实HTTP确认；${downloads}安全下载；${uploads}专用上传；${assertions}断言；失败${failures.length}。`);
  assert.equal(failures.length, 0, `失败流程：${failures.map(f => f.id).join(", ")}`);
} finally {
  await mkdir(".cache/full-business-closure", { recursive: true });
  await writeFile(".cache/full-business-closure/assistant-workflows.json", JSON.stringify({ transport: "real socket HTTP confirmation; assistant authorized read executor", modelPlanning: "not tested", outbound: "local fixture only", flows: evidence, proposals, httpConfirmations, downloads, uploads, assertions }, null, 2));
  for (const [tool, handler] of originals) tool.handler = handler;
  await app.close(); await closeCache(); await sql.end();
}
