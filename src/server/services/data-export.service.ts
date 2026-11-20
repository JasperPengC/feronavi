/**
 * 个人数据导出（第十四期，规范 2.6 数据可携带权 + REST 10 节 `GET /me/data-export`）
 *
 * 三条纪律：
 *   1 **只导出本人数据** —— 接口不接受 memberId 参数（能传 id 就会被拿来拉别人）
 *   2 **绝不导出密钥类材料**：密码哈希、会话令牌、API 令牌哈希/明文、双因素密钥、恢复码哈希、
 *      重置令牌 —— 这些既不是"我的数据"，泄露了还直接等于账号失守
 *   3 **不导出他人的内容**：我评论过的帖子正文属于别人；工作项只导我报告或指派给我的那些的
 *      **元数据**（id/key/标题/状态），评论正文只导我自己写的
 */
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  apiToken, comment, focusSession, idea, member, memberPreference, notificationPreference,
  ragConsent, session, timeBlock, timeLog, todo, twoFactorSecret, workItem, workItemCollaborator,
} from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { loadActor } from "../auth/actor-loader.ts";
import { exportConversationData } from "./rag-conversation.service.ts";

export const EXPORT_SCHEMA_VERSION = "1";

export async function exportMemberData(memberId: string, actor?: Actor) {
  const currentActor = actor ?? await loadActor(memberId);
  if (!currentActor || currentActor.memberId !== memberId) throw new DomainError("FORBIDDEN", "无法导出其他账号的数据", null);
  const savedKnowledge = await exportConversationData(currentActor);
  const profileRows = await db.select({
    id: member.id, username: member.username, name: member.name, email: member.email,
    status: member.status, locale: member.locale, timezone: member.timezone,
    createdAt: member.createdAt, anonymizedAt: member.anonymizedAt,
  }).from(member).where(eq(member.id, memberId)).limit(1);
  const profile = profileRows[0];
  if (!profile) throw new DomainError("NOT_FOUND", "成员不存在", null);

  const prefs = await db.select().from(memberPreference).where(eq(memberPreference.memberId, memberId));
  const notifPrefs = await db.select().from(notificationPreference).where(eq(notificationPreference.memberId, memberId));
  // 会话只导元数据（**不导令牌**：令牌泄露等于账号失守）
  const sessions = await db.select({
    id: session.id, ip: session.ip, userAgent: session.userAgent,
    // 该表用的是 last_seen_at（没有 created_at）
    lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt, revokedAt: session.revokedAt,
  }).from(session).where(eq(session.memberId, memberId));
  // 令牌同理：只导名称/档位/前缀/时间，不导哈希与明文
  const tokens = await db.select({
    name: apiToken.name, tokenPrefix: apiToken.tokenPrefix, tier: apiToken.tier,
    expiresAt: apiToken.expiresAt, lastUsedAt: apiToken.lastUsedAt, revokedAt: apiToken.revokedAt,
  }).from(apiToken).where(eq(apiToken.memberId, memberId));
  const twoFa = await db.select({ status: twoFactorSecret.status, createdAt: twoFactorSecret.createdAt })
    .from(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId));

  const todos = await db.select().from(todo).where(eq(todo.memberId, memberId));
  const myComments = await db.select().from(comment).where(eq(comment.authorId, memberId));
  const myWorkItems = await db.select({
    id: workItem.id, key: workItem.key, title: workItem.title, type: workItem.type,
    statusId: workItem.statusId, createdAt: workItem.createdAt,
  }).from(workItem).where(or(eq(workItem.reporterId, memberId), eq(workItem.assigneeId, memberId)));
  const myCollabs = await db.select().from(workItemCollaborator).where(eq(workItemCollaborator.memberId, memberId));
  const myTimeLogs = await db.select().from(timeLog).where(eq(timeLog.memberId, memberId));
  const myBlocks = await db.select().from(timeBlock).where(eq(timeBlock.memberId, memberId));
  const myFocus = await db.select().from(focusSession).where(eq(focusSession.memberId, memberId));
  const myIdeas = await db.select().from(idea).where(eq(idea.submittedByMemberId, memberId));
  const myConsents = await db.select().from(ragConsent).where(eq(ragConsent.memberId, memberId));

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    subject: { memberId, username: profile.username },
    /** 明确写出"哪些没导"及其原因 —— 可携带权的边界必须可解释 */
    excludes: [
      "密码哈希、会话令牌、API 令牌哈希与明文、双因素密钥与恢复码、重置令牌（安全材料，不属于可携带数据）",
      "他人撰写的内容（评论正文仅含本人所写；工作项仅含本人报告或经手的元数据）",
      "附件二进制（体积原因，按需单独申请）",
    ],
    sections: {
      profile,
      preferences: prefs,
      notificationPreferences: notifPrefs,
      sessions,
      apiTokens: tokens,
      twoFactor: twoFa,
      todos,
      comments: myComments,
      workItems: myWorkItems,
      collaborators: myCollabs,
      timeLogs: myTimeLogs,
      timeBlocks: myBlocks,
      focusSessions: myFocus,
      ideas: myIdeas,
      ragConsents: myConsents,
      ragConversations: savedKnowledge.conversations,
      ragMessages: savedKnowledge.messages,
    },
    counts: {
      todos: todos.length, comments: myComments.length, workItems: myWorkItems.length,
      timeLogs: myTimeLogs.length, ideas: myIdeas.length, sessions: sessions.length,
      apiTokens: tokens.length, ragConsents: myConsents.length,
      ragConversations: savedKnowledge.conversations.length, ragMessages: savedKnowledge.messages.length,
    },
  };
}

/** 导出包大小自检：超大数据集应提示改用全量导出（避免把接口当批量下载器） */
export async function exportSize(memberId: string): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(comment).where(eq(comment.authorId, memberId));
  return r[0]?.n ?? 0;
}

void desc; void inArray;
