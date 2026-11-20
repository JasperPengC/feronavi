import { businessEffects } from "./business-effects.ts";
/**
 * 评论 + @提及（T2）
 *
 * 两条关键规则：
 *   1 **回复深度限 2 层**（规范 7.1）：parent.parent_id IS NULL 即最深层，
 *      不能再往其下回复。防止无限嵌套把线程拖垮。
 *   2 **@提及解析**：从 Markdown 正文里抽 `@username`，命中成员才建 mention 行，
 *      再扇出通知。解析失败不能影响评论本身提交。
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { comment, mention, member } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { describeTarget } from "./activity-labels.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { loadActor } from "../auth/actor-loader.ts";


function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

async function recipientCanRead(memberId: string, targetType: string, targetId: string): Promise<boolean> {
  const recipient = await loadActor(memberId);
  if (!recipient) return false;
  try {
    await assertTargetVisible(recipient, targetType, targetId);
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === "FORBIDDEN") return false;
    throw error;
  }
}

/** 评论目标必须与工作项同项目（评论是跟着工作项的） */
async function assertTargetVisible(actor: Actor, targetType: string, targetId: string): Promise<string | null> {
  let pid: string | null;
  if (targetType === "WORK_ITEM") {
    const rows = await db.execute(sql`
      select project_id::text as project_id from work_item where id = ${targetId} and deleted_at is null
    `) as unknown as { project_id: string | null }[];
    pid = rows[0]?.project_id ?? null;
  } else if (targetType === "MILESTONE") {
    const rows = await db.execute(sql`
      select project_id::text as project_id from milestone where id = ${targetId}
    `) as unknown as { project_id: string | null }[];
    pid = rows[0]?.project_id ?? null;
  } else if (targetType === "PAGE") {
    const rows = await db.execute(sql`
      select project_id::text as project_id, visibility from page where id = ${targetId} and deleted_at is null
    `) as unknown as { project_id: string | null; visibility: string }[];
    const row = rows[0];
    pid = row?.project_id ?? null;
    if (pid && row?.visibility === "RESTRICTED") {
      const wiki = await import("./wiki.service.ts");
      if (!(await wiki.hasAcl(actor, targetId, "read"))) throw forbidden();
    }
  } else {
    throw new DomainError("VALIDATION", "该对象不支持评论", null);
  }
  if (!pid) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, pid, hasOrgGrant(actor)))) throw forbidden();
  return pid;
}

/** 从 Markdown 里抽 @用户名。规则：@ 后跟用户名，边界是非用户名字符 */
export function extractMentions(body: string): string[] {
  const out = new Set<string>();
  // 用户名规则与 member.username 一致：小写字母数字开头，可含 . _ -
  const re = /(?:^|[^\w@/])@([a-z0-9][a-z0-9._-]{2,31})/g;
  for (const m of body.matchAll(re)) out.add(m[1]!.toLowerCase());
  return [...out];
}

export async function createComment(
  actor: Actor,
  input: { targetType: string; targetId: string; body: string; parentId?: string | null },
) {
  businessEffects(); // Fail before writes if an entry point omitted application composition.
  const projectId = await assertTargetVisible(actor, input.targetType, input.targetId);
  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  // 作用域用**目标所属项目**（此前传 null，等于只认 ORG 档 —— 项目档成员连评论都发不了）
  if (!can(actor, "comment:create", { projectId, teamId: null }, ctx)) throw forbidden();

  // ① 回复深度校验（规范 7.1）
  if (input.parentId) {
    const parents = await db.select().from(comment).where(eq(comment.id, input.parentId)).limit(1);
    const parent = parents[0];
    if (!parent || parent.deletedAt) throw new DomainError("VALIDATION", "父评论不存在", null);
    if (parent.targetType !== input.targetType || parent.targetId !== input.targetId) {
      throw new DomainError("VALIDATION", "父评论必须属于同一对象", null);
    }
    // parent 自己还有 parent → 已是最深层，禁止再嵌
    if (parent.parentId) {
      throw new DomainError("VALIDATION", "回复最多 2 层，不能再嵌套", null);
    }
  }

  const [row] = await db.insert(comment).values({
    targetType: input.targetType,
    targetId: input.targetId,
    authorId: actor.memberId,
    body: input.body,
    parentId: input.parentId ?? null,
  }).returning();

  // ② @提及 → mention 行 + 实时通知（不认识的人名静默跳过）
  const names = extractMentions(input.body);
  if (names.length > 0) {
    // ⚠️ 不能写 = any(${names}::text[]) —— postgres.js 不把 JS 数组绑成 PG 数组
    //    （实测 22P02 malformed array literal）。用 drizzle 的 inArray。
    const members = await db.select({ id: member.id, username: member.username })
      .from(member).where(inArray(member.username, names));
    const { notify } = await import("./notification.service.ts");
    for (const m of members) {
      if (!(await recipientCanRead(m.id, input.targetType, input.targetId))) continue;
      await db.insert(mention).values({
        sourceType: input.targetType === "WORK_ITEM" ? "WORK_ITEM" : input.targetType,
        sourceId: input.targetId,
        memberId: m.id,
      }).onConflictDoNothing();
      // ⚠️ 不给自己的 @ 提及发通知（自己写的话提醒自己 = 噪音）
      if (m.id === actor.memberId) continue;
      // @提及是强通知：类别 MENTION 不走免打扰、不聚合
      await notify({
        recipientId: m.id,
        actorId: actor.memberId,
        category: "MENTION",
        type: "comment.mention",
        title: `${actor.name} 在评论中提到了你`,
        body: input.body.slice(0, 120),
        link: input.targetType === "WORK_ITEM" ? `/work-items/${input.targetId}` : null,
      }).catch(() => {});   // 通知失败不能让评论提交失败
    }
  }

  // ── SSE：comment.created（失效 ['work-item', id, 'comments'] 用）──
  try {
    const { publish } = await import("./events.service.ts");
    await publish("comment.created", {
      targetType: input.targetType, targetId: input.targetId, id: row!.id,
    }, null);
  } catch { /* 可丢 */ }

  // ③ 回复时通知父评论作者（对方被回复 = 强关注场景）
  if (input.parentId) {
    const parents = await db.select().from(comment).where(eq(comment.id, input.parentId)).limit(1);
    const parentAuthor = parents[0]?.authorId;
    if (parentAuthor && parentAuthor !== actor.memberId && await recipientCanRead(parentAuthor, input.targetType, input.targetId)) {
      const { notify } = await import("./notification.service.ts");
      await notify({
        recipientId: parentAuthor,
        actorId: actor.memberId,
        category: "MENTION",
        type: "comment.reply",
        title: `${actor.name} 回复了你的评论`,
        body: input.body.slice(0, 120),
        link: input.targetType === "WORK_ITEM" ? `/work-items/${input.targetId}` : null,
      }).catch(() => {});
    }
  }

  {
    const label = await describeTarget(input.targetType, input.targetId);
    await recordBusinessEvent({
      actor, action: "comment.created", targetType: input.targetType, targetId: input.targetId, projectId,
      summary: `${actor.name} 评论了${label}`,
    });
  }
  // 事件只带身份，不把评论正文或提及内容发送给订阅方。
  await businessEffects().deliverWebhook("comment.created", {
    id: row!.id, targetType: input.targetType, targetId: input.targetId,
    actorId: actor.memberId, projectId,
  }, projectId);
  if (input.targetType === "WORK_ITEM") {
    void businessEffects().runAutomation("COMMENT_ADDED", input.targetId);
    void businessEffects().markFirstResponse(input.targetId, actor.memberId);
  }
  return row;
}

export async function listComments(
  actor: Actor,
  targetType: string,
  targetId: string,
  opts: { parentId?: string | null } = {},
) {
  await assertTargetVisible(actor, targetType, targetId);
  const conds = [
    eq(comment.targetType, targetType),
    eq(comment.targetId, targetId),
    isNull(comment.deletedAt),          // 软删的不出现，但线程结构仍在库中
  ];
  /**
   * ⚠️ 必须区分「没传」与「传了 null」—— 两者语义不同：
   *   - 没传（undefined）→ 只取顶层（默认视图）
   *   - 传 null          → 同样只取顶层（显式表达）
   *   - 传了 id          → 取该评论下的回复
   * 原先只判 `=== null`，导致不传参数时两个分支都不进，
   * 把顶层和回复**一起**返回（实测顶层列表里混进回复）。
   */
  const parentId = opts.parentId;
  if (parentId === null || parentId === undefined) {
    conds.push(isNull(comment.parentId));
  } else {
    conds.push(eq(comment.parentId, parentId));
  }

  const rows = await db.select().from(comment).where(and(...conds)).orderBy(asc(comment.createdAt));
  return rows;
}

export async function updateComment(actor: Actor, id: string, body: string) {
  const rows = await db.select().from(comment).where(eq(comment.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) throw forbidden();
  const projectId = await assertTargetVisible(actor, row.targetType, row.targetId);
  // 文档 10 节：comment:update_own（自己的）；判定走权限引擎而不是硬比 id，与管理员策略解耦。
  // 作用域传**目标所属项目**（此前传 null 导致项目档成员改不了自己的评论）。
  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  if (!can(actor, "comment:update_own", { projectId, teamId: null, createdBy: row.authorId }, ctx)) {
    throw forbidden();
  }

  const [updated] = await db.update(comment)
    // NULL = 未编辑过；一旦编辑就落下时间戳
    .set({ body, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(comment.id, id))
    .returning();
  return updated;
}

/** 软删：保留线程结构，不把回复变成孤儿 */
export async function deleteComment(actor: Actor, id: string): Promise<void> {
  const rows = await db.select().from(comment).where(eq(comment.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) throw forbidden();
  const projectId = await assertTargetVisible(actor, row.targetType, row.targetId);
  // 文档 10 节：本人 comment:update_own，或 comment:delete_any（作用域 = 目标所属项目）
  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  const own = row.authorId === actor.memberId && can(actor, "comment:update_own", { projectId, teamId: null, createdBy: row.authorId }, ctx);
  const anyDel = can(actor, "comment:delete_any", { projectId, teamId: null, createdBy: row.authorId }, ctx);
  if (!own && !anyDel) throw forbidden();
  await db.update(comment).set({ deletedAt: new Date() }).where(eq(comment.id, id));
  const label = await describeTarget(row.targetType, row.targetId);
  await recordBusinessEvent({
    actor, action: "comment.deleted", targetType: row.targetType, targetId: row.targetId, projectId,
    summary: `${actor.name} 删除了${label}下的一条评论`,
  });
}

void desc;
