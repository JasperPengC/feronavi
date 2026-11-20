/**
 * 知识索引与检索（第十三期，规范 6.4/6.5 + 第 9 节）
 *
 * 三条硬约束：
 *   1 **未配置 AI key 时全部功能必须可用** —— 检索退化为关键词，绝不报错。
 *      规范把 RAG 定为 BYOK，AI 是增强不是前置条件；"没配 key 就不能搜"是不可接受的退化。
 *   2 **维度固定 1024**（规范第 5.7 节写死）：非 1024 维模型必须在配置/调用阶段就被拒，
 *      不能等到写库时才炸（`vector(1024)` 会直接报错，但那时已经浪费了调用与配额）。
 *   3 **生效代原子切换**：切片带 `generation`，检索只取当前生效代 ——
 *      索引过程中旧数据仍可检索，索引进度失败也不会让知识库"消失"。
 */
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { setTimeout as delay } from "node:timers/promises";
import { loadActor } from "../auth/actor-loader.ts";
import { getPage } from "./wiki.service.ts";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, onReservedConnection, sql as nativeSql } from "../../db/index.ts";
import { currentDatabaseContext } from "../../db/context.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { chunkEmbedding, indexJob, knowledgeQueryLog, page, pageChunk, pageRevision, project } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { getSettingRaw } from "./setting.service.ts";
import * as wiki from "./wiki.service.ts";
import { visiblePageCondition } from "./wiki.service.ts";
import { addUsage, canStartIndexing } from "./ai-config.service.ts";

export const EMBEDDING_DIM = 1024;

/** 三次45s对话尝试加退避仍低于会话pending的3分钟回收窗口。 */
const AI_TIMEOUT_MS = 30_000;
const CHAT_TIMEOUT_MS = 45_000;
const CHUNK_MAX_CHARS = 1200;                // 按字符切，近似 token
const ACTIVE_GEN_KEY = "knowledge.active_generation";

// ── 切片 ────────────────────────────────────────────────────

export interface Chunk { headingPath: string | null; content: string; tokenCount: number; contentHash: string }

/** 按 Markdown 标题切块：保留 `H1 > H2` 的标题路径（规范列定义） */
export function chunkMarkdown(content: string): Chunk[] {
  const lines = content.split(/\r?\n/);
  const out: Chunk[] = [];
  let path: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join("\n").trim();
    /**
     * ⚠️ 标题必须**并进块内容**，不能只放在 headingPath：
     *    实测关键词检索搜"反向代理"（它只是个小节标题）返回 0 条 —— 标题词不在正文里就永远搜不到；
     *    顺带也给了向量化必要的上下文。
     */
    const text = body && path.length ? `${path.join(" > ")}\n${body}` : (body || "");
    if (text) {
      // 超长段落再按字符硬切，避免单个巨大块
      for (let i = 0; i < text.length; i += CHUNK_MAX_CHARS) {
        const piece = text.slice(i, i + CHUNK_MAX_CHARS);
        out.push({
          headingPath: path.length ? path.join(" > ") : null,
          content: piece,
          tokenCount: Math.ceil(piece.length / 1.6),        // 中英混排的粗略估算，仅为配额与展示
          contentHash: createHash("sha256").update(piece).digest("hex"),
        });
      }
    }
    buf = [];
  };

  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1]!.length;
      path = [...path.slice(0, level - 1), h[2]!.trim()];
      continue;
    }
    buf.push(line);
  }
  flush();

  // 完全没有正文时（只有标题的页面）也要产出一个块，否则该页永远搜不到
  if (out.length === 0) {
    const text = content.trim() || "（空文档）";
    out.push({
      headingPath: path.length ? path.join(" > ") : null,
      content: text, tokenCount: Math.ceil(text.length / 1.6),
      contentHash: createHash("sha256").update(text).digest("hex"),
    });
  }
  return out;
}

// ── BYOK 配置与调用 ─────────────────────────────────────────

export interface AiConfig { baseUrl: string; apiKey: string; model: string; dimensions: number }

/** 读 BYOK 配置；未配置返回 null（**不是错误**） */
export async function loadAiConfig(): Promise<AiConfig | null> {
  const enabled = (await getSettingRaw("ai.enabled")) as boolean | null;
  if (enabled === false) return null;
  const baseUrl = (await getSettingRaw("ai.baseUrl")) as string | null;
  const model = (await getSettingRaw("ai.model")) as string | null;
  if (!baseUrl || !model) return null;
  const key = (await getSettingRaw("ai.apiKey")) as string | null;
  const dimRaw = (await getSettingRaw("ai.dimensions")) as number | string | null;
  const dimensions = Number(dimRaw ?? EMBEDDING_DIM);
  if (dimensions !== EMBEDDING_DIM) {
    // 规范：非 1024 维模型必须在设置阶段被拒绝
    throw new DomainError("VALIDATION",
      `embedding 维度必须是 ${EMBEDDING_DIM}（当前配置为 ${dimensions}）；维度与库内 vector(${EMBEDDING_DIM}) 必须一致`,
      { dimensions });
  }
  return { baseUrl, apiKey: key ?? "", model, dimensions };
}

/** 对话模型配置（与 embedding 分开；未配置返回 null） */
export async function loadChatConfig(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  const baseUrl = (await getSettingRaw("ai.chatBaseUrl")) as string | null;
  const model = (await getSettingRaw("ai.chatModel")) as string | null;
  if (!baseUrl || !model) return null;
  const apiKey = (await getSettingRaw("ai.chatApiKey")) as string | null;
  return { baseUrl, apiKey: apiKey ?? "", model };
}

export interface EmbedResult { ok: boolean; vectors?: number[][]; reason?: string; tokens?: number }

/**
 * 调 BYOK 的 embeddings 接口（OpenAI 兼容）。
 * **未配置 → `{ok:false, reason}` 而不抛错**（BYOK 是增强，不是前置条件）。
 */
export async function embed(texts: string[], opts: { fetchImpl?: typeof fetch } = {}): Promise<EmbedResult> {
  const cfg = await loadAiConfig();
  if (!cfg) return { ok: false, reason: "未配置 AI（BYOK）" };
  if (texts.length === 0) return { ok: true, vectors: [], tokens: 0 };

  const fetchImpl: typeof fetch = (input, init) => safeOutboundFetch(String(input), init, opts.fetchImpl);
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      /**
       * ⚠️ **必须带超时**：AI 供应商慢或挂死时，没有超时的 fetch 会让索引请求无限等待，
       * 且挂起的 socket 会让进程无法退出（实测：e2e 套件跑完断言后不退出、被超时杀掉）。
       */
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `模型服务返回 ${res.status}` };
    const body = (await res.json()) as { data?: { embedding: number[] }[]; usage?: { total_tokens?: number } };
    const vectors = (body.data ?? []).map((d) => d.embedding);
    if (vectors.length !== texts.length) return { ok: false, reason: "模型返回的向量条数与输入不一致" };
    for (const v of vectors) {
      if (v.length !== EMBEDDING_DIM) {
        // 早失败：不写库、不浪费配额，并把维度差说清楚
        return { ok: false, reason: `模型返回 ${v.length} 维向量，与库内 vector(${EMBEDDING_DIM}) 不一致` };
      }
    }
    return { ok: true, vectors, tokens: body.usage?.total_tokens ?? 0 };
  } catch (e) {
    return { ok: false, reason: `调用失败：${(e as Error).message}` };
  }
}

// ── 索引任务 ────────────────────────────────────────────────

export async function activeGeneration(): Promise<number> {
  const v = (await getSettingRaw(ACTIVE_GEN_KEY)) as number | string | null;
  return Number(v ?? 1);
}

/** 全局代是已激活上界；每页使用该上界内最近一次成功重建，不能被其他页面换代隐藏。 */
function effectiveChunkGeneration(generation: number) {
  return sql`${pageChunk.generation} = (select max(j.generation) from ${indexJob} j
    where j.page_id = ${pageChunk.pageId} and j.status = 'SUCCEEDED'
      and j.activated_at is not null and j.generation <= ${generation})`;
}

/** 知识派生数据必须复用 Wiki 页面的项目范围与 ACL 可见性。 */
async function assertKnowledgePageVisible(actor: Actor, pageId: string) {
  const visible = await visiblePageCondition(actor);
  const p = (await db.select().from(page).where(and(
    eq(page.id, pageId),
    sql`${page.deletedAt} is null`,
    visible,
  )).limit(1))[0];
  if (!p) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, p.projectId, actor.grants.some((g) => g.scopeType === "ORG")))) {
    throw forbidden();
  }
  return p;
}

function assertCanIndex(actor: Actor, projectId: string) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "page:update_any", { projectId, teamId: null }, ctx)) throw forbidden();
}

const indexLock = new AsyncLocalStorage<{ active: boolean }>();
/** 手工索引与恢复重建共享锁，避免恢复激活新代时覆盖同时写入的索引。 */
export async function withKnowledgeIndexLock<T>(run: () => Promise<T>): Promise<T> {
  if (indexLock.getStore()?.active) return run();
  const context = { active: true };
  if (currentDatabaseContext()?.transaction) {
    await nativeSql`select pg_advisory_xact_lock(hashtextextended('feronavi.knowledge-index.v1',0))`;
    try { return await indexLock.run(context, run); } finally { context.active = false; }
  }
  const connection = await nativeSql.reserve();
  let locked = false;
  try {
    await connection`select pg_advisory_lock(hashtextextended('feronavi.knowledge-index.v1',0))`;
    locked = true;
    return await onReservedConnection(connection, () => indexLock.run(context, run));
  } finally {
    context.active = false;
    if (locked) await connection`select pg_advisory_unlock(hashtextextended('feronavi.knowledge-index.v1',0))`.catch(async () => {
      await connection`select pg_terminate_backend(pg_backend_pid())`.catch(() => {});
    });
    connection.release();
  }
}

/**
 * 建切片并尽量写向量。**可重入**：按 `content_hash` 判重，同内容不重复产出；
 * 未配置 AI 时照常建切片（关键词检索可用），只是没有向量。
 */
type IndexOptions = { generation?: number; activate?: boolean; skipEmbedding?: boolean };

export async function reindexPage(actor: Actor, pageId: string, mode: "INCREMENTAL" | "FULL" = "INCREMENTAL", options: IndexOptions = {}) {
  return withKnowledgeIndexLock(() => reindexPageAuthorized(actor, pageId, mode, false, undefined, options));
}

export async function reindexPublishedPage(actor: Actor, pageId: string, revisionId: string) {
  return withKnowledgeIndexLock(() => reindexPageAuthorized(actor, pageId, "FULL", true, revisionId));
}

async function reindexPageAuthorized(actor: Actor, pageId: string, mode: "INCREMENTAL" | "FULL", pageWriter: boolean, expectedRevisionId?: string, options: IndexOptions = {}) {
  const p = (await db.select().from(page).where(and(eq(page.id, pageId), sql`${page.deletedAt} is null`)).limit(1))[0];
  if (!p) throw new DomainError("NOT_FOUND", "页面不存在", null);
  // 项目数据范围优先（与页面读取同一纪律）
  if (!(await projectRepo.isVisibleTo(actor.memberId, p.projectId, actor.grants.some((g) => g.scopeType === "ORG")))) {
    throw forbidden();
  }
  if (pageWriter) await wiki.assertPageWritable(actor, pageId, p.projectId);
  else assertCanIndex(actor, p.projectId);
  const targetRevisionId = expectedRevisionId ?? p.currentRevisionId;
  const rev = targetRevisionId
    ? (await db.select().from(pageRevision).where(and(eq(pageRevision.id, targetRevisionId), eq(pageRevision.pageId, pageId))).limit(1))[0]
    : null;
  if (!rev) throw new DomainError("VALIDATION", "页面没有正文版本，无法索引", null);

  // 超限只暂停**新建索引**（规范明示：不阻断检索）
  if (!options.skipEmbedding) {
    const gate = await canStartIndexing(actor.memberId);
    if (!gate.ok) throw new DomainError("CONFLICT", gate.reason ?? "用量已达上限", { limit: true });
  }

  const chunks = chunkMarkdown(rev.content);
  const active = await activeGeneration();
  const [latest] = await db.select({ generation: sql<number>`coalesce(max(${indexJob.generation}), 0)` }).from(indexJob);
  const generation = options.generation ?? Math.max(active, Number(latest?.generation ?? 0)) + 1;
  const [job] = await db.insert(indexJob).values({
    pageId, mode, status: "RUNNING", total: chunks.length, generation,
    startedAt: new Date(), heartbeatAt: new Date(),
  }).returning();

  // 增量：同内容哈希直接复用（判重列就是为这个存在的）
  const existing = await db.select({ id: pageChunk.id, h: pageChunk.contentHash }).from(pageChunk)
    .where(eq(pageChunk.pageId, pageId)).orderBy(desc(pageChunk.generation));
  const known = new Map<string, string>();
  for (const row of existing) if (!known.has(row.h)) known.set(row.h, row.id);
  const cfg = options.skipEmbedding ? null : await loadAiConfig();
  const model = `${cfg?.model ?? "unknown"}-${EMBEDDING_DIM}`;

  let processed = 0, reused = 0, failed = 0, embedded = 0;
  const insertedIds: string[] = [];
  const pendingTexts: string[] = [];
  // 每个成功代必须包含本页完整切片；复用内容也要挂到当前正文版本和新代。
  for (const c of chunks) {
    try {
      const source = mode === "FULL" ? undefined : known.get(c.contentHash);
      const [row] = await db.insert(pageChunk).values({
        pageId, revisionId: rev.id, headingPath: c.headingPath, content: c.content,
        tokenCount: c.tokenCount, contentHash: c.contentHash, generation,
      }).returning({ id: pageChunk.id });
      if (source) reused++; else processed++;
      const [cached] = source && cfg ? await db.select({ vector: chunkEmbedding.vector }).from(chunkEmbedding)
        .where(and(eq(chunkEmbedding.chunkId, source), eq(chunkEmbedding.model, model))).limit(1) : [];
      if (cached) {
        await db.insert(chunkEmbedding).values({ chunkId: row!.id, model, vector: cached.vector });
        embedded++;
      } else {
        insertedIds.push(row!.id);
        pendingTexts.push(c.content);
      }
    } catch {
      failed++;
    }
  }

  // 有 AI 配置就写向量；没有就跳过（关键词检索仍可用）
  let embedReason: string | null = null;
  if (insertedIds.length && !options.skipEmbedding) {
    const r = await embed(pendingTexts);
    if (r.ok && r.vectors) {
      // 用量累加：原子 ON CONFLICT（并发下不丢计数）
      await addUsage(actor.memberId, { tokens: r.tokens ?? 0, calls: 1 });
      for (let i = 0; i < insertedIds.length; i++) {
        const vec = r.vectors[i]!;
        await db.insert(chunkEmbedding).values({
          chunkId: insertedIds[i]!, model,
          vector: `[${vec.join(",")}]` as unknown as string,
        });
        embedded++;
      }
    } else {
      embedReason = r.reason ?? "未配置";
    }
  }

  const okJob = failed === 0;
  await db.update(indexJob).set({
    status: okJob ? "SUCCEEDED" : "FAILED",
    processed: processed + reused, failed, errorMessage: embedReason, finishedAt: new Date(),
  }).where(eq(indexJob.id, job!.id));
  // 原子切换生效代：只有成功才切，失败时旧代仍在服务
  if (okJob && options.activate !== false) {
    await db.transaction(async () => {
      await db.update(indexJob).set({ activatedAt: new Date() }).where(eq(indexJob.id, job!.id));
      await db.execute(sql`
        insert into setting (key, value, is_secret, updated_at) values (${ACTIVE_GEN_KEY}, ${JSON.stringify(generation)}::jsonb, false, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `);
    });
  }
  return { jobId: job!.id, generation, total: chunks.length, inserted: processed, reused, failed, embedded, embedReason, activeGeneration: await activeGeneration() };
}

// ── 检索（无 key 也能用）──────────────────────────────────────

export interface KnowledgeHit { chunkId: string; pageId: string; title: string; headingPath: string | null; snippet: string; score: number; mode: "vector" | "keyword" }

/**
 * 知识检索：有 AI 配置走向量（缺向量时自动回落关键词），没配置走**关键词**。
 * 无论哪种模式，都必须**套页面的可见性条件** —— 否则受限页会从知识检索泄露。
 */
/** 检索日志（规范 9 节）：只落 **SHA-256**，不落原文；失败不阻断检索 */
async function logKnowledgeQuery(actor: Actor, projectId: string, q: string, citationCount: number, latencyMs: number): Promise<void> {
  await db.insert(knowledgeQueryLog).values({
    memberId: actor.memberId,
    queryHash: createHash("sha256").update(q).digest("hex"),
    citationCount,
    latencyMs: Math.max(0, latencyMs),
    tokenUsage: 0,
    projectId,
  });
}

/**
 * 知识检索（带检索日志）：时间只包住核心检索；日志写入失败不阻断（观测不是业务前提）。
 */
export async function searchKnowledge(actor: Actor, projectId: string, q: string, limit = 10): Promise<{ mode: string; hits: KnowledgeHit[]; note?: string }> {
  const startedAt = Date.now();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, actor.grants.some((g) => g.scopeType === "ORG")))) {
    throw forbidden();
  }
  const found = await searchKnowledgeInProjects(actor, [projectId], q, limit);
  // 原单项目契约不增加项目元数据。
  const result = { ...found, hits: found.hits.map(({ chunkId, pageId, title, headingPath, snippet, score, mode }) => ({ chunkId, pageId, title, headingPath, snippet, score, mode })) };
  void logKnowledgeQuery(actor, projectId, q, result.hits.length, Date.now() - startedAt).catch(() => { /* 不阻断 */ });
  return result;
}

export interface ProjectKnowledgeHit extends KnowledgeHit { projectId: string; projectName: string }

/** 仅接受调用方已校验的项目范围；单次 embedding 在整个授权集合内排序。 */
export async function searchKnowledgeInProjects(actor: Actor, projectIds: string[], q: string, limit = 10): Promise<{ mode: "vector" | "keyword"; hits: ProjectKnowledgeHit[]; note?: string }> {
  if (!projectIds.length) return { mode: "keyword", hits: [], note: "没有可访问的非归档项目" };
  const visible = await visiblePageCondition(actor);
  const gen = await activeGeneration();

  // 检索计数与超限无关：规范要求超限不阻断检索（这是读行为）
  await addUsage(actor.memberId, { queries: 1 });

  /**
   * 关键词检索。
   * ⚠️ `plainto_tsquery` 要求**所有词元都命中**，对自然语言问句极脆：
   * 实测「反向代理」能命中，「反向代理要配什么」返回 0 条（"要配什么"把查询拖死）。
   * 故命中为空时，用 zhparser 切出的词元做 **OR 重试**（`term1 | term2 | …`）。
   */
  const keyword = async (): Promise<ProjectKnowledgeHit[]> => {
    const hits = await keywordWith("plainto_tsquery");
    if (hits.length > 0) return hits;
    return keywordWith("or");
  };

  const keywordWith = async (mode: "plainto_tsquery" | "or"): Promise<ProjectKnowledgeHit[]> => {
    // 始终保持**参数化**：只有「词元串」在 OR 模式下由 PG 自己切出来（不是用户原文），
    // 且它仍是绑定值而非拼进 SQL 字面量（早先用 raw 拼 $Q$ 直接把占位符发给了 PG）
    let terms: string | null = null;
    if (mode === "or") {
      const lex = await db.execute<{ tsq: string | null }>(sql`
        select array_to_string(tsvector_to_array(to_tsvector('chinese_zh', ${q})), ' | ') as tsq
      `);
      terms = (lex[0]?.tsq ?? "").trim() || null;
      if (!terms) return [];
    }
    const docVec = sql`to_tsvector('chinese_zh', ${pageChunk.content})`;
    const query = mode === "or"
      ? sql`to_tsquery('chinese_zh', ${terms})`
      : sql`plainto_tsquery('chinese_zh', ${q})`;
    const rows = await db.select({
      chunkId: pageChunk.id, pageId: pageChunk.pageId, headingPath: pageChunk.headingPath,
      content: pageChunk.content, title: page.title, projectId: page.projectId, projectName: project.name,
      rank: sql<number>`ts_rank(${docVec}, ${query})`,
    }).from(pageChunk)
      .innerJoin(page, eq(page.id, pageChunk.pageId))
      .innerJoin(project, eq(project.id, page.projectId))
      .where(and(
        inArray(page.projectId, projectIds),
        effectiveChunkGeneration(gen),
        eq(pageChunk.revisionId, page.currentRevisionId),
        sql`${page.deletedAt} is null`,
        visible,
        sql`${docVec} @@ ${query}`,
      ))
      .orderBy(sql`ts_rank(${docVec}, ${query}) desc`)
      .limit(limit);
    return rows.map((r) => ({
      chunkId: r.chunkId, pageId: r.pageId, title: r.title, headingPath: r.headingPath, projectId: r.projectId, projectName: r.projectName,
      snippet: r.content.slice(0, 160), score: Number(r.rank ?? 0), mode: "keyword" as const,
    }));
  };

  const cfg = await loadAiConfig().catch(() => null);
  if (!cfg) {
    // 未配置 AI：**这不是错误**，退化为关键词（BYOK 是增强不是前置条件）
    return { mode: "keyword", hits: await keyword(), note: "未配置 AI（BYOK），已退化为关键词检索" };
  }
  const qv = await embed([q]);
  if (!qv.ok || !qv.vectors?.[0]) {
    return { mode: "keyword", hits: await keyword(), note: `向量检索不可用（${qv.reason}），已退化为关键词检索` };
  }
  const vec = `[${qv.vectors[0]!.join(",")}]`;
  const rows = await db.select({
    chunkId: pageChunk.id, pageId: pageChunk.pageId, headingPath: pageChunk.headingPath,
    content: pageChunk.content, title: page.title, projectId: page.projectId, projectName: project.name,
    dist: sql<number>`${chunkEmbedding.vector} <=> ${vec}::vector`,
  }).from(chunkEmbedding)
    .innerJoin(pageChunk, eq(pageChunk.id, chunkEmbedding.chunkId))
    .innerJoin(page, eq(page.id, pageChunk.pageId))
    .innerJoin(project, eq(project.id, page.projectId))
    .where(and(
      inArray(page.projectId, projectIds), effectiveChunkGeneration(gen),
      eq(chunkEmbedding.model, `${cfg.model}-${EMBEDDING_DIM}`),
      eq(pageChunk.revisionId, page.currentRevisionId),
      sql`${page.deletedAt} is null`, visible,
    ))
    .orderBy(sql`${chunkEmbedding.vector} <=> ${vec}::vector`)
    .limit(limit);
  if (rows.length === 0) {
    return { mode: "keyword", hits: await keyword(), note: "尚无向量索引，已退化为关键词检索" };
  }
  return {
    mode: "vector",
    hits: rows.map((r) => ({
      chunkId: r.chunkId, pageId: r.pageId, title: r.title, headingPath: r.headingPath, projectId: r.projectId, projectName: r.projectName,
      snippet: r.content.slice(0, 160), score: 1 - Number(r.dist ?? 1), mode: "vector" as const,
    })),
  };
}

export async function listJobs(actor: Actor, pageId: string) {
  await assertKnowledgePageVisible(actor, pageId);
  return db.select().from(indexJob).where(eq(indexJob.pageId, pageId)).orderBy(desc(indexJob.createdAt)).limit(50);
}

export interface PageChunkPreview {
  id: string;
  headingPath: string | null;
  content: string;
  tokenCount: number;
  createdAt: Date;
  hasVector: boolean;
}

/** 只读本页已激活的最近成功代、当前正文版本，不暴露 hash 或向量本体。 */
export async function listPageChunks(actor: Actor, pageId: string): Promise<{
  generation: number;
  revisionId: string | null;
  chunks: PageChunkPreview[];
}> {
  const p = await assertKnowledgePageVisible(actor, pageId);
  if (!p.currentRevisionId) return { generation: 0, revisionId: null, chunks: [] };
  const active = await activeGeneration();
  const [job] = await db.select({ generation: indexJob.generation }).from(indexJob)
    .where(and(eq(indexJob.pageId, pageId), eq(indexJob.status, "SUCCEEDED"), sql`${indexJob.activatedAt} is not null`, sql`${indexJob.generation} <= ${active}`))
    .orderBy(desc(indexJob.generation)).limit(1);
  const generation = job?.generation ?? 0;
  const rows = await db.select({
    id: pageChunk.id,
    headingPath: pageChunk.headingPath,
    content: pageChunk.content,
    tokenCount: pageChunk.tokenCount,
    createdAt: pageChunk.createdAt,
    // select 字段内的 ORM 列可能去掉表前缀；相关子查询须显式限定外层切片。
    hasVector: sql<boolean>`exists (select 1 from chunk_embedding e where e.chunk_id = "page_chunk"."id")`,
  }).from(pageChunk)
    .where(and(
      eq(pageChunk.pageId, pageId),
      eq(pageChunk.revisionId, p.currentRevisionId),
      eq(pageChunk.generation, generation),
    ))
    .orderBy(pageChunk.createdAt, pageChunk.id);
  return { generation, revisionId: p.currentRevisionId, chunks: rows.map((r) => ({ ...r, hasVector: Boolean(r.hasVector) })) };
}



// ── 知识问答（带引用）────────────────────────────────────────

export interface AskResult {
  ok: boolean;
  answer: string | null;
  citations: { pageId: string; title: string; headingPath: string | null; snippet: string }[];
  mode: "vector" | "keyword" | "none";
  note?: string;
}

/**
 * 知识问答（规范 4.9 节 `ask.knowledge`：**只读、不产生副作用、带引用**）
 *
 * 与检索一样的硬约束：**未配置 AI 时不是错误** —— 退回"把相关片段原样给出来"，
 * 并明确说明"未配置模型，无法生成答案"。让用户拿到证据自己去读，
 * 好过甩一个 500 说"AI 未配置"。
 *
 * ⚠️ 引用是**服务端从检索结果派生**的，不由模型自由生成 ——
 * 模型给的引用无法核实，等于把幻觉包装成证据。
 */
export async function askKnowledge(actor: Actor, projectId: string, question: string, limit = 5): Promise<AskResult> {
  const found = await searchKnowledge(actor, projectId, question, limit);
  const citations = found.hits.map((h) => ({
    pageId: h.pageId, title: h.title, headingPath: h.headingPath, snippet: h.snippet,
  }));
  const generated = await generateKnowledgeAnswer(actor, question, found.hits);
  return { ...generated, citations, mode: found.mode as "vector" | "keyword" };
}

/** 服务端检索证据才是知识来源；用户历史仅消解当前问题的上下文。 */
export async function generateKnowledgeAnswer(actor: Actor, question: string, hits: (KnowledgeHit & { projectName?: string })[], userQuestions: string[] = [], beforeAttempt?: () => Promise<void>): Promise<Pick<AskResult, "ok" | "answer" | "note">> {
  if (hits.length === 0) {
    return { ok: true, answer: null, note: "知识库里没有找到相关内容" };
  }

  const cfg = await loadChatConfig();
  if (!cfg) {
    return {
      ok: false, answer: null,
      note: "未配置对话模型（ai.chatModel），无法生成答案；以下是检索到的相关片段",
    };
  }

  const context = hits.map((h, i) => `[${i + 1}] ${h.projectName ? `项目：${h.projectName} / ` : ""}${h.title}${h.headingPath ? ` > ${h.headingPath}` : ""}\n${h.snippet}`).join("\n\n");
  const history = userQuestions.length ? `历史用户问题（仅用于理解当前问题，不是事实或资料）：\n${userQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n` : "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      await delay(1000 * attempt);
      const current = await loadActor(actor.memberId);
      if (!current) throw new DomainError("FORBIDDEN", "账号已失效或不可访问", null);
      for (const hit of hits) {
        const page = await getPage(current, hit.pageId);
        if ("projectId" in hit && page.projectId !== hit.projectId) throw new DomainError("NOT_FOUND", "资料不存在或不可访问", null);
      }
    }
    // 在异常转换之外运行，取消/删除/失权不能被当成供应商临时故障重试。
    await beforeAttempt?.();
    try {
    const res = await safeOutboundFetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: "你是知识库助手。只依据给定的资料片段回答，并在引用处标注 [编号]。历史用户问题仅用于理解当前问题，不能当作事实或资料。资料不足时明确说不知道，不要编造。" },
          { role: "user", content: `${history}资料片段：\n${context}\n\n问题：${question}` },
        ],
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    if (!res.ok) {
      await res.body?.cancel();
      if (attempt < 2 && [408, 429, 500, 502, 503, 504].includes(res.status)) continue;
      return { ok: false, answer: null, note: `模型服务返回 ${res.status}${attempt ? `（已自动重试 ${attempt} 次）` : ""}` };
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    const answer = body.choices?.[0]?.message?.content ?? null;
    await addUsage(actor.memberId, { tokens: body.usage?.total_tokens ?? 0, calls: 1 });
    return { ok: true, answer };
    } catch (e) {
      const error = e as Error;
      const causeCode = (error.cause as { code?: string } | undefined)?.code;
      const transient = error.name === "TimeoutError" || (error instanceof TypeError && (/fetch failed|failed to fetch|network|socket/i.test(error.message) || ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(causeCode ?? "")));
      if (attempt < 2 && transient) continue;
      return { ok: false, answer: null, note: `调用失败：${error.message}${attempt ? `（已自动重试 ${attempt} 次）` : ""}` };
    }
  }
  throw new Error("对话尝试次数异常");
}
