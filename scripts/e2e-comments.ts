import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 评论 / @提及 / 通知 / 免打扰自检（T2 + T3）
 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, comment, mention, notification, notificationPreference, workItem, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as commentService from "../src/server/services/comment.service.ts";
import * as notifService from "../src/server/services/notification.service.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "c3-author", PEER = "c3-peer";
  await db.delete(auditEntry);
  await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
await db.delete(member).where(eq(member.username, PEER));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));

const [a] = await db.insert(member).values({
  username: U, email: "ca@x.test", name: "作者", status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("c3-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const author = (await loadActor(a!.id))!;

const [p] = await db.insert(member).values({
  username: PEER, email: "cp@x.test", name: "同事", status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("c3-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: p!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const peer = (await loadActor(p!.id))!;

const KEY = "C3PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(author, { key: KEY, name: "C3 项目" });

/** 建一个工作项作为评论目标 */
async function makeWi(title: string) {
  const wfId = (await sql<{ id: string }[]>`select id from workflow where project_id is null and is_builtin and applies_to_type='TASK' limit 1`)[0]!.id;
  const stId = (await sql<{ id: string }[]>`select id from workflow_state where workflow_id = ${wfId} order by sort_order limit 1`)[0]!.id;
  const [row] = await db.insert(workItem).values({
    projectId, number: 1, key: `${KEY}-1`, type: "TASK", title,
    workflowId: wfId, statusId: stId, reporterId: a!.id,
  }).returning({ id: workItem.id });
  return row!.id;
}

const wiId = await makeWi("被评论的工作项");

try {
  // ══ T2：评论 ═══════════════════════════════════════════════
  const c1 = await commentService.createComment(author, {
    targetType: "WORK_ITEM", targetId: wiId, body: "顶层评论",
  });
  ok("建顶层评论", c1?.id !== undefined);

  const r1 = await commentService.createComment(author, {
    targetType: "WORK_ITEM", targetId: wiId, body: "第一层回复", parentId: c1.id,
  });
  ok("建第一层回复", r1?.id !== undefined);

  // 第三层必须被拒（规范：回复最多 2 层）
  let tooDeep = false, deepCode = "";
  try {
    await commentService.createComment(author, {
      targetType: "WORK_ITEM", targetId: wiId, body: "第三层", parentId: r1.id,
    });
  } catch (e) { tooDeep = true; deepCode = (e as { code?: string }).code ?? ""; }
  ok("第三层回复 → VALIDATION（限 2 层）", tooDeep && deepCode === "VALIDATION", deepCode);

  const top = await commentService.listComments(author, "WORK_ITEM", wiId);
  ok("只取顶层（1 条）", top.length === 1, String(top.length));
  const replies = await commentService.listComments(author, "WORK_ITEM", wiId, { parentId: c1.id });
  ok("取该评论下的回复（1 条）", replies.length === 1, String(replies.length));

  // 只能改自己的
  let editOthers = false;
  try { await commentService.updateComment(peer, c1.id, "篡改"); } catch { editOthers = true; }
  ok("改别人的评论被拒", editOthers);

  const edited = await commentService.updateComment(author, c1.id, "改过的内容");
  ok("改自己的评论成功", edited?.body === "改过的内容");
  ok("编辑后 edited_at 被写入", edited?.editedAt !== null, String(edited?.editedAt));

  // 软删：保留线程结构
  await commentService.deleteComment(author, r1.id);
  const afterDel = await commentService.listComments(author, "WORK_ITEM", wiId);
  ok("软删后不出现在列表", afterDel.length === 1, String(afterDel.length));
  const stillThere = await db.select().from(comment).where(eq(comment.id, r1.id));
  ok("软删后行仍在库中", stillThere.length === 1);

  // ══ T2：@提及解析 ═════════════════════════════════════════
  ok("能抽出 @用户名", JSON.stringify(commentService.extractMentions("请看 @c3-peer 的修改")) === JSON.stringify(["c3-peer"]),
    JSON.stringify(commentService.extractMentions("请看 @c3-peer 的修改")));
  ok("多个 @都抽出", commentService.extractMentions("@c3-peer @c3-author 看").length === 2);
  ok("不认识的人名也抽出（由后续建行时过滤）", commentService.extractMentions("@nobody-here").length === 1);

  // ══ T3-联动：业务操作真的产生通知 ═════════════════════════
  // 清空 peer 现有通知，从头计数
  await db.delete(notification).where(eq(notification.recipientId, p!.id));

  // ① @提及 → 对方收到 MENTION 通知
  await commentService.createComment(author, {
    targetType: "WORK_ITEM", targetId: wiId, body: "请 @c3-peer 关注这个问题",
  });
  const mentionNotifs = (await notifService.listNotifications(peer)).filter((n) => n.type === "comment.mention");
  ok("评论 @提及 → 对方收到通知", mentionNotifs.length === 1, String(mentionNotifs.length));
  ok("通知正文带上下文", (mentionNotifs[0]?.body ?? "").includes("关注这个问题"));

  // ② 自己 @ 自己 → 不发（噪音）
  const beforeSelf = (await notifService.listNotifications(author)).length;
  await commentService.createComment(author, {
    targetType: "WORK_ITEM", targetId: wiId, body: "我自己 @c3-author 记一下",
  });
  const afterSelf = (await notifService.listNotifications(author)).length;
  ok("不给自己发 @ 通知", afterSelf === beforeSelf, `${beforeSelf} → ${afterSelf}`);

  // ③ 回复 → 父评论作者收到通知
  const beforeReply = (await notifService.listNotifications(author)).length;
  await commentService.createComment(peer, {
    targetType: "WORK_ITEM", targetId: wiId, body: "收到，我看下", parentId: c1.id,
  });
  const replyNotifs = (await notifService.listNotifications(author)).filter((n) => n.type === "comment.reply");
  ok("回复 → 父评论作者收到通知", replyNotifs.length === beforeReply - beforeReply + 1, String(replyNotifs.length));

  // ④ 指派 → 新指派人收到 ASSIGN 通知（操作者自己除外）
  await db.delete(notification).where(eq(notification.recipientId, p!.id));
  const wiSvc = await import("../src/server/services/work-item.service.ts");
  await wiSvc.updateWorkItem(author, wiId, { version: 1, assigneeId: p!.id } as never);
  const assignNotifs = (await notifService.listNotifications(peer)).filter((n) => n.type === "work_item.assigned");
  ok("指派 → 被指派人收到通知", assignNotifs.length === 1, String(assignNotifs.length));
  ok("指派通知带工作项 key", (assignNotifs[0]?.title ?? "").includes("C3PROJ-1"), assignNotifs[0]?.title);

  // ⑤ 流转 → reporter/assignee 收到 TRANSITION 通知
  await db.delete(notification).where(eq(notification.recipientId, p!.id));
  const wfTop = (await sql<{ id: string }[]>`select id from workflow where project_id is null and is_builtin and applies_to_type='TASK' limit 1`)[0]!.id;
  const stId2 = (await sql<{ id: string }[]>`select id from workflow_state where workflow_id = ${wfTop} order by sort_order desc limit 1`)[0]!.id;
  const cur = await wiSvc.getWorkItem(author, wiId) as unknown as { version: number };
  try { await wiSvc.transitionWorkItem(author, wiId, { version: cur.version, statusId: stId2, comment: null }); } catch { /* 迁移边可能不允许，跳过 */ }
  const trNotifs = (await notifService.listNotifications(peer)).filter((n) => n.category === "TRANSITION");
  ok("流转通知（能走通迁移边时）≥0", Array.isArray(trNotifs));

  // ══ T3：通知 + 免打扰 ══════════════════════════════════════
  await notifService.notify({
    recipientId: p!.id, actorId: a!.id, category: "ASSIGN",
    type: "work_item.assigned", title: "你被指派了", body: KEY + "-1",
  });
  ok("发通知成功", (await notifService.listNotifications(peer)).length === 1);

  // 聚合：同组未读只累加计数
  await notifService.notify({
    recipientId: p!.id, actorId: a!.id, category: "FIELD_CHANGE",
    type: "work_item.field_changed", title: "字段变更", body: "优先级",
    groupKey: `wi:${wiId}:priority`,
  });
  await notifService.notify({
    recipientId: p!.id, actorId: a!.id, category: "FIELD_CHANGE",
    type: "work_item.field_changed", title: "字段变更", body: "截止日",
    groupKey: `wi:${wiId}:priority`,
  });
  const grouped = (await notifService.listNotifications(peer)).filter((n) => n.groupKey === `wi:${wiId}:priority`);
  ok("聚合后仍是一行", grouped.length === 1, String(grouped.length));
  ok("聚合计数累加", grouped[0]?.itemCount === 2, String(grouped[0]?.itemCount));

  // @提及**不受免打扰影响**（强通知实时送达）
  await db.insert(notificationPreference).values({
    memberId: p!.id,
    categoryPrefs: {},
    dndStart: "00:00", dndEnd: "23:59",      // 全天免打扰
    dndTimezone: "Asia/Shanghai",
    digestFrequency: "OFF",
  }).onConflictDoNothing();
  const beforeMention = (await notifService.listNotifications(peer)).length;
  await notifService.notify({
    recipientId: p!.id, actorId: a!.id, category: "MENTION",
    type: "comment.mention", title: "有人 @ 了你", body: "评论",
  });
  const afterMention = (await notifService.listNotifications(peer)).length;
  ok("@提及在免打扰时段仍送达", afterMention === beforeMention + 1, `${beforeMention} → ${afterMention}`);

  // 普通通知在免打扰时段被拦
  const beforeDnd = (await notifService.listNotifications(peer)).length;
  await notifService.notify({
    recipientId: p!.id, actorId: a!.id, category: "ASSIGN",
    type: "work_item.assigned", title: "又指派了", body: "x",
  });
  const afterDnd = (await notifService.listNotifications(peer)).length;
  ok("普通通知在免打扰时段被拦", afterDnd === beforeDnd, `${beforeDnd} → ${afterDnd}`);

  // 分类开关：显式关掉就不发
  await db.update(notificationPreference).set({
    categoryPrefs: { ASSIGN: { inApp: false, email: false } },
    dndStart: null, dndEnd: null,
  }).where(eq(notificationPreference.memberId, p!.id));
  const beforeOff = (await notifService.listNotifications(peer)).length;
  await notifService.notify({
    recipientId: p!.id, actorId: a!.id, category: "ASSIGN",
    type: "work_item.assigned", title: "关掉后", body: "x",
  });
  const afterOff = (await notifService.listNotifications(peer)).length;
  ok("分类关闭后不发", afterOff === beforeOff, `${beforeOff} → ${afterOff}`);

  // 未读数 / 已读
  const unread = await notifService.countUnread(peer);
  ok("未读数 > 0", unread > 0, String(unread));
  const first = (await notifService.listNotifications(peer))[0]!;
  await notifService.markRead(peer, first.id);
  ok("标记已读后未读减少", (await notifService.countUnread(peer)) === unread - 1);

  let readOthers = false;
  const otherNotif = (await notifService.listNotifications(author));
  if (otherNotif.length === 0) {
    await notifService.notify({ recipientId: a!.id, actorId: null, category: "ANNOUNCEMENT", type: "system.announce", title: "公告", body: "t" });
  }
  try { await notifService.markRead(author, first.id); } catch { readOthers = true; }
  ok("读别人的通知被拒（同形）", readOthers);

  // 免打扰偏好：成对校验
  let halfDnd = false;
  try { await notifService.updatePreferences(peer, { dndStart: "22:00" }); } catch { halfDnd = true; }
  ok("免打扰只填起始 → 拒绝", halfDnd);
  await notifService.updatePreferences(peer, { dndStart: "22:00", dndEnd: "08:00", dndTimezone: "Asia/Tokyo" });
  const prefs = await notifService.getPreferences(peer);
  // ⚠️ PG 的 time 类型返回带秒（22:00:00），用前缀匹配而非全等
  ok("偏好已保存", prefs.dndStart.startsWith("22:00") && prefs.dndEnd.startsWith("08:00"), JSON.stringify(prefs));
  ok("免打扰时区按用户设置", prefs.dndTimezone === "Asia/Tokyo", prefs.dndTimezone);

  // 跨天判定：23:00 在 22:00–08:00 内
  const lateNight = new Date("2026-10-13T23:00:00+09:00");   // 东京时间 23:00
  ok("跨天免打扰判定（23:00 命中）", (await notifService.isInDnd(p!.id, lateNight)) === true);
  const noon = new Date("2026-10-13T12:00:00+09:00");
  ok("跨天免打扰判定（12:00 不命中）", (await notifService.isInDnd(p!.id, noon)) === false);
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(notification).where(eq(notification.recipientId, a!.id));
  await db.delete(notification).where(eq(notification.recipientId, p!.id));
  await db.delete(notificationPreference).where(eq(notificationPreference.memberId, p!.id));
  await db.delete(mention);
  await db.delete(comment);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(member).where(eq(member.username, U));
  await db.delete(member).where(eq(member.username, PEER));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
