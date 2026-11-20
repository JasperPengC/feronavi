/** 浏览器直传资料的受控暂存：秘密只在服务器执行时解密，不进入助手消息或模型结果。 */
import { createHash } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { assistantArtifact } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { loadActor } from "../auth/actor-loader.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { assertSafeOutboundUrl } from "../lib/url-safety.ts";
import { decryptSecret, encryptSecret, isEncrypted } from "./crypto.service.ts";
import { ALLOWED, sanitizeFileName } from "./attachment.service.ts";
import { refreshAssistantToken } from "./assistant-access.ts";
import { projectAllowed, tierAllows, type TokenContext } from "./token.service.ts";

export const ASSISTANT_ARTIFACT_MAX_BYTES = 8 * 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;
const MAX_ACTIVE_PER_OWNER = 20;
const projectIdsSchema = z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length);
const destinationSchema = z.object({ kind: z.enum(["GITHUB", "GITLAB", "GITEE"]), baseUrl: z.string().url().max(500) }).strict();
export type AssistantCredentialDestination = z.infer<typeof destinationSchema>;
const unavailable = () => new DomainError("NOT_FOUND", "资料不存在或不可访问", null);
function validation(message: string): never { throw new DomainError("VALIDATION", message, null); }
function destinationValue(input: AssistantCredentialDestination) {
  const parsed = destinationSchema.safeParse(input);
  if (!parsed.success) return validation("请选择有效的供应商和地址");
  const url = new URL(parsed.data.baseUrl);
  if (url.username || url.password || url.search || url.hash) return validation("集成地址不能包含凭据、查询参数或片段");
  return { kind: parsed.data.kind, baseUrl: url.toString().replace(/\/+$/u, "") };
}
async function liveIdentity(actor: Actor, token?: TokenContext) {
  const liveActor = await loadActor(actor.memberId);
  if (!liveActor) throw unavailable();
  let liveToken: TokenContext | undefined;
  if (token) {
    if (token.memberId !== actor.memberId) throw unavailable();
    try { liveToken = await refreshAssistantToken(token); } catch { throw unavailable(); }
    if (!tierAllows(liveToken, "write")) throw unavailable();
  }
  return { actor: liveActor, token: liveToken };
}
async function visibleProject(actor: Actor, projectId: string, token?: TokenContext) {
  if (token && !projectAllowed(token, projectId)) throw unavailable();
  const project = await projectRepo.findById(projectId);
  if (!project || project.archivedAt || !(await projectRepo.isVisibleTo(actor.memberId, projectId, actor.grants.some(grant => grant.scopeType === "ORG")))) throw unavailable();
}
function manageCredential(actor: Actor, projectId: string) {
  if (!can(actor, "integration:manage", { projectId, teamId: null }, { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId })) throw unavailable();
}
async function uploadScope(actor: Actor, projectIds: string[], token?: TokenContext, allowedProjectIds?: string[], credential = false) {
  const parsed = projectIdsSchema.safeParse(projectIds);
  if (!parsed.success) return validation("请明确选择1至20个不重复项目");
  const live = await liveIdentity(actor, token);
  for (const id of parsed.data) {
    if (allowedProjectIds !== undefined && !allowedProjectIds.includes(id)) throw unavailable();
    await visibleProject(live.actor, id, live.token);
    if (credential) manageCredential(live.actor, id);
  }
  return { ...live, projectIds: parsed.data };
}
async function store(input: typeof assistantArtifact.$inferInsert) {
  return db.transaction(async () => {
    // 配额与插入共用所有者锁；到期数据在下一次直传时删除，不进入任何备份。
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`assistant-artifact:${input.ownerId}`}))`);
    await db.delete(assistantArtifact).where(lte(assistantArtifact.expiresAt, new Date()));
    const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(assistantArtifact).where(eq(assistantArtifact.ownerId, input.ownerId));
    if ((count?.total ?? 0) >= MAX_ACTIVE_PER_OWNER) return validation("暂存资料已达上限，请删除不用的资料或稍后重试");
    const [row] = await db.insert(assistantArtifact).values(input).returning();
    return row!;
  });
}
export async function createAssistantFile(actor: Actor, input: { filename: string; mimeType: string; data: Buffer; projectIds: string[] }, token?: TokenContext, allowedProjectIds?: string[]) {
  const scope = await uploadScope(actor, input.projectIds, token, allowedProjectIds);
  if (!input.data.length || input.data.length > ASSISTANT_ARTIFACT_MAX_BYTES) return validation("文件不能为空且不能超过8 MiB");
  const filename = sanitizeFileName(input.filename);
  const extension = `.${filename.split(".").pop()?.toLowerCase() ?? ""}`;
  const allowedMimeTypes = extension === ".xlsx" ? ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] : ALLOWED[extension];
  const mimeType = input.mimeType.toLowerCase();
  if (!allowedMimeTypes?.includes(mimeType)) return validation("文件扩展名或类型不受支持");
  const expiresAt = new Date(Date.now() + TTL_MS);
  const row = await store({ ownerId: actor.memberId, sourceTokenId: scope.token?.tokenId ?? null, kind: "FILE", allowedProjectIds: scope.projectIds,
    filename, mimeType, sizeBytes: input.data.length, sha256: createHash("sha256").update(input.data).digest("hex"),
    payloadEncrypted: encryptSecret(JSON.stringify({ contentBase64: input.data.toString("base64") })), expiresAt });
  return { artifactId: row.id, filename, mimeType, sizeBytes: input.data.length, allowedProjectIds: scope.projectIds, expiresAt: expiresAt.toISOString() };
}
export async function createAssistantCredential(actor: Actor, input: { token: string; projectIds: string[]; kind: AssistantCredentialDestination["kind"]; baseUrl: string }, token?: TokenContext, allowedProjectIds?: string[]) {
  const scope = await uploadScope(actor, input.projectIds, token, allowedProjectIds, true);
  if (typeof input.token !== "string" || !input.token.trim() || input.token.length > 2000) return validation("凭据不能为空且不能超过2000字符");
  const destination = destinationValue({ kind: input.kind, baseUrl: input.baseUrl });
  await assertSafeOutboundUrl(destination.baseUrl);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const row = await store({ ownerId: actor.memberId, sourceTokenId: scope.token?.tokenId ?? null, kind: "CREDENTIAL", allowedProjectIds: scope.projectIds,
    destination, payloadEncrypted: encryptSecret(JSON.stringify({ token: input.token })), expiresAt });
  return { credentialRef: row.id, allowedProjectIds: scope.projectIds, expiresAt: expiresAt.toISOString() };
}
async function ownedArtifact(actor: Actor, id: string, projectId: string, kind: "FILE" | "CREDENTIAL", token?: TokenContext) {
  if (!z.string().uuid().safeParse(id).success) throw unavailable();
  const live = await liveIdentity(actor, token);
  const [row] = await db.select().from(assistantArtifact).where(and(eq(assistantArtifact.id, id), eq(assistantArtifact.ownerId, actor.memberId), eq(assistantArtifact.kind, kind))).limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now() || !row.allowedProjectIds.includes(projectId) || !isEncrypted(row.payloadEncrypted)) throw unavailable();
  await visibleProject(live.actor, projectId, live.token);
  if (kind === "CREDENTIAL") manageCredential(live.actor, projectId);
  if (row.sourceTokenId) {
    const source = await liveIdentity(live.actor, { memberId: actor.memberId, tokenId: row.sourceTokenId, tier: "READ_WRITE", projectWhitelist: [] });
    if (!source.token || !projectAllowed(source.token, projectId)) throw unavailable();
  }
  return row;
}
/** 仅服务器hydrate调用；此返回值禁止写入action/message、SSE或provider结果。 */
export async function resolveAssistantFile(actor: Actor, id: string, projectId: string, token?: TokenContext) {
  const row = await ownedArtifact(actor, id, projectId, "FILE", token);
  let payload: { contentBase64: string };
  try { payload = JSON.parse(decryptSecret(row.payloadEncrypted)); } catch { throw unavailable(); }
  const data = typeof payload.contentBase64 === "string" ? Buffer.from(payload.contentBase64, "base64") : Buffer.alloc(0);
  if (!row.filename || !row.mimeType || !data.length || data.length > ASSISTANT_ARTIFACT_MAX_BYTES || data.length !== row.sizeBytes || createHash("sha256").update(data).digest("hex") !== row.sha256) throw unavailable();
  return { filename: row.filename, mimeType: row.mimeType, contentBase64: payload.contentBase64 };
}
/** 目的地址绑定必须在解密前校验，不能让模型用同一引用把密钥发往另一主机。 */
export async function resolveAssistantCredential(actor: Actor, id: string, projectId: string, token: TokenContext | undefined, destination: AssistantCredentialDestination) {
  const row = await ownedArtifact(actor, id, projectId, "CREDENTIAL", token);
  let requested: ReturnType<typeof destinationValue>;
  try { requested = destinationValue(destination); } catch { throw unavailable(); }
  if (row.destination?.kind !== requested.kind || row.destination?.baseUrl !== requested.baseUrl) throw unavailable();
  let payload: { token: string };
  try { payload = JSON.parse(decryptSecret(row.payloadEncrypted)); } catch { throw unavailable(); }
  if (typeof payload.token !== "string" || !payload.token.trim() || payload.token.length > 2000) throw unavailable();
  return payload.token;
}
export async function removeAssistantArtifact(actor: Actor, id: string, token?: TokenContext) {
  await liveIdentity(actor, token);
  const [row] = await db.delete(assistantArtifact).where(and(eq(assistantArtifact.id, id), eq(assistantArtifact.ownerId, actor.memberId))).returning({ id: assistantArtifact.id });
  if (!row) throw unavailable();
  return { ok: true };
}

/** 本轮只注入已显式附带且与当前范围相交的元信息；绝不读取或解密payload。 */
export async function describeAssistantArtifacts(actor: Actor, references: { artifactIds?: string[]; credentialRefs?: string[] }, scopeProjectIds: string[], token?: TokenContext) {
  const ids = z.array(z.string().uuid()).max(10).refine(values => new Set(values).size === values.length);
  const parsed = z.object({ artifactIds: ids.optional(), credentialRefs: ids.optional() }).strict().safeParse(references);
  if (!parsed.success) return validation("资料引用参数不合法");
  const metadata = async (id: string, kind: "FILE" | "CREDENTIAL") => {
    const [candidate] = await db.select().from(assistantArtifact).where(and(eq(assistantArtifact.id, id), eq(assistantArtifact.ownerId, actor.memberId), eq(assistantArtifact.kind, kind))).limit(1);
    const allowedProjectIds = candidate?.allowedProjectIds.filter(projectId => scopeProjectIds.includes(projectId)) ?? [];
    if (!allowedProjectIds.length) throw unavailable();
    for (const projectId of allowedProjectIds) await ownedArtifact(actor, id, projectId, kind, token);
    return { row: candidate!, allowedProjectIds };
  };
  const files = [];
  for (const id of parsed.data.artifactIds ?? []) {
    const { row, allowedProjectIds } = await metadata(id, "FILE");
    files.push({ id, allowedProjectIds, filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes, expiresAt: row.expiresAt.toISOString() });
  }
  const credentials = [];
  for (const id of parsed.data.credentialRefs ?? []) {
    const { row, allowedProjectIds } = await metadata(id, "CREDENTIAL");
    if (!row.destination) throw unavailable();
    credentials.push({ id, allowedProjectIds, kind: row.destination.kind, baseUrl: row.destination.baseUrl, expiresAt: row.expiresAt.toISOString() });
  }
  return { files, credentials };
}
