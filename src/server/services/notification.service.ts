/**
 * 通知 + 免打扰（T3）
 *
 * 三条规则（规范 7.4 与第 5.5 节）：
 *   1 **@提及永不聚合、实时送达** —— 它是强通知，聚合会让被@的人看不到
 *   2 **免打扰按用户自己的时区**（dnd_timezone），不是组织时区
 *   3 **跨天免打扰由 start > end 表达**（22:00–08:00），不能按 start < end 判断
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  notification,
  notificationPreference,
  member,
  mention,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import { createHash } from "node:crypto";

/** 通知邮件的去重键片段（同一收件人 + 同一标题/链接的短期重复通知只排一封） */
const hashKey = (v: string) =>
  createHash("sha256").update(v).digest("hex").slice(0, 24);
import type { Actor } from "../permission/actor.ts";

export type NotifyCategory =
  "MENTION" | "ASSIGN" | "TRANSITION" | "FIELD_CHANGE" | "ANNOUNCEMENT";

export interface NotifyInput {
  recipientId: string;
  actorId: string | null;
  category: NotifyCategory;
  type: string; // 领域事件名，不硬编码枚举
  title: string;
  body: string;
  link?: string | null;
  /** 同对象同操作的聚合键；@提及类传 null（不聚合） */
  groupKey?: string | null;
}

/**
 * 判断当前是否处于收件人的免打扰时段。
 *
 * ⚠️ 跨天由 start > end 表达，所以判定要分两种情况，
 *    写成 `start <= now < end` 会把 22:00–08:00 这种最常见配置判反。
 */
export async function isInDnd(
  recipientId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await db
    .select()
    .from(notificationPreference)
    .where(eq(notificationPreference.memberId, recipientId))
    .limit(1);
  const p = rows[0];
  if (!p?.dndStart || !p?.dndEnd) return false;

  const tz = p.dndTimezone ?? "Asia/Shanghai";
  // 用收件人时区取「本地时间」，不是服务器时间
  const local = (await db.execute(
    sql`select (${now.toISOString()}::timestamptz at time zone ${tz})::time as t`,
  )) as unknown as { t: string }[];
  const t = local[0]?.t ?? "00:00:00";
  const start = p.dndStart,
    end = p.dndEnd;

  if (start <= end) {
    // 同日时段：08:00–20:00
    return t >= start && t < end;
  }
  // 跨天时段：22:00–08:00
  return t >= start || t < end;
}

/** 分类开关：默认都开；用户显式关掉才不发 */
async function isCategoryEnabled(
  recipientId: string,
  category: NotifyCategory,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(notificationPreference)
    .where(eq(notificationPreference.memberId, recipientId))
    .limit(1);
  const prefs = (rows[0]?.categoryPrefs ?? {}) as Record<
    string,
    { inApp?: boolean; email?: boolean }
  >;
  return prefs[category]?.inApp !== false;
}

/**
 * 发一条通知。
 *
 * @mention 类别**不走免打扰**（规范：强通知实时送达），其余类别走。
 */
async function signalNotificationChange(memberId: string): Promise<void> {
  try {
    const { publish } = await import("./events.service.ts");
    await publish(
      "notification.changed",
      { unreadCount: await countUnreadById(memberId) },
      memberId,
    );
  } catch {
    /* DB remains the truth source. */
  }
}

export async function notify(input: NotifyInput): Promise<void> {
  const skipDnd = input.category === "MENTION";
  if (!skipDnd) {
    if (!(await isCategoryEnabled(input.recipientId, input.category))) return;
    if (await isInDnd(input.recipientId)) return;
  }

  if (input.groupKey) {
    // 聚合：同组已有未读通知则只累加计数，不新插一行
    const existing = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.groupKey, input.groupKey),
          eq(notification.recipientId, input.recipientId),
          isNull(notification.readAt),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(notification)
        .set({
          itemCount: (existing[0].itemCount ?? 1) + 1,
          createdAt: new Date(),
        })
        .where(eq(notification.id, existing[0].id));
      await signalNotificationChange(input.recipientId);
      return;
    }
  }

  const [row] = await db
    .insert(notification)
    .values({
      recipientId: input.recipientId,
      actorId: input.actorId,
      category: input.category,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      groupKey: input.groupKey ?? null,
      itemCount: 1,
    })
    .returning();

  // ── EMAIL 渠道：只有订阅了该工作项的 EMAIL 渠道才投递（规范 7.2）──
  //    失败只记日志，绝不回滚已落库的通知（与 SSE 同纪律）
  if (input.link?.startsWith("/work-items/")) {
    const wiId = input.link.slice("/work-items/".length);
    try {
      const { sql: pg } = await import("../../db/index.ts");
      const subs = await pg<{ member_id: string }[]>`
        select member_id from subscription
        where target_type = 'WORK_ITEM' and target_id = ${wiId} and notify_channel = 'EMAIL'
          and member_id = ${input.recipientId}
      `;
      if (subs.length > 0) {
        const { templates } = await import("./mail.service.ts");
        const rows = await db
          .select({ email: member.email })
          .from(member)
          .where(eq(member.id, input.recipientId))
          .limit(1);
        const to = rows[0]?.email;
        if (to) {
          // 走任务队列：邮件失败可重试，且不占用通知落库事务
          const { enqueue } = await import("./job.service.ts");
          await enqueue({
            kind: "email.send",
            payload: {
              to,
              subject: input.title,
              text: templates.notification(input.title, input.body, input.link),
            },
            dedupeKey: `notify-email:${input.recipientId}:${hashKey(input.title + (input.link ?? ""))}`,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error("[notify] 邮件渠道失败（不阻断）:", (e as Error).message);
    }
  }

  // ── IM 渠道（Round 76）：钉钉/企微/飞书；入队失败不阻断通知 ──
  try {
    const { dispatchNotification } = await import("./im.service.ts");
    await dispatchNotification({
      category: input.category,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    });
  } catch (e) {
    console.error("[notify] IM 渠道失败（不阻断）:", (e as Error).message);
  }

  // ── SSE：notification.new（unreadCount 供顶栏直接更新，不全量拉）──
  try {
    const { publish } = await import("./events.service.ts");
    const unread = await countUnreadById(input.recipientId);
    await publish(
      "notification.new",
      {
        id: row!.id,
        category: input.category,
        title: input.title,
        link: input.link ?? null,
        unreadCount: unread,
      },
      input.recipientId,
    );
  } catch {
    /* SSE 可丢（Valkey 非真相源），失败不影响通知落库 */
  }
}

/** 我的通知列表（未读优先） */
export async function listNotifications(
  actor: Actor,
  opts: { unreadOnly?: boolean } = {},
) {
  const conds = [eq(notification.recipientId, actor.memberId)];
  if (opts.unreadOnly) conds.push(isNull(notification.readAt));
  return db
    .select()
    .from(notification)
    .where(and(...conds))
    .orderBy(desc(notification.createdAt));
}

/** 未读数（铃铛徽标） */
export async function countUnread(actor: Actor): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.recipientId, actor.memberId),
        isNull(notification.readAt),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function markRead(actor: Actor, id: string): Promise<void> {
  const res = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.id, id),
        eq(notification.recipientId, actor.memberId),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  if (res.length > 0) {
    await signalNotificationChange(actor.memberId);
    return;
  }
  /**
   * 没更新到行有两种情况，必须区分（否则 agent 重试「标记已读」会一直报错，
   * 而把"不是我的通知"也当成成功又会让权限判定形同虚设）：
   *   1 本来就是已读 → 目标状态已达成，按幂等返回成功
   *   2 不存在 / 不是我的 → 拒绝，且与"不存在"同形
   */
  const mine = await db
    .select({ id: notification.id })
    .from(notification)
    .where(
      and(
        eq(notification.id, id),
        eq(notification.recipientId, actor.memberId),
      ),
    )
    .limit(1);
  if (mine[0]) return;
  throw forbidden();
}

export async function markAllRead(actor: Actor): Promise<void> {
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.recipientId, actor.memberId),
        isNull(notification.readAt),
      ),
    );
  await signalNotificationChange(actor.memberId);
}

// ── 免打扰偏好 ───────────────────────────────────────────────

const prefsSchema = {
  categoryPrefs: "object" as const,
};

export async function getPreferences(actor: Actor) {
  const rows = await db
    .select()
    .from(notificationPreference)
    .where(eq(notificationPreference.memberId, actor.memberId))
    .limit(1);
  if (rows[0]) return rows[0];
  // 没有偏好行时返回默认值（不落库，避免为每个成员建一行）
  return {
    memberId: actor.memberId,
    categoryPrefs: {},
    dndStart: null,
    dndEnd: null,
    dndTimezone: actor.timezone ?? "Asia/Shanghai",
    digestFrequency: "OFF",
    updatedAt: new Date(),
  };
}

export async function updatePreferences(actor: Actor, patch: {
  categoryPrefs?: Record<string, { inApp?: boolean; email?: boolean }>;
  dndStart?: string | null;
  dndEnd?: string | null;
  dndTimezone?: string;
  digestFrequency?: string;
}): Promise<void> {
  for (const value of [patch.dndStart, patch.dndEnd]) {
    if (value != null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new DomainError("VALIDATION", "免打扰时间必须是有效的 HH:MM", null);
    }
  }
  if (patch.dndTimezone !== undefined) {
    try { new Intl.DateTimeFormat("en", { timeZone: patch.dndTimezone }); }
    catch { throw new DomainError("VALIDATION", "免打扰时区不合法", null); }
  }
  if (
    patch.digestFrequency &&
    !["OFF", "DAILY", "WEEKLY"].includes(patch.digestFrequency)
  ) {
    throw new DomainError(
      "VALIDATION",
      "摘要频率只能是 OFF / DAILY / WEEKLY",
      null,
    );
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.dndStart !== undefined) set.dndStart = patch.dndStart;
  if (patch.dndEnd !== undefined) set.dndEnd = patch.dndEnd;
  if (patch.dndTimezone !== undefined) set.dndTimezone = patch.dndTimezone;
  if (patch.digestFrequency !== undefined)
    set.digestFrequency = patch.digestFrequency;

  await db.transaction(async (tx) => {
    // 先建立合法默认行，再锁定并合并 PATCH；直接 upsert 半个时段会在冲突处理前触发 CHECK。
    await tx.insert(notificationPreference).values({ memberId: actor.memberId })
      .onConflictDoNothing({ target: notificationPreference.memberId });
    const [current] = await tx.select().from(notificationPreference)
      .where(eq(notificationPreference.memberId, actor.memberId)).for("update");
    if (patch.categoryPrefs !== undefined) {
      const categories = { ...current!.categoryPrefs as Record<string, { inApp?: boolean; email?: boolean }> };
      for (const [category, channels] of Object.entries(patch.categoryPrefs)) {
        categories[category] = { ...categories[category], ...channels };
      }
      set.categoryPrefs = categories;
    }
    const start = patch.dndStart !== undefined ? patch.dndStart : current!.dndStart;
    const end = patch.dndEnd !== undefined ? patch.dndEnd : current!.dndEnd;
    if ((start !== null) !== (end !== null)) {
      throw new DomainError("VALIDATION", "免打扰的起始与截止必须同时填写或同时留空", null);
    }
    await tx.update(notificationPreference).set(set)
      .where(eq(notificationPreference.memberId, actor.memberId));
  });
}

void isNull;
void member;
void mention;
void prefsSchema;
void desc;

/** 通知内部用的未读数（notify 发布事件时取最新值） */
async function countUnreadById(recipientId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.recipientId, recipientId),
        isNull(notification.readAt),
      ),
    );
  return rows[0]?.n ?? 0;
}
