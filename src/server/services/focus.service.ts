/**
 * 时间块与今日聚焦（第十一期，规范 3.5 + REST 5 节）
 *
 * 三条规则：
 *   1 **时间块不得重叠** —— 规范明示由**应用层事务校验**（PG 的 tstzrange 排他约束需 btree_gist，v1 不引入）
 *   2 全部「仅本人」：不涉及数据范围，别人的块对自己不可见（也不可改）
 *   3 **进行中的聚焦会话不落库**（规范：放 Valkey）；落库的是已结束的会话记录
 */
import { and, asc, desc, eq, gt, gte, lt, lte, ne } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { focusSession, timeBlock } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";

function assertOwn(actor: Actor, memberId: string) {
  if (memberId !== actor.memberId) throw new DomainError("FORBIDDEN", "只能操作自己的时间块", null);
}

/** 重叠判定：`start < 对方.end && end > 对方.start`（半开区间语义，端点相接不算重叠） */
export async function assertNoOverlap(actor: Actor, startAt: Date, endAt: Date, excludeId?: string): Promise<void> {
  const conds = [
    eq(timeBlock.memberId, actor.memberId),
    lt(timeBlock.startAt, endAt),
    // ⚠️ 必须用 gt()：把 JS Date 直接塞进 sql 模板时 postgres.js 不会做 timestamptz 序列化（实测报 Failed query）
    gt(timeBlock.endAt, startAt),
  ];
  if (excludeId) conds.push(ne(timeBlock.id, excludeId));
  const hit = await db.select({ id: timeBlock.id, title: timeBlock.title, startAt: timeBlock.startAt, endAt: timeBlock.endAt })
    .from(timeBlock).where(and(...conds)).limit(1);
  if (hit[0]) {
    throw new DomainError("CONFLICT", `与已有时间块「${hit[0].title}」重叠`, {
      conflicting: { id: hit[0].id, startAt: hit[0].startAt, endAt: hit[0].endAt },
    });
  }
}

export async function listBlocks(actor: Actor, opts: { from?: string; to?: string } = {}) {
  const conds = [eq(timeBlock.memberId, actor.memberId)];
  if (opts.from) conds.push(gte(timeBlock.startAt, new Date(opts.from)));
  if (opts.to) conds.push(lte(timeBlock.startAt, new Date(opts.to)));
  return db.select().from(timeBlock).where(and(...conds)).orderBy(asc(timeBlock.startAt)).limit(500);
}

export async function createBlock(actor: Actor, input: {
  title: string; startAt: string; endAt: string;
  projectId?: string | null; workItemId?: string | null; color?: string | null;
}) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new DomainError("VALIDATION", "起止时间格式不合法", null);
  }
  if (endAt <= startAt) throw new DomainError("VALIDATION", "结束时间必须晚于开始时间", null);

  // 事务内校验重叠 + 插入（规范要求的应用层事务校验）
  return db.transaction(async (tx) => {
    const hit = await tx.select({ id: timeBlock.id, title: timeBlock.title }).from(timeBlock)
      .where(and(eq(timeBlock.memberId, actor.memberId), lt(timeBlock.startAt, endAt), gt(timeBlock.endAt, startAt))).limit(1);
    if (hit[0]) throw new DomainError("CONFLICT", `与已有时间块「${hit[0].title}」重叠`, { conflicting: hit[0].id });
    const [row] = await tx.insert(timeBlock).values({
      memberId: actor.memberId, title: input.title, startAt, endAt,
      projectId: input.projectId ?? null, workItemId: input.workItemId ?? null, color: input.color ?? null,
    }).returning();
    return row;
  });
}

async function loadOwnBlock(actor: Actor, id: string) {
  const b = (await db.select().from(timeBlock).where(eq(timeBlock.id, id)).limit(1))[0];
  if (!b) throw new DomainError("NOT_FOUND", "时间块不存在", null);
  assertOwn(actor, b.memberId);
  return b;
}

export async function updateBlock(actor: Actor, id: string, patch: {
  title?: string; startAt?: string; endAt?: string; color?: string | null;
  projectId?: string | null; workItemId?: string | null;
}) {
  const b = await loadOwnBlock(actor, id);
  const startAt = patch.startAt ? new Date(patch.startAt) : b.startAt;
  const endAt = patch.endAt ? new Date(patch.endAt) : b.endAt;
  if (endAt <= startAt) throw new DomainError("VALIDATION", "结束时间必须晚于开始时间", null);
  return db.transaction(async (tx) => {
    const hit = await tx.select({ id: timeBlock.id, title: timeBlock.title }).from(timeBlock)
      .where(and(eq(timeBlock.memberId, actor.memberId), ne(timeBlock.id, id), lt(timeBlock.startAt, endAt), gt(timeBlock.endAt, startAt))).limit(1);
    if (hit[0]) throw new DomainError("CONFLICT", `与已有时间块「${hit[0].title}」重叠`, { conflicting: hit[0].id });
    const [row] = await tx.update(timeBlock).set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      startAt, endAt,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.workItemId !== undefined ? { workItemId: patch.workItemId } : {}),
      updatedAt: new Date(),
    }).where(eq(timeBlock.id, id)).returning();
    return row;
  });
}

export async function deleteBlock(actor: Actor, id: string): Promise<void> {
  await loadOwnBlock(actor, id);
  await db.delete(timeBlock).where(eq(timeBlock.id, id));
}

// ── 今日聚焦 ────────────────────────────────────────────────

// 为什么不用 toISOString().slice(0,10)：那是 UTC 日期——东八区 11-01 00:30 会被算成 10-31，
// 聚焦页整个「今天」错位一天（2026-11-01 全站走查实测）。日期一律按成员时区计算。
function memberTimeZone(actor: Actor): string {
  return actor.timezone ?? "Asia/Shanghai";
}

/** 某时区下的自然日（YYYY-MM-DD） */
function zonedDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** instant 在该时区的墙钟相对 UTC 的偏移量（ms） */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = (type: string) => Number(dtf.formatToParts(instant).find((x) => x.type === type)?.value);
  return Date.UTC(p("year"), p("month") - 1, p("day"), p("hour") % 24, p("minute"), p("second")) - instant.getTime();
}

/** 某时区某自然日 00:00 对应的 UTC 瞬间（两轮迭代收敛 DST 折叠） */
function zonedDayStart(day: string, timeZone: string): Date {
  let t = new Date(`${day}T00:00:00.000Z`);
  for (let i = 0; i < 2; i++) t = new Date(t.getTime() - tzOffsetMs(t, timeZone));
  return t;
}

function nextDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

/** 某时区某自然日的 [from, to) UTC 瞬间区间 */
function dayRange(day: string, timeZone: string): { from: Date; to: Date } {
  return { from: zonedDayStart(day, timeZone), to: zonedDayStart(nextDay(day), timeZone) };
}

export async function listFocusSessions(actor: Actor, opts: { day?: string } = {}) {
  const day = opts.day ?? zonedDate(new Date(), memberTimeZone(actor));
  const { from, to } = dayRange(day, memberTimeZone(actor));
  return db.select().from(focusSession)
    .where(and(eq(focusSession.memberId, actor.memberId), gte(focusSession.startedAt, from), lt(focusSession.startedAt, to)))
    .orderBy(desc(focusSession.startedAt));
}

/** 记录一次**已结束**的聚焦会话（进行中的不落库，规范：放 Valkey） */
export async function recordFocusSession(actor: Actor, input: {
  timeBlockId: string; startedAt: string; endedAt: string; note?: string | null; actualMinutes?: number;
}) {
  const block = await loadOwnBlock(actor, input.timeBlockId);
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new DomainError("VALIDATION", "起止时间格式不合法", null);
  }
  if (endedAt <= startedAt) throw new DomainError("VALIDATION", "结束时间必须晚于开始时间", null);
  const minutes = input.actualMinutes ?? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));

  const [row] = await db.insert(focusSession).values({
    memberId: actor.memberId, timeBlockId: block.id, startedAt, endedAt, actualMinutes: minutes, note: input.note ?? null,
  }).onConflictDoUpdate({
    target: [focusSession.timeBlockId, focusSession.startedAt],
    set: { endedAt, actualMinutes: minutes, note: input.note ?? null },
  }).returning();
  return row;
}

export async function updateFocusSession(actor: Actor, id: string, patch: { note?: string | null; actualMinutes?: number }) {
  const s = (await db.select().from(focusSession).where(eq(focusSession.id, id)).limit(1))[0];
  if (!s) throw new DomainError("NOT_FOUND", "聚焦记录不存在", null);
  assertOwn(actor, s.memberId);
  if (patch.actualMinutes !== undefined && patch.actualMinutes < 0) {
    throw new DomainError("VALIDATION", "实际时长不能为负", null);
  }
  const [row] = await db.update(focusSession).set(patch).where(eq(focusSession.id, id)).returning();
  return row;
}

/** 今日聚焦汇总：今天的块 + 已记录的聚焦时长（供工作台一张卡看完） */
export async function todayFocus(actor: Actor, day?: string) {
  const d = day ?? zonedDate(new Date(), memberTimeZone(actor));
  const { from, to } = dayRange(d, memberTimeZone(actor));
  const blocks = await db.select().from(timeBlock)
    .where(and(eq(timeBlock.memberId, actor.memberId), gte(timeBlock.startAt, from), lt(timeBlock.startAt, to)))
    .orderBy(asc(timeBlock.startAt));
  const sessions = await listFocusSessions(actor, { day: d });
  const plannedMinutes = blocks.reduce((sum, b) => sum + Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000), 0);
  const focusedMinutes = sessions.reduce((sum, s) => sum + s.actualMinutes, 0);
  return { day: d, blocks, sessions, plannedMinutes, focusedMinutes, sessionCount: sessions.length };
}
