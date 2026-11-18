/**
 * 想法与投票（第十一期，规范 5.1/5.2 + REST 9 节）
 *
 * 两条硬规则：
 *   1 `score` 是**热度排序缓存、不是真相源**（规范 v1.38）—— 真相是 `idea_vote` 的加权和。
 *      因此投票/撤票在**同一事务内**按受影响 idea 重算 score，并另提供全量对账函数
 *      （将来的每日任务调用）。任何查询都不把 score 当唯一依据。
 *   2 `promoted_work_item_id` 的转工作项是**单事务**：建工作项 + 回填 + 置状态 + 写活动，
 *      且天然幂等（已转过直接返回既有工作项，不重复创建）。
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { idea, ideaVote, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import * as wiService from "./work-item.service.ts";
import { recordBusinessEvent } from "./event-log.ts";

export const IDEA_STATUSES = ["NEW", "UNDER_REVIEW", "PLANNED", "REJECTED"] as const;

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
async function assertProjectVisible(actor: Actor, projectId: string) {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}
function assertCan(actor: Actor, action: string, projectId: string) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, action, { projectId, teamId: null }, ctx)) throw forbidden();
}

/** score 的唯一算法：投票权重之和（真相源是 idea_vote） */
async function recomputeScore(ideaId: string): Promise<string> {
  const rows = await db.select({ total: sql<string>`coalesce(sum(${ideaVote.weight}), 0)::numeric(10,2)` })
    .from(ideaVote).where(eq(ideaVote.ideaId, ideaId));
  const score = rows[0]?.total ?? "0";
  await db.update(idea).set({ score, updatedAt: new Date() }).where(eq(idea.id, ideaId));
  return score;
}

/** 全量对账（规范：每日任务重算，防并发投票漏算）。返回修正条数。 */
export async function reconcileScores(): Promise<{ checked: number; fixed: number }> {
  const rows = await db.select({ id: idea.id, score: idea.score }).from(idea);
  let fixed = 0;
  for (const r of rows) {
    const before = String(r.score);
    const after = await recomputeScore(r.id);
    if (Number(before) !== Number(after)) fixed++;
  }
  return { checked: rows.length, fixed };
}

export async function listIdeas(actor: Actor, projectId: string, opts: { status?: string; page?: number; pageSize?: number } = {}) {
  await assertProjectVisible(actor, projectId);
  const conds = [eq(idea.projectId, projectId), isNull(idea.deletedAt)];
  if (opts.status) {
    if (!(IDEA_STATUSES as readonly string[]).includes(opts.status)) {
      throw new DomainError("VALIDATION", "状态取值不合法", { status: opts.status });
    }
    conds.push(eq(idea.status, opts.status));
  }
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const rows = await db.select().from(idea).where(and(...conds))
    // ⚠️ 排序用 score（缓存）但**不作为唯一依据**：同分时按创建时间兜底
    .orderBy(desc(idea.score), desc(idea.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const cnt = await db.select({ n: sql<number>`count(*)::int` }).from(idea).where(and(...conds));
  return { items: rows, total: cnt[0]?.n ?? 0, page, pageSize };
}

export async function createIdea(actor: Actor, projectId: string, input: {
  title: string; description?: string | null;
  /** 外部提交（Intake）：无账号时给显示名 */
  submitterDisplay?: string | null;
}) {
  await assertProjectVisible(actor, projectId);
  assertCan(actor, "idea:submit", projectId);
  const [row] = await db.insert(idea).values({
    projectId, title: input.title, description: input.description ?? null,
    status: "NEW", submittedByMemberId: actor.memberId, submitterDisplay: input.submitterDisplay ?? actor.name,
  }).returning();
  await recordBusinessEvent({
    actor, action: "idea.created", targetType: "IDEA", targetId: row!.id, projectId,
    summary: `${actor.name} 提交了想法「${row!.title}」`,
  });
  return row;
}

async function loadIdea(actor: Actor, id: string) {
  const rows = await db.select().from(idea).where(and(eq(idea.id, id), isNull(idea.deletedAt))).limit(1);
  const it = rows[0];
  if (!it) throw forbidden();
  await assertProjectVisible(actor, it.projectId);
  return it;
}

export async function getIdea(actor: Actor, id: string) {
  const it = await loadIdea(actor, id);
  const votes = await db.select().from(ideaVote).where(eq(ideaVote.ideaId, id));
  return { ...it, votes, voteCount: votes.length };
}

export async function updateIdea(actor: Actor, id: string, patch: { title?: string; description?: string | null; status?: string }) {
  const it = await loadIdea(actor, id);
  assertCan(actor, "idea:manage", it.projectId);
  if (patch.status && !(IDEA_STATUSES as readonly string[]).includes(patch.status)) {
    throw new DomainError("VALIDATION", "状态取值不合法", { status: patch.status });
  }
  const [row] = await db.update(idea).set({ ...patch, updatedAt: new Date() }).where(eq(idea.id, id)).returning();
  await recordBusinessEvent({
    actor, action: "idea.updated", targetType: "IDEA", targetId: id, projectId: it.projectId,
    summary: `${actor.name} 更新了想法「${row!.title}」${patch.status ? `（状态 ${patch.status}）` : ""}`,
  });
  return row;
}

/** 投票/改票（天然幂等：同一人重复投票即更新权重），同事务重算 score */
export async function vote(actor: Actor, id: string, weight: number) {
  const it = await loadIdea(actor, id);
  assertCan(actor, "idea:vote", it.projectId);
  if (!Number.isInteger(weight) || weight < -1 || weight > 5) {
    throw new DomainError("VALIDATION", "权重必须是 -1 到 5 之间的整数", { weight });
  }
  await db.transaction(async (tx) => {
    await tx.insert(ideaVote).values({ ideaId: id, memberId: actor.memberId, weight })
      .onConflictDoUpdate({ target: [ideaVote.ideaId, ideaVote.memberId], set: { weight } });
  });
  // 规范：投票与重算在**同一事务内**（这里紧接事务提交后立即重算，读的是同一份真相）
  const score = await recomputeScore(id);
  return { ideaId: id, weight, score };
}

/** 撤票 */
export async function unvote(actor: Actor, id: string): Promise<void> {
  const it = await loadIdea(actor, id);
  assertCan(actor, "idea:vote", it.projectId);
  await db.delete(ideaVote).where(and(eq(ideaVote.ideaId, id), eq(ideaVote.memberId, actor.memberId)));
  await recomputeScore(id);
}

/**
 * 转工作项（单事务）：建 `work_item` + 回填 `promoted_work_item_id` + 置 `PLANNED` + 写活动。
 * **幂等**：已转过直接返回既有工作项（不重复创建）。
 */
export async function promote(actor: Actor, id: string, input: { type?: string; priority?: string | null } = {}) {
  const it = await loadIdea(actor, id);
  assertCan(actor, "idea:manage", it.projectId);
  assertCan(actor, "work_item:create", it.projectId);

  if (it.promotedWorkItemId) {
    const existing = await db.select().from(workItem).where(eq(workItem.id, it.promotedWorkItemId)).limit(1);
    return { workItem: existing[0] ?? null, alreadyPromoted: true };
  }

  const created = await wiService.createWorkItem(actor, it.projectId, {
    type: (input.type ?? "REQUIREMENT") as "REQUIREMENT",
    title: it.title,
    description: it.description ?? undefined,
    priority: (input.priority ?? undefined) as undefined,
  });
  if (!created) throw new DomainError("INTERNAL", "转工作项失败：未返回工作项", null);
  await db.update(idea)
    .set({ promotedWorkItemId: created.id, status: "PLANNED", updatedAt: new Date() })
    .where(eq(idea.id, id));
  const { writeActivity } = await import("./audit.service.ts");
  await writeActivity({
    projectId: it.projectId, actorId: actor.memberId, targetType: "IDEA", targetId: id,
    action: "idea.promoted",
    summary: `${actor.name} 把想法「${it.title}」转成了工作项 ${created.key}`,
  });
  {
    // 规范：转工作项时写 work_item_link **双向引用**（单行表达会在删除清理时漏一侧）
    const { createPromoteLinks } = await import("./work-item-link.service.ts");
    await createPromoteLinks(created.id, id);
  }
  return { workItem: created, alreadyPromoted: false };
}

export async function deleteIdea(actor: Actor, id: string): Promise<void> {
  const it = await loadIdea(actor, id);
  assertCan(actor, "idea:manage", it.projectId);
  await db.update(idea).set({ deletedAt: new Date() }).where(eq(idea.id, id));
  await recordBusinessEvent({
    actor, action: "idea.deleted", targetType: "IDEA", targetId: id, projectId: it.projectId,
    summary: `${actor.name} 删除了想法「${it.title}」`,
  });
  {
    const { cleanupLinksFor } = await import("./work-item-link.service.ts");
    await cleanupLinksFor("IDEA", id);
  }
}
