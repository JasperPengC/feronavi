import { businessEffects } from "./business-effects.ts";
import { deferAfterCommit } from "../../db/context.ts";
/**
 * SLA（P1-2）：策略匹配、响应/解决时钟、违约扫描与升级通知。
 *
 * 支持 24×7 / 工作日历（含节假日）与暂停 / 恢复；扫描幂等：状态条件更新 + lastEscalatedAt。
 */
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { notification, role, roleAssignment, slaPolicy, workItemSla } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as wiRepo from "../repos/work-item.repo.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { addSlaMinutes, type BusinessCalendar } from "../lib/sla-calendar.ts";
import { recordBusinessEvent } from "./event-log.ts";

function assertManage(actor: Actor, projectId: string): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "project:update", { projectId, teamId: null }, ctx)) throw forbidden();
}
async function visible(actor: Actor, projectId: string): Promise<void> {
  const org = actor.grants.some((g) => g.scopeType === "ORG");
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, org))) throw forbidden();
}
function minutes(n: number): number { return Math.max(1, Math.min(60 * 24 * 90, Math.round(n))); }

export async function listPolicies(actor: Actor, projectId: string) {
  assertManage(actor, projectId);
  await visible(actor, projectId);
  return db.select().from(slaPolicy).where(eq(slaPolicy.projectId, projectId)).orderBy(asc(slaPolicy.createdAt));
}
export async function createPolicy(actor: Actor, projectId: string, input: {
  name: string; priority?: string | null; severity?: string | null; type?: string | null;
  responseMinutes: number; resolveMinutes: number; escalateAfterMinutes?: number;
  escalateRoles?: string[]; calendar?: BusinessCalendar | null; enabled?: boolean;
}) {
  assertManage(actor, projectId);
  await visible(actor, projectId);
  if (input.resolveMinutes < input.responseMinutes) throw new DomainError("VALIDATION", "解决时限不能小于响应时限", null);
  const [row] = await db.insert(slaPolicy).values({
    projectId, name: input.name.trim(), priority: input.priority || null, severity: input.severity || null,
    type: input.type || null, responseMinutes: minutes(input.responseMinutes), resolveMinutes: minutes(input.resolveMinutes),
    escalateAfterMinutes: minutes(input.escalateAfterMinutes ?? 60), escalateRoles: (input.escalateRoles ?? []) as object,
    calendar: (input.calendar ?? null) as object,
    enabled: input.enabled ?? true,
  }).returning();
  await recordBusinessEvent({ actor, action: "sla.created", targetType: "SLA_POLICY", targetId: row!.id, projectId });
  return row!;
}
export async function updatePolicy(actor: Actor, projectId: string, id: string, patch: Partial<{
  name: string; priority: string | null; severity: string | null; type: string | null;
  responseMinutes: number; resolveMinutes: number; escalateAfterMinutes: number; escalateRoles: string[]; calendar: BusinessCalendar | null; enabled: boolean;
}>) {
  assertManage(actor, projectId);
  await visible(actor, projectId);
  const current = (await db.select().from(slaPolicy).where(and(eq(slaPolicy.id, id), eq(slaPolicy.projectId, projectId))).limit(1))[0];
  if (!current) throw new DomainError("NOT_FOUND", "策略不存在", null);
  if (minutes(patch.resolveMinutes ?? current.resolveMinutes) < minutes(patch.responseMinutes ?? current.responseMinutes)) {
    throw new DomainError("VALIDATION", "解决时限不能小于响应时限", null);
  }
  const [row] = await db.update(slaPolicy).set({
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority || null } : {}),
    ...(patch.severity !== undefined ? { severity: patch.severity || null } : {}),
    ...(patch.type !== undefined ? { type: patch.type || null } : {}),
    ...(patch.responseMinutes !== undefined ? { responseMinutes: minutes(patch.responseMinutes) } : {}),
    ...(patch.resolveMinutes !== undefined ? { resolveMinutes: minutes(patch.resolveMinutes) } : {}),
    ...(patch.escalateAfterMinutes !== undefined ? { escalateAfterMinutes: minutes(patch.escalateAfterMinutes) } : {}),
    ...(patch.escalateRoles !== undefined ? { escalateRoles: patch.escalateRoles as object } : {}),
    ...(patch.calendar !== undefined ? { calendar: patch.calendar as object } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: new Date(),
  }).where(and(eq(slaPolicy.id, id), eq(slaPolicy.projectId, projectId))).returning();
  if (!row) throw new DomainError("NOT_FOUND", "策略不存在", null);
  await recordBusinessEvent({ actor, action: "sla.updated", targetType: "SLA_POLICY", targetId: id, projectId });
  return row;
}
export async function deletePolicy(actor: Actor, projectId: string, id: string) {
  assertManage(actor, projectId);
  await db.delete(slaPolicy).where(and(eq(slaPolicy.id, id), eq(slaPolicy.projectId, projectId)));
  await recordBusinessEvent({ actor, action: "sla.deleted", targetType: "SLA_POLICY", targetId: id, projectId });
  return { ok: true };
}

function specificity(p: typeof slaPolicy.$inferSelect): number {
  return (p.priority ? 4 : 0) + (p.severity ? 2 : 0) + (p.type ? 1 : 0);
}
async function matchPolicy(item: typeof import("../../db/schema.ts").workItem.$inferSelect) {
  const rows = await db.select().from(slaPolicy).where(and(eq(slaPolicy.projectId, item.projectId), eq(slaPolicy.enabled, true)));
  return rows
    .filter((p) => (!p.priority || p.priority === item.priority) && (!p.severity || p.severity === item.severity) && (!p.type || p.type === item.type))
    .sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
}

/** 创建/更新工作项后同步 SLA；已存在则不重置时钟 */
export async function ensureSla(workItemId: string): Promise<void> {
  if (deferAfterCommit(() => ensureSlaNow(workItemId))) return;
  await ensureSlaNow(workItemId);
}
async function ensureSlaNow(workItemId: string): Promise<void> {
  try {
    const item = await wiRepo.findById(workItemId);
    if (!item) return;
    const policy = await matchPolicy(item);
    if (!policy) return;
    const existing = (await db.select().from(workItemSla).where(eq(workItemSla.workItemId, workItemId)).limit(1))[0];
    if (existing) {
      if (existing.policyId !== policy.id && existing.state === "ACTIVE" && !existing.firstResponseAt) {
        await db.update(workItemSla).set({
          policyId: policy.id,
          responseDueAt: addSlaMinutes(existing.startedAt, policy.responseMinutes, policy.calendar as BusinessCalendar | null),
          resolveDueAt: addSlaMinutes(existing.startedAt, policy.resolveMinutes, policy.calendar as BusinessCalendar | null),
          updatedAt: new Date(),
        }).where(eq(workItemSla.workItemId, workItemId));
      }
      return;
    }
    const started = new Date();
    await db.insert(workItemSla).values({
      workItemId, policyId: policy.id, startedAt: started,
      responseDueAt: addSlaMinutes(started, policy.responseMinutes, policy.calendar as BusinessCalendar | null),
      resolveDueAt: addSlaMinutes(started, policy.resolveMinutes, policy.calendar as BusinessCalendar | null),
    }).onConflictDoNothing();
  } catch (e) { console.warn("[sla] ensure failed", (e as Error).message); }
}

export async function getSla(workItemId: string) {
  const row = (await db.select().from(workItemSla).where(eq(workItemSla.workItemId, workItemId)).limit(1))[0];
  if (!row) return null;
  const policy = row.policyId ? (await db.select().from(slaPolicy).where(eq(slaPolicy.id, row.policyId)).limit(1))[0] ?? null : null;
  return { ...row, policy };
}

/** 暂停 SLA 时钟：记录暂停起点；扫描器跳过暂停中的记录。 */
export async function pauseSla(actor: Actor, workItemId: string) {
  const item = await wiRepo.findById(workItemId);
  if (!item) throw new DomainError("NOT_FOUND", "工作项不存在", null);
  assertManage(actor, item.projectId);
  const row = (await db.select().from(workItemSla).where(eq(workItemSla.workItemId, workItemId)).limit(1))[0];
  if (!row || row.state !== "ACTIVE") throw new DomainError("VALIDATION", "当前没有进行中的 SLA", null);
  if (row.pausedAt) return row;
  const [updated] = await db.update(workItemSla).set({ pausedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workItemSla.id, row.id), eq(workItemSla.state, "ACTIVE"))).returning();
  return updated!;
}

/** 恢复 SLA 时钟：把暂停时长累加并顺延两个截止时间。 */
export async function resumeSla(actor: Actor, workItemId: string) {
  const item = await wiRepo.findById(workItemId);
  if (!item) throw new DomainError("NOT_FOUND", "工作项不存在", null);
  assertManage(actor, item.projectId);
  const row = (await db.select().from(workItemSla).where(eq(workItemSla.workItemId, workItemId)).limit(1))[0];
  if (!row || row.state !== "ACTIVE") throw new DomainError("VALIDATION", "当前没有进行中的 SLA", null);
  if (!row.pausedAt) return row;
  const now = new Date();
  const paused = Math.max(0, now.getTime() - row.pausedAt.getTime());
  const [updated] = await db.update(workItemSla).set({
    pausedAt: null,
    pausedMs: row.pausedMs + paused,
    responseDueAt: new Date(row.responseDueAt.getTime() + paused),
    resolveDueAt: new Date(row.resolveDueAt.getTime() + paused),
    updatedAt: now,
  }).where(and(eq(workItemSla.id, row.id), eq(workItemSla.state, "ACTIVE"))).returning();
  return updated!;
}

/** 首次非创建人评论 = 首次响应 */
export async function markFirstResponse(workItemId: string, authorId: string): Promise<void> {
  if (deferAfterCommit(() => markFirstResponseNow(workItemId, authorId))) return;
  await markFirstResponseNow(workItemId, authorId);
}
async function markFirstResponseNow(workItemId: string, authorId: string): Promise<void> {
  try {
    const item = await wiRepo.findById(workItemId);
    if (!item || item.reporterId === authorId) return;
    await db.update(workItemSla).set({ firstResponseAt: new Date(), updatedAt: new Date() })
      .where(and(eq(workItemSla.workItemId, workItemId), isNull(workItemSla.firstResponseAt), eq(workItemSla.state, "ACTIVE")));
  } catch { /* ignore */ }
}

/** 状态流转后更新最终状态 */
export async function markTransition(workItemId: string, toCategory: string): Promise<void> {
  if (deferAfterCommit(() => markTransitionNow(workItemId, toCategory))) return;
  await markTransitionNow(workItemId, toCategory);
}
async function markTransitionNow(workItemId: string, toCategory: string): Promise<void> {
  try {
    const row = (await db.select().from(workItemSla).where(eq(workItemSla.workItemId, workItemId)).limit(1))[0];
    if (!row || row.state !== "ACTIVE") return;
    if (toCategory === "CANCELLED") {
      await db.update(workItemSla).set({ state: "CANCELLED", updatedAt: new Date() }).where(eq(workItemSla.id, row.id));
    } else if (toCategory === "DONE") {
      const now = new Date();
      const state = now <= row.resolveDueAt ? "MET" : "BREACHED";
      await db.update(workItemSla).set({ state, breachedAt: state === "BREACHED" ? now : row.breachedAt, updatedAt: now }).where(eq(workItemSla.id, row.id));
    }
  } catch { /* ignore */ }
}

async function roleMembers(roleKeys: string[]): Promise<string[]> {
  if (roleKeys.length === 0) return [];
  const rows = await db.select({ memberId: roleAssignment.memberId, roleKey: role.key })
    .from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(eq(roleAssignment.scopeType, "ORG"));
  return [...new Set(rows.filter((r) => roleKeys.includes(r.roleKey)).map((r) => r.memberId))];
}

/** 定时扫描：响应超时或解决超时 → BREACHED + 升级通知 + 自动化触发 */
export async function scanSlaBreaches(limit = 100): Promise<{ breached: number; notified: number }> {
  businessEffects(); // Fail before writes if an entry point omitted application composition.
  const now = new Date();
  const due = await db.select().from(workItemSla)
    .where(and(eq(workItemSla.state, "ACTIVE"), isNull(workItemSla.pausedAt), or(
      and(isNull(workItemSla.firstResponseAt), lte(workItemSla.responseDueAt, now)),
      lte(workItemSla.resolveDueAt, now),
    ))).limit(limit);
  let breached = 0, notified = 0;
  for (const row of due) {
    const item = await wiRepo.findById(row.workItemId);
    if (!item) continue;
    const [updated] = await db.update(workItemSla).set({ state: "BREACHED", breachedAt: row.breachedAt ?? now, updatedAt: now })
      .where(and(eq(workItemSla.id, row.id), eq(workItemSla.state, "ACTIVE"))).returning();
    if (!updated) continue;
    breached += 1;
    const policy = row.policyId ? (await db.select().from(slaPolicy).where(eq(slaPolicy.id, row.policyId)).limit(1))[0] : null;
    const roles = Array.isArray(policy?.escalateRoles) ? (policy!.escalateRoles as string[]) : [];
    const recipients = await roleMembers(roles);
    for (const recipientId of recipients) {
      const groupKey = `sla.breached:${item.id}`;
      const dedupe = await db.select({ id: notification.id }).from(notification)
        .where(and(eq(notification.recipientId, recipientId), eq(notification.type, "sla.breached"), eq(notification.groupKey, groupKey))).limit(1);
      if (dedupe.length > 0) continue;
      const { notify } = await import("./notification.service.ts");
      await notify({
        recipientId, actorId: null, category: "TRANSITION", type: "sla.breached",
        title: `SLA 违约：${item.key}`, body: item.title, link: `/work-items/${item.id}`, groupKey,
      }).catch(() => {});
      notified += 1;
    }
    await db.update(workItemSla).set({ lastEscalatedAt: now }).where(eq(workItemSla.id, row.id));
    const { runAutomation } = businessEffects();
    await runAutomation("SLA_BREACHED", item.id);
  }
  return { breached, notified };
}

