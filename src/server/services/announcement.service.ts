/**
 * 群发公告（第十四期，规范 8.5 + 第 4.9 节 MCP 工具 `announcement.send` / `announcement.revoke`）
 *
 * 这是规范里标记的**最高风险写操作**（一次影响全组织），因此护栏比别的服务多：
 *   1 权限要 `notification:send`；**MCP 侧还额外要求 ADMIN 档**（工具层判定）
 *   2 扇出**有上限**并如实记录 `delivered_count`（投递到多少人，不是"计划投多少人"）
 *   3 **撤回仅限发送人本人**（表定义明确要求，不是"有权限即可撤"）
 *   4 扇出走既有通知服务 → 免打扰、通知偏好、分组全部沿用，不新开一条投递通道
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { announcement, member, notification, roleAssignment } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { recordBusinessEvent } from "./event-log.ts";

/** 单次扇出上限：公告面向全组织，但一次调用不得成为压垮系统的入口 */
export const FANOUT_LIMIT = 5000;

export interface AnnouncementInput {
  title: string; body: string; severity?: "INFO" | "WARNING" | "CRITICAL";
  audience?: { roleKeys?: string[]; teamIds?: string[] };
}

function assertSend(actor: Actor) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "notification:send", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

/** 目标成员：空 audience = 全员；按角色/团队筛选 */
async function resolveAudience(input: AnnouncementInput): Promise<string[]> {
  const roleKeys = input.audience?.roleKeys ?? [];
  const teamIds = input.audience?.teamIds ?? [];
  if (roleKeys.length === 0 && teamIds.length === 0) {
    const rows = await db.select({ id: member.id }).from(member).where(eq(member.status, "ACTIVE")).limit(FANOUT_LIMIT);
    return rows.map((r) => r.id);
  }
  // 命中任一声明条件的成员（并集），不与其它条件叠加成"交集"——公告是广播，不是精确筛选
  const conds = [];
  if (roleKeys.length > 0) conds.push(inArray(sql`(select r.key from role r where r.id = ${roleAssignment.roleId})`, roleKeys));
  if (teamIds.length > 0) conds.push(inArray(roleAssignment.scopeId, teamIds));
  const rows = await db.selectDistinct({ id: member.id }).from(roleAssignment)
    .innerJoin(member, eq(member.id, roleAssignment.memberId))
    .where(and(eq(member.status, "ACTIVE"), conds.length ? sql`(${sql.join(conds, sql` or `)})` : sql`true`))
    .limit(FANOUT_LIMIT);
  return rows.map((r) => r.id);
}

export async function sendAnnouncement(actor: Actor, input: AnnouncementInput) {
  assertSend(actor);
  if (!input.title.trim()) throw new DomainError("VALIDATION", "标题不能为空", null);
  if (!input.body.trim()) throw new DomainError("VALIDATION", "正文不能为空", null);

  const targets = await resolveAudience(input);
  const [row] = await db.insert(announcement).values({
    authorId: actor.memberId, title: input.title, body: input.body,
    severity: input.severity ?? "INFO", audience: (input.audience ?? {}) as object,
    deliveredCount: targets.length,
  }).returning();

  /**
   * 扇出：复用既有通知服务（免打扰、分类偏好、分组聚合自动生效）。
   *
   * ⚠️ 两个必须做对的地方：
   *   1 `category` 必须是通知表的枚举值之一（此前我写成 "SYSTEM" → 违反 CHECK，
   *      又被下面的空 catch 吞掉，表现为"一条通知都没发出去却没人知道"）。
   *   2 `delivered_count` 的定义是**实际投递人数**，不是目标人数 —— 免打扰与偏好会让人被跳过，
   *      故扇出后**按实际落库的通知条数回填**，并对投递失败计数（不静默）。
   */
  let failed = 0;
  if (targets.length > 0) {
    const { notify } = await import("./notification.service.ts");
    for (const recipientId of targets) {
      try {
        await notify({
          recipientId, actorId: actor.memberId,
          type: "announcement", category: "ANNOUNCEMENT",
          title: input.title, body: input.body.slice(0, 200),
          link: `/announcements/${row!.id}`, groupKey: `announcement:${row!.id}`, itemCount: 1,
        } as never);
      } catch (e) {
        failed++;
        // 不吞异常：至少留下服务端记录，否则投递失败会完全不可见
        console.warn(`[announcement] 投递失败 recipient=${recipientId}: ${(e as Error).message}`);
      }
    }
  }
  const delivered = (await db.select({ n: sql<number>`count(*)::int` }).from(notification)
    .where(eq(notification.groupKey, `announcement:${row!.id}`)))[0]?.n ?? 0;
  await db.update(announcement).set({ deliveredCount: delivered }).where(eq(announcement.id, row!.id));

  await recordBusinessEvent({
    actor, action: "announcement.sent", targetType: "ANNOUNCEMENT", targetId: row!.id,
    projectId: null, summary: `${actor.name} 发布了公告「${row!.title}」`,
  });
  return { ...row!, deliveredCount: delivered, targetCount: targets.length, failedCount: failed };
}

export async function listAnnouncements(actor: Actor, opts: { includeRevoked?: boolean } = {}) {
  const conds = opts.includeRevoked ? [] : [isNull(announcement.revokedAt)];
  return db.select().from(announcement)
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(announcement.createdAt)).limit(100);
}

/** 撤回：**仅限发送人本人**（表定义的明确要求 —— 有权限不等于能撤别人的公告） */
export async function revokeAnnouncement(actor: Actor, id: string) {
  const row = (await db.select().from(announcement).where(eq(announcement.id, id)).limit(1))[0];
  if (!row) throw new DomainError("NOT_FOUND", "公告不存在", null);
  if (row.authorId !== actor.memberId) throw forbidden();
  if (row.revokedAt) return { ...row, alreadyRevoked: true };
  const [updated] = await db.update(announcement).set({ revokedAt: new Date() }).where(eq(announcement.id, id)).returning();
  // 撤回后把对应通知一并清掉，否则用户点进去看到已撤回内容
  await db.delete(notification).where(eq(notification.groupKey, `announcement:${id}`));
  await recordBusinessEvent({
    actor, action: "announcement.revoked", targetType: "ANNOUNCEMENT", targetId: id,
    projectId: null, summary: `${actor.name} 撤回了公告「${updated!.title}」`,
  });
  return { ...updated!, alreadyRevoked: false };
}
