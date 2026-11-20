/**
 * AI 供应商配置与用量（第十三期，规范 9.1/9.2）
 *
 * 三条要点：
 *   1 `base_url` 必须过**统一 SSRF 模块**（规范 C-17/C-27：所有用户可控出站 URL 都走同一个实现）
 *   2 **仅接受 1024 维 embedding 模型**（库内 `vector(1024)` 写死；非 1024 维在配置阶段就拒）
 *   3 用量上限：**成员级是单行原子判定**；**超限只暂停新索引，绝不阻断检索**（规范明示）。
 *      组织级上限属最终一致（worker 周期校验），本文件**不混用**两种语义。
 */
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { aiProviderConfig, aiUsageCounter } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { assertSafeOutboundUrl } from "../lib/url-safety.ts";
import { decryptSecret, encryptSecret } from "./crypto.service.ts";
import { deleteSettings, getSettingRaw, putSettings } from "./setting.service.ts";

export const PROVIDERS = ["OPENAI_COMPAT", "OLLAMA"] as const;
export const PURPOSES = ["BOTH", "LLM", "EMBEDDING"] as const;

function assertConfigure(actor: Actor) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  // ai:configure 是组织级动作 → 需 ORG 档（第七期 A1 修法刻意不放宽组织级动作）
  if (!can(actor, "ai:configure", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

/** provider 的连接测试端点（OpenAI 兼容 / Ollama） */
function probeUrl(provider: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return provider === "OLLAMA" ? `${base}/api/tags` : `${base}/models`;
}

async function loadProvider(id: string) {
  return (await db.select().from(aiProviderConfig).where(eq(aiProviderConfig.id, id)).limit(1))[0] ?? null;
}

async function applyEffectiveProvider(row: typeof aiProviderConfig.$inferSelect): Promise<void> {
  const apiKey = row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null;
  if (row.purpose !== "LLM") {
    await putSettings({
      "ai.enabled": row.isActive,
      "ai.baseUrl": row.baseUrl,
      "ai.model": row.embeddingModel,
      "ai.apiKey": apiKey,
      "ai.dimensions": 1024,
    });
  }
  if (row.purpose !== "EMBEDDING") {
    await putSettings({
      "ai.chatBaseUrl": row.baseUrl,
      "ai.chatModel": row.model,
      "ai.chatApiKey": apiKey,
    });
  }
}

export async function createProvider(actor: Actor, input: {
  provider: string; baseUrl: string; model: string; embeddingModel: string; apiKey?: string | null; purpose?: string; note?: string | null;
}) {
  assertConfigure(actor);
  if (!(PROVIDERS as readonly string[]).includes(input.provider)) {
    throw new DomainError("VALIDATION", `供应商只支持 ${PROVIDERS.join(" / ")}`, null);
  }
  const purpose = input.purpose ?? "BOTH";
  if (!(PURPOSES as readonly string[]).includes(purpose)) {
    throw new DomainError("VALIDATION", `用途只支持 ${PURPOSES.join(" / ")}`, null);
  }
  // 统一 SSRF 校验（与 webhook 同一个模块）
  await assertSafeOutboundUrl(input.baseUrl);
  if (input.provider === "OPENAI_COMPAT" && !input.apiKey) {
    throw new DomainError("VALIDATION", "OPENAI_COMPAT 必须提供 API Key；本地 Ollama 才可留空", null);
  }
  // 「第一个供应商」以**当前是否存在默认供应商**为准：即使库里有停用/历史配置，新建也应能成为默认
  const [existingDefault] = await db.select({ id: aiProviderConfig.id }).from(aiProviderConfig)
    .where(and(eq(aiProviderConfig.isDefault, true), eq(aiProviderConfig.purpose, purpose))).limit(1);
  const isFirst = !existingDefault;
  const [row] = await db.insert(aiProviderConfig).values({
    provider: input.provider,
    baseUrl: input.baseUrl.replace(/\/+$/, ""),
    model: input.model,
    embeddingModel: input.embeddingModel,
    purpose,
    note: input.note?.trim() || null,
    apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : null,
    isDefault: isFirst,
  }).returning();
  // 只有默认供应商才成为检索生效配置（此前每次新建都覆盖 setting，多供应商下是错的）
  if (isFirst) await applyEffectiveProvider(row!);
  return { ...row!, apiKeyEncrypted: undefined };
}

export async function listProviders(actor: Actor) {
  assertConfigure(actor);
  const rows = await db.select().from(aiProviderConfig).orderBy(desc(aiProviderConfig.createdAt));
  return rows.map(({ apiKeyEncrypted: _k, ...rest }) => ({ ...rest, hasApiKey: _k !== null }));
}

export async function updateProvider(actor: Actor, id: string, patch: {
  baseUrl?: string; model?: string; embeddingModel?: string; apiKey?: string | null; isActive?: boolean; purpose?: string; note?: string | null;
}) {
  assertConfigure(actor);
  const cur = await loadProvider(id);
  if (!cur) throw forbidden();
  if (patch.baseUrl) await assertSafeOutboundUrl(patch.baseUrl);
  const [row] = await db.update(aiProviderConfig).set({
    ...(patch.baseUrl ? { baseUrl: patch.baseUrl.replace(/\/+$/, "") } : {}),
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.embeddingModel ? { embeddingModel: patch.embeddingModel } : {}),
    ...(patch.apiKey !== undefined ? { apiKeyEncrypted: patch.apiKey ? encryptSecret(patch.apiKey) : null } : {}),
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    ...(patch.purpose && (PURPOSES as readonly string[]).includes(patch.purpose) ? { purpose: patch.purpose } : {}),
    ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
    updatedAt: new Date(),
  }).where(eq(aiProviderConfig.id, id)).returning();
  if (row?.isDefault) await applyEffectiveProvider(row);
  return { ...row!, apiKeyEncrypted: undefined };
}

export async function deleteProvider(actor: Actor, id: string) {
  assertConfigure(actor);
  const cur = await loadProvider(id);
  if (!cur) throw forbidden();
  await db.delete(aiProviderConfig).where(eq(aiProviderConfig.id, id));
  if (cur.isDefault) {
    const [next] = await db.select().from(aiProviderConfig)
      .where(and(eq(aiProviderConfig.isActive, true), eq(aiProviderConfig.purpose, cur.purpose))).limit(1);
    if (next) {
      await db.update(aiProviderConfig).set({ isDefault: true, updatedAt: new Date() }).where(eq(aiProviderConfig.id, next.id));
      await applyEffectiveProvider(next);
    } else if (cur.purpose === "LLM") {
      await deleteSettings(["ai.chatBaseUrl", "ai.chatModel", "ai.chatApiKey"]);
    } else if (cur.purpose === "EMBEDDING") {
      await putSettings({ "ai.enabled": false });
      await deleteSettings(["ai.baseUrl", "ai.model", "ai.apiKey"]);
    } else {
      await putSettings({ "ai.enabled": false });
      await deleteSettings(["ai.baseUrl", "ai.model", "ai.apiKey", "ai.chatBaseUrl", "ai.chatModel", "ai.chatApiKey"]);
    }
  }
}

export async function setDefaultProvider(actor: Actor, id: string) {
  assertConfigure(actor);
  const cur = await loadProvider(id);
  if (!cur) throw forbidden();
  if (!cur.isActive) throw new DomainError("VALIDATION", "已停用的供应商不能设为默认", null);
  await db.update(aiProviderConfig).set({ isDefault: false, updatedAt: new Date() }).where(eq(aiProviderConfig.purpose, cur.purpose));
  const [row] = await db.update(aiProviderConfig).set({ isDefault: true, updatedAt: new Date() }).where(eq(aiProviderConfig.id, id)).returning();
  await applyEffectiveProvider(row!);
  return { ...row!, apiKeyEncrypted: undefined };
}

/** OpenAI兼容供应商按用途做最小真实推理；模型目录可访问不代表有余额或所选模型可用。 */
export async function testProvider(actor: Actor, id: string) {
  assertConfigure(actor);
  const cur = await loadProvider(id);
  if (!cur) throw forbidden();
  const base = cur.baseUrl.replace(/\/+$/, "");
  const key = cur.apiKeyEncrypted ? decryptSecret(cur.apiKeyEncrypted) : null;
  const started = Date.now();
  try {
    const signal = AbortSignal.timeout(12_000);
    const probe = async (url: string, body?: object): Promise<unknown> => {
      const res = await safeOutboundFetch(url, {
        method: body ? "POST" : "GET",
        headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal,
      });
      if (!res.ok) {
        await res.body?.cancel();
        const hint = res.status === 402 ? "账户余额不足，请在模型服务商处充值后重试"
          : res.status === 401 || res.status === 403 ? "认证或模型权限不足，请检查 API Key 和模型授权"
          : res.status === 404 ? "模型或接口不存在，请检查模型名称和 Base URL"
          : res.status === 429 ? "请求受限或额度耗尽，请检查服务商配额后重试" : "模型服务调用失败";
        // 不保存上游原始错误正文，避免服务商回显密钥/请求内容进入持久记录。
        throw new Error(`HTTP ${res.status}：${hint}`);
      }
      if (!res.body) throw new Error("模型服务返回空响应");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "", bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 262_144) { await reader.cancel(); throw new Error("模型测试响应过大"); }
          raw += decoder.decode(chunk.value, { stream: true });
        }
        raw += decoder.decode();
      } finally { reader.releaseLock(); }
      try { return JSON.parse(raw); } catch { throw new Error("返回不是 JSON，模型测试不通过"); }
    };
    if (cur.provider === "OLLAMA") {
      await probe(probeUrl(cur.provider, base));
    } else {
      if (cur.purpose !== "EMBEDDING") {
        const result = await probe(`${base}/chat/completions`, {
          model: cur.model, messages: [{ role: "user", content: "这是连接测试，请只回复OK。" }], max_tokens: 256, stream: false,
        }) as { choices?: { message?: { content?: unknown } }[] } | null;
        const content = result?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new Error("对话模型未返回有效回答，请检查所选模型");
      }
      if (cur.purpose !== "LLM") {
        const result = await probe(`${base}/embeddings`, { model: cur.embeddingModel, input: ["Feronavi connection test"] }) as { data?: { embedding?: unknown }[] } | null;
        const vector = result?.data?.[0]?.embedding;
        if (!Array.isArray(result?.data) || result.data.length !== 1 || !Array.isArray(vector)) throw new Error("向量模型未返回有效向量");
        if (vector.length !== 1024) throw new Error(`模型返回 ${vector.length} 维向量，与库内 vector(1024) 不一致`);
        if (!vector.every(value => typeof value === "number" && Number.isFinite(value))) throw new Error("向量模型返回了无效数值");
      }
    }
    const latencyMs = Date.now() - started;
    await db.update(aiProviderConfig).set({ lastTestAt: new Date(), lastTestOk: true, lastTestError: null, updatedAt: new Date() })
      .where(eq(aiProviderConfig.id, id));
    return { ok: true, latencyMs };
  } catch (e) {
    const message = ((e as Error).name === "TimeoutError" ? "模型调用超时，请稍后重试" : (e as Error).message)
      .replaceAll(key || "\u0000", "[redacted]").slice(0, 300);
    await db.update(aiProviderConfig).set({ lastTestAt: new Date(), lastTestOk: false, lastTestError: message, updatedAt: new Date() })
      .where(eq(aiProviderConfig.id, id));
    return { ok: false, error: message };
  }
}

export async function getProviderKey(id: string): Promise<string | null> {
  const r = (await db.select().from(aiProviderConfig).where(eq(aiProviderConfig.id, id)).limit(1))[0];
  if (!r?.apiKeyEncrypted) return null;
  return decryptSecret(r.apiKeyEncrypted);
}

/** 使用已保存供应商的密钥拉取模型（编辑时 API Key 不回显，不能要求用户重填） */
export async function listModelsForProvider(actor: Actor, id: string, input?: { baseUrl?: string }) {
  assertConfigure(actor);
  const row = await loadProvider(id);
  if (!row) throw forbidden();
  const apiKey = row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null;
  return listRemoteModels(actor, {
    provider: row.provider,
    baseUrl: input?.baseUrl || row.baseUrl,
    apiKey,
  });
}

/** 读取供应商可用模型列表（不落库）：OpenAI 兼容 /models；Ollama /api/tags */
export async function listRemoteModels(actor: Actor, input: { provider: string; baseUrl: string; apiKey?: string | null }) {
  assertConfigure(actor);
  if (!(PROVIDERS as readonly string[]).includes(input.provider)) {
    throw new DomainError("VALIDATION", `供应商只支持 ${PROVIDERS.join(" / ")}`, null);
  }
  await assertSafeOutboundUrl(input.baseUrl);
  const base = input.baseUrl.replace(/\/+$/, "");
  const url = input.provider === "OLLAMA" ? `${base}/api/tags` : `${base}/models`;
  const res = await safeOutboundFetch(url, {
    headers: input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {},
    signal: AbortSignal.timeout(8_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    const authHint = res.status === 401 || res.status === 403 ? "，认证失败，请检查 API Key" : "";
    throw new DomainError("VALIDATION", `获取模型失败：HTTP ${res.status}${authHint}`, null);
  }
  let parsed: { data?: { id?: string }[]; models?: { name?: string }[] };
  try { parsed = JSON.parse(raw); } catch { throw new DomainError("VALIDATION", "模型列表返回不是 JSON", null); }
  const models = input.provider === "OLLAMA"
    ? (parsed.models ?? []).map((m) => m.name).filter((x): x is string => Boolean(x))
    : (parsed.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x));
  return { models: [...new Set(models)].sort() };
}

// ── 用量计数（原子累加）────────────────────────────────────

function periodStartOf(period: "DAY" | "MONTH", now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return period === "DAY" ? d : `${d.slice(0, 7)}-01`;
}

/** 累加用量。**必须是 ON CONFLICT 原子累加**，不能读改写（并发下会丢计数） */
export async function addUsage(memberId: string, delta: { tokens?: number; calls?: number; queries?: number }): Promise<void> {
  for (const period of ["DAY", "MONTH"] as const) {
    await db.execute(sql`
      insert into ai_usage_counter (member_id, period, period_start, embedding_tokens, embedding_calls, query_count, updated_at)
      values (${memberId}, ${period}, ${periodStartOf(period)}::date, ${delta.tokens ?? 0}, ${delta.calls ?? 0}, ${delta.queries ?? 0}, now())
      on conflict (member_id, period, period_start) do update set
        embedding_tokens = ai_usage_counter.embedding_tokens + excluded.embedding_tokens,
        embedding_calls  = ai_usage_counter.embedding_calls  + excluded.embedding_calls,
        query_count      = ai_usage_counter.query_count      + excluded.query_count,
        updated_at = now()
    `);
  }
}

export interface UsageSnapshot { period: string; periodStart: string; embeddingTokens: number; embeddingCalls: number; queryCount: number; limitTokens: number | null; exceeded: boolean }

export async function usageOf(memberId: string): Promise<UsageSnapshot[]> {
  const limitRaw = (await getSettingRaw("ai.limitTokensPerMonth")) as number | string | null;
  const limitTokens = limitRaw === null ? null : Number(limitRaw);
  const rows = await db.select().from(aiUsageCounter).where(eq(aiUsageCounter.memberId, memberId));
  return rows.map((r) => ({
    period: r.period, periodStart: String(r.periodStart),
    embeddingTokens: r.embeddingTokens, embeddingCalls: r.embeddingCalls, queryCount: r.queryCount,
    limitTokens,
    exceeded: limitTokens !== null && r.period === "MONTH" && r.embeddingTokens >= limitTokens,
  }));
}

/**
 * 是否允许**新建索引**（成员级单行原子判定）。
 * ⚠️ 规范的超限策略：**超限只暂停新索引，不阻断检索** —— 因此本函数只被索引路径调用，
 * 检索路径永不调用它。这是刻意的：检索是读行为，停掉它等于知识库下线。
 */
export async function canStartIndexing(memberId: string): Promise<{ ok: boolean; reason?: string }> {
  const snaps = await usageOf(memberId);
  const month = snaps.find((s) => s.period === "MONTH");
  if (month?.exceeded) {
    return { ok: false, reason: `本月 embedding 用量已达上限（${month.embeddingTokens}/${month.limitTokens}），已暂停新建索引；检索不受影响` };
  }
  return { ok: true };
}

export async function summary(actor: Actor) {
  const rows = await listProviders(actor);
  return {
    providers: rows,
    usage: await usageOf(actor.memberId),
    effective: await getSettingRaw("ai.baseUrl") !== null,
  };
}

void inArray; void and;
