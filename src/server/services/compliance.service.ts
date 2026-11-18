/**
 * RAG 合规留痕 · Skill · 研发活跃度（第十三期收口）
 *
 * 合规立场（规范 2.7 / A35，必须原样落实）：
 *   `rag_consent` 是**记录位，不是门禁** —— 平台**不阻断、不校验**出境路径，
 *   也不对 `cross_border_path` 做取值约束。它是给组织方的举证工具，不是平台的裁判权。
 *   因此本文件只做"如实记录 + 可查可撤"，不做任何"未同意则禁止调用"的拦截。
 */
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { aiProviderConfig, devActivityDaily, member, ragConsent, skill } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
function assertPerm(actor: Actor, action: string, projectId: string | null) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, action, { projectId, teamId: null }, ctx)) throw forbidden();
}

// ── RAG 同意记录（只记录，不拦截）──────────────────────────────

export async function recordConsent(actor: Actor, input: {
  providerConfigId: string; purposeTextSnapshot: string; crossBorder: boolean;
  crossBorderPath?: string | null; piaRecord?: Record<string, unknown> | null;
}) {
  const provider = (await db.select({ id: aiProviderConfig.id }).from(aiProviderConfig)
    .where(eq(aiProviderConfig.id, input.providerConfigId)).limit(1))[0];
  if (!provider) throw new DomainError("NOT_FOUND", "AI 供应商配置不存在", null);
  // 同意是**本人行为**：不代他人记录（举证的价值在于"谁同意的"）
  const [row] = await db.insert(ragConsent).values({
    providerConfigId: input.providerConfigId,
    memberId: actor.memberId,
    purposeTextSnapshot: input.purposeTextSnapshot,
    crossBorder: input.crossBorder,
    crossBorderPath: input.crossBorderPath ?? null,
    piaRecord: (input.piaRecord ?? null) as object | null,
  }).returning();
  return row;
}

export async function listConsents(actor: Actor, opts: { all?: boolean } = {}) {
  if (opts.all) {
    assertPerm(actor, "ai:configure", null);          // 组织级查阅需 ai:configure
    return db.select().from(ragConsent).orderBy(desc(ragConsent.consentedAt)).limit(200);
  }
  // 本人可查自己的记录（数据可携带权：自己的同意记录自己能看）
  return db.select().from(ragConsent).where(eq(ragConsent.memberId, actor.memberId))
    .orderBy(desc(ragConsent.consentedAt)).limit(50);
}

export async function revokeConsent(actor: Actor, id: string) {
  const row = (await db.select().from(ragConsent).where(eq(ragConsent.id, id)).limit(1))[0];
  if (!row) throw new DomainError("NOT_FOUND", "同意记录不存在", null);
  if (row.memberId !== actor.memberId) assertPerm(actor, "ai:configure", null);
  const [updated] = await db.update(ragConsent).set({ revokedAt: new Date() }).where(eq(ragConsent.id, id)).returning();
  return updated;
}

// ── 研发活跃度 ────────────────────────────────────────────────

/** 写入/累加某成员某日的活跃度（数据入口：集成同步或 webhook；`integration` 表未落地前的落点） */
export async function upsertDevActivity(memberId: string, date: string, delta: { commits?: number; prs?: number; reviews?: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError("VALIDATION", "date 必须是 YYYY-MM-DD", null);
  await db.execute(sql`
    insert into dev_activity_daily (member_id, date, commits, prs, reviews)
    values (${memberId}, ${date}::date, ${delta.commits ?? 0}, ${delta.prs ?? 0}, ${delta.reviews ?? 0})
    on conflict (member_id, date) do update set
      commits = dev_activity_daily.commits + excluded.commits,
      prs     = dev_activity_daily.prs     + excluded.prs,
      reviews = dev_activity_daily.reviews + excluded.reviews
  `);
}

/** 集成方写入入口：批量 upsert 日活跃度（`integration:manage`）。
 *  - 每行用 memberId 或 username 指定成员（二选一；都缺失/找不到 → VALIDATION，带行号）
 *  - 单次上限 500 行；同 (member_id, date) 累加（与 upsertDevActivity 同一语义）
 *  - 整批一个事务：部分失败不落半批；写一次安全审计（只记"导入了多少行"，不记明细）
 */
export interface DevActivityIngestRow {
  memberId?: string; username?: string; date: string;
  commits?: number; prs?: number; reviews?: number;
}

export async function ingestDevActivity(actor: Actor, rows: DevActivityIngestRow[]) {
  assertPerm(actor, "integration:manage", null);
  if (!Array.isArray(rows) || rows.length === 0) throw new DomainError("VALIDATION", "rows 不能为空", null);
  if (rows.length > 500) throw new DomainError("VALIDATION", "单次最多写入 500 行", null);

  const wantedNames = [...new Set(rows.map((r) => r.username?.toLowerCase()).filter((x): x is string => !!x))];
  const wantedIds = [...new Set(rows.map((r) => r.memberId).filter((x): x is string => !!x))];
  const found = await db.select({ id: member.id, username: member.username }).from(member).where(
    or(
      wantedNames.length ? inArray(member.username, wantedNames) : sql`false`,
      wantedIds.length ? inArray(member.id, wantedIds) : sql`false`,
    ),
  );
  const byId = new Map(found.map((m) => [m.id, m]));
  const byName = new Map(found.map((m) => [m.username.toLowerCase(), m]));

  const resolved = rows.map((r, idx) => {
    const date = (r.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new DomainError("VALIDATION", `第 ${idx + 1} 行 date 必须是 YYYY-MM-DD`, { row: idx + 1 });
    }
    const nums = ["commits", "prs", "reviews"] as const;
    for (const k of nums) {
      const v = r[k];
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 1_000_000)) {
        throw new DomainError("VALIDATION", `第 ${idx + 1} 行 ${k} 必须是非负整数`, { row: idx + 1 });
      }
    }
    const m = r.memberId ? byId.get(r.memberId) : r.username ? byName.get(r.username.toLowerCase()) : undefined;
    if (!m) throw new DomainError("VALIDATION", `第 ${idx + 1} 行成员不存在（memberId / username 均未命中）`, { row: idx + 1 });
    return { memberId: m.id, date, commits: r.commits ?? 0, prs: r.prs ?? 0, reviews: r.reviews ?? 0 };
  });

  await db.transaction(async (tx) => {
    for (const r of resolved) {
      await tx.execute(sql`
        insert into dev_activity_daily (member_id, date, commits, prs, reviews)
        values (${r.memberId}, ${r.date}::date, ${r.commits}, ${r.prs}, ${r.reviews})
        on conflict (member_id, date) do update set
          commits = dev_activity_daily.commits + excluded.commits,
          prs     = dev_activity_daily.prs     + excluded.prs,
          reviews = dev_activity_daily.reviews + excluded.reviews
      `);
    }
  });

  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "dev_activity.ingested", targetType: "INTEGRATION",
      changes: undefined,
    });
  }
  return { accepted: resolved.length, members: new Set(resolved.map((r) => r.memberId)).size };
}

/** 项目研发活跃度：按成员聚合（只统计项目成员，避免把外部人的活跃度算进来） */
export async function projectDevActivity(actor: Actor, projectId: string, opts: { from?: string; to?: string } = {}) {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
  const conds = [];
  if (opts.from) conds.push(gte(devActivityDaily.date, opts.from));
  if (opts.to) conds.push(lte(devActivityDaily.date, opts.to));
  const rows = await db.select({
    memberId: devActivityDaily.memberId, name: member.name, username: member.username,
    commits: sql<number>`sum(${devActivityDaily.commits})::int`,
    prs: sql<number>`sum(${devActivityDaily.prs})::int`,
    reviews: sql<number>`sum(${devActivityDaily.reviews})::int`,
    days: sql<number>`count(*)::int`,
  }).from(devActivityDaily)
    .innerJoin(member, eq(member.id, devActivityDaily.memberId))
    .where(conds.length ? and(...conds) : sql`true`)
    .groupBy(devActivityDaily.memberId, member.name, member.username)
    .orderBy(desc(sql`sum(${devActivityDaily.commits})`))
    .limit(100);
  return { members: rows, note: "可由集成方 POST /api/v1/dev-activity 批量写入（integration 表尚未落地，暂无自动同步）" };
}

// ── Skill ─────────────────────────────────────────────────────

export async function createSkill(actor: Actor, input: { name: string; manifest?: Record<string, unknown>; appliesTo?: string | null }) {
  assertPerm(actor, "ai:configure", null);
  const dup = (await db.select({ id: skill.id }).from(skill).where(eq(skill.name, input.name)).limit(1))[0];
  if (dup) throw new DomainError("VALIDATION", `同名 Skill 已存在：${input.name}`, null);
  const [row] = await db.insert(skill).values({
    name: input.name, manifest: (input.manifest ?? {}) as object, appliesTo: input.appliesTo ?? null,
  }).returning();
  return row;
}

export async function listSkills(actor: Actor, opts: { onlyEnabled?: boolean } = {}) {
  assertPerm(actor, "ai:configure", null);
  const rows = opts.onlyEnabled
    ? await db.select().from(skill).where(eq(skill.enabled, true)).orderBy(asc(skill.name))
    : await db.select().from(skill).orderBy(asc(skill.name));
  return rows;
}

export async function updateSkill(actor: Actor, id: string, patch: { name?: string; manifest?: Record<string, unknown>; enabled?: boolean; appliesTo?: string | null }) {
  assertPerm(actor, "ai:configure", null);
  const [row] = await db.update(skill).set({ ...patch, updatedAt: new Date() } as object).where(eq(skill.id, id)).returning();
  if (!row) throw new DomainError("NOT_FOUND", "Skill 不存在", null);
  return row;
}

export async function deleteSkill(actor: Actor, id: string): Promise<void> {
  assertPerm(actor, "ai:configure", null);
  await db.delete(skill).where(eq(skill.id, id));
}
