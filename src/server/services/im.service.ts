/**
 * IM 集成（Round 76）：钉钉 / 企业微信 / 飞书
 *
 * 首期落地**群机器人 webhook**（三类协议兼容），凭据一律信封加密；应用模式凭据可保存但不提供非 webhook 发送，
 * 没有 webhook 的渠道测试会明确失败（不伪造成功）。
 * 通知扇出：notification.service 在落库后调用 dispatchNotification()，按类别匹配启用的渠道 → 入队 im.send
 * （失败可重试、不阻塞通知落库/SSE）。
 */
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { imChannel } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { decryptSecret, encryptSecret } from "./crypto.service.ts";
import { enqueue } from "./job.service.ts";

export { buildImPayload as buildPayload, IM_PROVIDERS } from "../../shared/im-protocol.ts";
export type { ImProvider } from "../../shared/im-protocol.ts";
import { IM_PROVIDER_LABEL as PROVIDER_LABEL, buildImPayload, imResponseError, IM_PROVIDERS } from "../../shared/im-protocol.ts";
import type { ImProvider } from "../../shared/im-protocol.ts";
import {
  dingtalkSendRequest, dingtalkTokenRequest, feishuSendRequest, feishuTokenRequest,
  sendErrorFromResponse, tokenFromResponse, wecomSendRequest, wecomTokenRequest, type AppCredentials,
} from "../../shared/im-app-protocol.ts";

function assertManage(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "integration:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

function cleanUrl(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || !raw.trim()) return null;
  const url = raw.trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new DomainError("VALIDATION", "Webhook 地址不是合法 URL", null); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DomainError("VALIDATION", "Webhook 地址必须是 http(s)", null);
  }
  return url;
}

function mask(row: typeof imChannel.$inferSelect) {
  return {
    id: row.id, name: row.name, provider: row.provider as ImProvider,
    providerLabel: PROVIDER_LABEL[row.provider as ImProvider] ?? row.provider,
    enabled: row.enabled, events: (row.events as string[]) ?? [],
    hasWebhook: !!row.webhookUrlEncrypted, hasCredentials: !!(row.appKeyEncrypted || row.appSecretEncrypted),
    hasRecipients: !!row.recipients, recipientCount: row.recipients ? row.recipients.split(",").filter(Boolean).length : 0,
    corpId: row.corpId, agentId: row.agentId,
    lastTestAt: row.lastTestAt, lastTestOk: row.lastTestOk, lastTestError: row.lastTestError,
    lastSendAt: row.lastSendAt, lastSendOk: row.lastSendOk, lastSendError: row.lastSendError,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export async function listChannels(actor: Actor) {
  assertManage(actor);
  const rows = await db.select().from(imChannel).orderBy(imChannel.provider, imChannel.name);
  return { channels: rows.map(mask) };
}

export interface ImChannelInput {
  name: string;
  provider: ImProvider;
  webhookUrl?: string | null;
  appKey?: string | null;
  appSecret?: string | null;
  corpId?: string | null;
  agentId?: string | null;
  /** 应用消息接收人（逗号分隔 userid/open_id），仅应用模式使用 */
  recipients?: string | null;
  events?: string[];
  enabled?: boolean;
}

export async function createChannel(actor: Actor, input: ImChannelInput) {
  assertManage(actor);
  const name = input.name?.trim();
  if (!name || name.length > 80) throw new DomainError("VALIDATION", "渠道名称需为 1–80 字", null);
  if (!IM_PROVIDERS.includes(input.provider)) throw new DomainError("VALIDATION", "不支持的 IM 提供方", null);
  const webhook = cleanUrl(input.webhookUrl);
  const [existing] = await db.select({ id: imChannel.id }).from(imChannel)
    .where(and(eq(imChannel.provider, input.provider), eq(imChannel.name, name))).limit(1);
  if (existing) throw new DomainError("CONFLICT", "同一提供方下已存在同名渠道", null);
  const [row] = await db.insert(imChannel).values({
    name, provider: input.provider,
    webhookUrlEncrypted: webhook ? encryptSecret(webhook) : null,
    appKeyEncrypted: input.appKey ? encryptSecret(input.appKey) : null,
    appSecretEncrypted: input.appSecret ? encryptSecret(input.appSecret) : null,
    corpId: input.corpId?.trim() || null, agentId: input.agentId?.trim() || null,
    recipients: input.recipients?.trim() || null,
    events: (input.events ?? []) as object, enabled: input.enabled ?? true,
  }).returning();
  return { channel: mask(row!) };
}

export async function updateChannel(actor: Actor, id: string, input: Partial<ImChannelInput>) {
  assertManage(actor);
  const [cur] = await db.select().from(imChannel).where(eq(imChannel.id, id)).limit(1);
  if (!cur) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const name = input.name !== undefined ? input.name.trim() : cur.name;
  if (!name || name.length > 80) throw new DomainError("VALIDATION", "渠道名称需为 1–80 字", null);
  const provider = input.provider ?? (cur.provider as ImProvider);
  if (!IM_PROVIDERS.includes(provider)) throw new DomainError("VALIDATION", "不支持的 IM 提供方", null);
  const [dup] = await db.select({ id: imChannel.id }).from(imChannel)
    .where(and(eq(imChannel.provider, provider), eq(imChannel.name, name))).limit(1);
  if (dup && dup.id !== id) throw new DomainError("CONFLICT", "同一提供方下已存在同名渠道", null);
  const set: Record<string, unknown> = {
    name, provider, updatedAt: new Date(),
    corpId: input.corpId !== undefined ? (input.corpId?.trim() || null) : cur.corpId,
    agentId: input.agentId !== undefined ? (input.agentId?.trim() || null) : cur.agentId,
    recipients: input.recipients !== undefined ? (input.recipients?.trim() || null) : cur.recipients,
    events: input.events !== undefined ? (input.events as object) : (cur.events as object),
    enabled: input.enabled ?? cur.enabled,
  };
  if (input.webhookUrl !== undefined) set.webhookUrlEncrypted = cleanUrl(input.webhookUrl) ? encryptSecret(cleanUrl(input.webhookUrl)!) : null;
  if (input.appKey !== undefined) set.appKeyEncrypted = input.appKey ? encryptSecret(input.appKey) : null;
  if (input.appSecret !== undefined) set.appSecretEncrypted = input.appSecret ? encryptSecret(input.appSecret) : null;
  const [row] = await db.update(imChannel).set(set).where(eq(imChannel.id, id)).returning();
  return { channel: mask(row!) };
}

export async function deleteChannel(actor: Actor, id: string): Promise<void> {
  assertManage(actor);
  const [cur] = await db.select({ id: imChannel.id }).from(imChannel).where(eq(imChannel.id, id)).limit(1);
  if (!cur) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  await db.delete(imChannel).where(eq(imChannel.id, id));
}

async function postWebhook(provider: ImProvider, webhookUrl: string, text: string): Promise<void> {
  const res = await safeOutboundFetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildImPayload(provider, text)),
    signal: AbortSignal.timeout(8_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* 非 JSON 视为失败 */ }
  const err = imResponseError(body);
  if (err) throw new Error(err);
}

function appCredentialsOf(row: typeof imChannel.$inferSelect): { creds: AppCredentials; recipients: string[] } | null {
  const provider = row.provider as ImProvider;
  if (!row.appKeyEncrypted || !row.appSecretEncrypted) return null;
  const recipients = (row.recipients ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (recipients.length === 0) return null;
  if (provider !== "FEISHU" && (!row.agentId || !Number.isFinite(Number(row.agentId)))) return null;
  if (provider === "WECOM" && !row.corpId) return null;
  return {
    creds: {
      appKey: decryptSecret(row.appKeyEncrypted), appSecret: decryptSecret(row.appSecretEncrypted),
      corpId: row.corpId, agentId: row.agentId,
    },
    recipients,
  };
}

async function fetchJson(spec: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }): Promise<Record<string, unknown>> {
  const res = await safeOutboundFetch(spec.url, { ...spec.init, signal: AbortSignal.timeout(8_000) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("IM 响应不是 JSON"); }
}

/** 应用模式发送（钉钉工作通知 / 企微应用消息 / 飞书应用消息） */
async function postAppMessage(row: typeof imChannel.$inferSelect, text: string): Promise<void> {
  const provider = row.provider as ImProvider;
  const cfg = appCredentialsOf(row);
  if (!cfg) throw new Error("应用模式配置不完整：需要 AppKey/AppSecret/AgentId(企微另需 CorpId)/接收人");
  const tokenSpec = provider === "DINGTALK" ? dingtalkTokenRequest(cfg.creds)
    : provider === "WECOM" ? wecomTokenRequest(cfg.creds)
    : feishuTokenRequest(cfg.creds);
  const tokenBody = await fetchJson(tokenSpec);
  const { token, error } = tokenFromResponse(provider, tokenBody);
  if (error || !token) throw new Error(error ?? "获取 access_token 失败");
  if (provider === "FEISHU") {
    for (const recipient of cfg.recipients) {
      const body = await fetchJson(feishuSendRequest(recipient, text, token));
      const err = sendErrorFromResponse(provider, body);
      if (err) throw new Error(err);
    }
    return;
  }
  const sendSpec = provider === "DINGTALK" ? dingtalkSendRequest(cfg.creds, cfg.recipients, text, token)
    : wecomSendRequest(cfg.creds, cfg.recipients, text, token);
  const sendBody = await fetchJson(sendSpec);
  const err = sendErrorFromResponse(provider, sendBody);
  if (err) throw new Error(err);
}

/** 发送到指定渠道（job worker 与测试共用）；返回实际 provider */
export async function sendToChannel(channelId: string, text: string): Promise<void> {
  const [row] = await db.select().from(imChannel).where(eq(imChannel.id, channelId)).limit(1);
  if (!row) throw new Error("IM 渠道不存在");
  const hasWebhook = !!row.webhookUrlEncrypted;
  if (!hasWebhook && !appCredentialsOf(row)) throw new Error("该渠道未配置 Webhook，应用模式也缺少配置或接收人");
  try {
    if (hasWebhook) await postWebhook(row.provider as ImProvider, decryptSecret(row.webhookUrlEncrypted!), text);
    else await postAppMessage(row, text);
    await db.update(imChannel).set({ lastSendAt: new Date(), lastSendOk: true, lastSendError: null }).where(eq(imChannel.id, channelId));
  } catch (e) {
    await db.update(imChannel).set({ lastSendAt: new Date(), lastSendOk: false, lastSendError: (e as Error).message.slice(0, 300) }).where(eq(imChannel.id, channelId));
    throw e;
  }
}

export async function testChannel(actor: Actor, id: string, text = "Feronavi IM 集成测试消息") {
  assertManage(actor);
  const [row] = await db.select().from(imChannel).where(eq(imChannel.id, id)).limit(1);
  if (!row) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const hasWebhook = !!row.webhookUrlEncrypted;
  if (!hasWebhook) {
    const cfg = appCredentialsOf(row);
    if (!cfg) {
      throw new DomainError("VALIDATION", "该渠道未配置 Webhook；应用模式还需 AppKey/AppSecret/AgentId（企微另需 CorpId）与接收人", null);
    }
  }
  try {
    if (hasWebhook) await postWebhook(row.provider as ImProvider, decryptSecret(row.webhookUrlEncrypted!), text);
    else await postAppMessage(row, text);
    await db.update(imChannel).set({ lastTestAt: new Date(), lastTestOk: true, lastTestError: null }).where(eq(imChannel.id, id));
    return { ok: true, provider: row.provider, channel: row.name };
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    await db.update(imChannel).set({ lastTestAt: new Date(), lastTestOk: false, lastTestError: message }).where(eq(imChannel.id, id));
    return { ok: false, provider: row.provider, channel: row.name, error: message };
  }
}

/**
 * 通知扇出（在通知落库后调用）：按类别选启用渠道，入队 im.send；不阻塞主流程。
 * events 为空 = 全部类别。
 */
export async function dispatchNotification(input: {
  category: string; title: string; body: string; link?: string | null;
}): Promise<void> {
  const rows = await db.select().from(imChannel).where(eq(imChannel.enabled, true));
  const matched = rows.filter((row) => {
    const events = (row.events as string[]) ?? [];
    return events.length === 0 || events.includes(input.category);
  });
  const text = `[Feronavi] ${input.title}\n${input.body}${input.link ? `\n${input.link}` : ""}`;
  for (const channel of matched) {
    await enqueue({
      kind: "im.send",
      payload: { channelId: channel.id, text },
      dedupeKey: `im:${channel.id}:${input.category}:${input.title.slice(0, 80)}`,
    }).catch(() => { /* 队列不可用不阻断通知 */ });
  }
}
