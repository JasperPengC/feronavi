/**
 * 个人偏好（B3a，REST 7e）+ 工时（B3b，REST 6 节；数据模型 3.5）
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { memberPreference, timeLog, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";

function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

// ── 个人偏好 ────────────────────────────────────────────────

export async function getPreferences(actor: Actor) {
  const rows = await db.select().from(memberPreference)
    .where(eq(memberPreference.memberId, actor.memberId)).limit(1);
  if (rows[0]) return rows[0];
  return { memberId: actor.memberId, theme: "system", locale: "zh-CN", timezone: actor.timezone ?? null, density: "comfortable", updatedAt: new Date() };
}

export async function putPreferences(actor: Actor, patch: {
  theme?: string; locale?: string; timezone?: string | null; density?: string;
}) {
  if (patch.theme && !["dark", "light", "system"].includes(patch.theme)) {
    throw new DomainError("VALIDATION", "theme 只支持 dark / light / system", null);
  }
  if (patch.density && !["comfortable", "compact"].includes(patch.density)) {
    throw new DomainError("VALIDATION", "density 只支持 comfortable / compact", null);
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.theme !== undefined) set.theme = patch.theme;
  if (patch.locale !== undefined) set.locale = patch.locale;
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.density !== undefined) set.density = patch.density;

  await db.insert(memberPreference).values({ memberId: actor.memberId, ...set } as never)
    .onConflictDoUpdate({ target: memberPreference.memberId, set: set as never });
  return getPreferences(actor);
}

// ── 工时 ────────────────────────────────────────────────────

async function wiVisible(actor: Actor, workItemId: string) {
  const rows = await db.select().from(workItem).where(eq(workItem.id, workItemId)).limit(1);
  const wi = rows[0];
  if (!wi || wi.deletedAt) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, wi.projectId, hasOrgGrant(actor)))) throw forbidden();
  return wi;
}

export async function addTimeLog(actor: Actor, workItemId: string, input: {
  minutes: number; loggedDate: string; note?: string | null;
}) {
  const wi = await wiVisible(actor, workItemId);
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new DomainError("VALIDATION", "minutes 必须是正整数", null);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.loggedDate)) {
    throw new DomainError("VALIDATION", "loggedDate 格式应为 YYYY-MM-DD", null);
  }
  const [row] = await db.insert(timeLog).values({
    workItemId, memberId: actor.memberId,
    minutes: input.minutes, loggedDate: input.loggedDate, note: input.note ?? null,
  }).returning();
  void wi;
  return row;
}

export async function listTimeLogs(actor: Actor, workItemId: string) {
  await wiVisible(actor, workItemId);
  return db.select().from(timeLog).where(eq(timeLog.workItemId, workItemId)).orderBy(desc(timeLog.createdAt));
}

/** 改/删工时：仅本人，或 work_item:update_any（文档 6 节） */
async function assertCanModify(actor: Actor, log: { memberId: string; workItemId: string }) {
  if (log.memberId === actor.memberId) return;
  const rows = await db.select().from(workItem).where(eq(workItem.id, log.workItemId)).limit(1);
  const wi = rows[0];
  if (!wi) throw forbidden();
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "work_item:update_any", { projectId: wi.projectId, createdBy: wi.reporterId }, ctx)) throw forbidden();
}

/** 工时变更与缓存重放共用当前记录所有权/管理权。 */
export async function authorizeTimeLogMutation(actor: Actor, logId: string) {
  const rows = await db.select().from(timeLog).where(eq(timeLog.id, logId)).limit(1);
  const log = rows[0];
  if (!log) throw forbidden();
  await assertCanModify(actor, log);
  return log;
}

export { wiVisible as assertTimeLogWorkItemVisible };

export async function updateTimeLog(actor: Actor, logId: string, patch: {
  minutes?: number; loggedDate?: string; note?: string | null;
}) {
  await authorizeTimeLogMutation(actor, logId);
  if (patch.minutes !== undefined && (!Number.isInteger(patch.minutes) || patch.minutes <= 0)) {
    throw new DomainError("VALIDATION", "minutes 必须是正整数", null);
  }
  const set: Record<string, unknown> = {};
  if (patch.minutes !== undefined) set.minutes = patch.minutes;
  if (patch.loggedDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.loggedDate)) throw new DomainError("VALIDATION", "loggedDate 格式应为 YYYY-MM-DD", null);
    set.loggedDate = patch.loggedDate;
  }
  if (patch.note !== undefined) set.note = patch.note;
  const [row] = await db.update(timeLog).set(set).where(eq(timeLog.id, logId)).returning();
  return row;
}

export async function deleteTimeLog(actor: Actor, logId: string): Promise<void> {
  await authorizeTimeLogMutation(actor, logId);
  await db.delete(timeLog).where(eq(timeLog.id, logId));
}
