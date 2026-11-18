import "./_env.ts";   // 环境预设必须最先加载
/**
 * 活动覆盖扩展自检（Round 25 长任务第 6 项）：
 * 评论 / Wiki 文档 / 附件 的真实操作都要写 activity_entry，并在项目活动端点可见。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import {
  activityEntry, attachment, comment, member, page, pageRevision, pagePermission, project, role, roleAssignment, workItem,
} from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as commentService from "../src/server/services/comment.service.ts";
import * as wikiService from "../src/server/services/wiki.service.ts";
import * as attachmentService from "../src/server/services/attachment.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const USER = "act-cov-admin";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
const KEY = `ACOV${SUFFIX}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(USER);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: USER, email: "act-cov@x.test", name: "活动覆盖员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword("act-cov-pass-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });

let projectId = "", wiId = "", pageId = "", attId = "";
try {
  const proj = await projectService.createProject(admin, { key: KEY, name: "活动覆盖项目" } as never);
  projectId = proj.id;
  const wi = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "活动覆盖工作项" }) as { id: string; key: string };
  wiId = wi.id;

  // ① 评论：创建 + 删除
  const c = await commentService.createComment(admin, { targetType: "WORK_ITEM", targetId: wiId, body: "活动覆盖测试评论" });
  await commentService.deleteComment(admin, c.id);

  // ② 文档：创建 + 更新 + 删除
  const p = await wikiService.createPage(admin, projectId, { title: `活动覆盖文档 ${SUFFIX}`, content: "正文" });
  pageId = p.id;
  await wikiService.updatePage(admin, pageId, { content: "正文（改）", changeSummary: "改一下" } as never);
  await wikiService.deletePage(admin, pageId);

  // ③ 附件：上传 + 删除（PNG 白名单类型；内容只要求通过校验，不参与业务）
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 0)]);
  const att = await attachmentService.upload(admin, {
    targetType: "WORK_ITEM", targetId: wiId,
    originalName: `活动覆盖附件-${SUFFIX}.png`, mimeType: "image/png", sizeBytes: png.length, data: png,
  });
  attId = att.id;
  await attachmentService.remove(admin, attId);

  // ── 库内校验 ──
  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, projectId));
  const byAction = (a: string) => acts.filter((x) => x.action === a);
  const sums = acts.map((a) => a.summary);
  ok("评论创建写活动", byAction("comment.created").length === 1 && sums.some((s) => s.includes(wi.key) && s.includes("评论了工作项")));
  ok("评论删除写活动", byAction("comment.deleted").length === 1 && sums.some((s) => s.includes(wi.key) && s.includes("删除了")));
  ok("文档创建/更新/删除写活动",
    byAction("wiki.created").length === 1 && byAction("wiki.updated").length === 1 && byAction("wiki.deleted").length === 1
    && sums.some((s) => s.includes(`活动覆盖文档 ${SUFFIX}`) && s.includes("创建了文档"))
    && sums.some((s) => s.includes(`活动覆盖文档 ${SUFFIX}`) && s.includes("更新了文档"))
    && sums.some((s) => s.includes(`活动覆盖文档 ${SUFFIX}`) && s.includes("删除了文档")));
  ok("附件上传/删除写活动",
    byAction("attachment.uploaded").length === 1 && byAction("attachment.deleted").length === 1
    && sums.some((s) => s.includes("上传了附件") && s.includes(SUFFIX) && s.includes(wi.key))
    && sums.some((s) => s.includes("删除了工作项") && s.includes("附件")));
  ok("摘要不含裸 UUID", acts.every((a) => !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(a.summary)),
    JSON.stringify(sums.filter((s) => /[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)).slice(0, 3)));

  // ── HTTP 项目活动端点可见 ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: "act-cov-pass-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const api = await fetch(`${BASE}/api/v1/projects/${projectId}/activity?pageSize=100`, { headers: { cookie } });
  const body = await api.json() as { items?: { action: string }[]; total?: number };
  const actions = (body.items ?? []).map((x) => x.action);
  ok("活动端点返回评论/文档/附件事件",
    api.status === 200
    && ["comment.created", "comment.deleted", "wiki.created", "wiki.updated", "wiki.deleted", "attachment.uploaded", "attachment.deleted"].every((a) => actions.includes(a)),
    `${api.status} ${JSON.stringify(actions)}`);

  // ── 筛选：类别 / 关键字 / 只看我的 / LIKE 通配符转义 ──
  const getJson = async (qs: string) => {
    const r = await fetch(`${BASE}/api/v1/projects/${projectId}/activity?${qs}`, { headers: { cookie } });
    return await r.json() as { items?: { action: string; summary: string; actorId?: string | null }[]; total?: number };
  };
  const onlyComments = await getJson("pageSize=100&category=comment");
  ok("category=comment 只返回评论事件",
    (onlyComments.total ?? 0) === 2 && (onlyComments.items ?? []).every((x) => x.action.startsWith("comment.")),
    JSON.stringify({ total: onlyComments.total, actions: (onlyComments.items ?? []).map((x) => x.action) }));
  const onlyWiki = await getJson("pageSize=100&category=wiki");
  ok("category=wiki 只返回文档事件", (onlyWiki.total ?? 0) === 3 && (onlyWiki.items ?? []).every((x) => x.action.startsWith("wiki.")));
  const byKeyword = await getJson(`pageSize=100&q=${encodeURIComponent(wi.key)}`);
  ok("关键字搜索命中含工作项 KEY 的摘要（评论/附件）",
    (byKeyword.total ?? 0) >= 3 && (byKeyword.items ?? []).every((x) => x.summary.includes(wi.key)),
    JSON.stringify({ total: byKeyword.total, sums: (byKeyword.items ?? []).map((x) => x.summary).slice(0, 3) }));
  const wildcard = await getJson("pageSize=100&q=%25");
  ok("LIKE 通配符被转义（q=% 不返回全部）", (wildcard.total ?? -1) === 0, JSON.stringify({ total: wildcard.total }));
  const mine = await getJson("pageSize=100&mine=1");
  ok("mine=1 只返回当前成员的活动", (mine.total ?? 0) >= 7 && (mine.items ?? []).every((x) => x.actorId === admin.memberId));
} finally {
  await app.close();
  await db.delete(activityEntry).where(eq(activityEntry.projectId, projectId || "00000000-0000-0000-0000-000000000000"));
  await db.delete(attachment).where(eq(attachment.id, attId || "00000000-0000-0000-0000-000000000000"));
  await db.delete(comment).where(eq(comment.targetId, wiId || "00000000-0000-0000-0000-000000000000"));
  if (pageId) {
    await db.delete(pagePermission).where(eq(pagePermission.pageId, pageId));
    await db.delete(pageRevision).where(eq(pageRevision.pageId, pageId));
    await db.delete(page).where(eq(page.id, pageId));
  }
  if (wiId) await db.delete(workItem).where(eq(workItem.id, wiId));
  if (projectId) await db.delete(project).where(eq(project.id, projectId));
  await deleteTestMember(USER);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
