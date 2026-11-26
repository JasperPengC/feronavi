import "./_env.ts";   // 环境预设必须最先加载
/**
 * 跨域引用链接自检（Round 25 长任务第 34 项，数据模型 3.3 / REST 第 3 节）：
 * 工作项 ↔ 想法/文档/里程碑/迭代/工作项；同项目校验、重复/自指拒绝、权限、删除清理（C-15）、
 * 想法转工作项写双向引用。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, idea, iteration, member, milestone, page, project, role, roleAssignment, workItem, workItemLink } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as ideaService from "../src/server/services/idea.service.ts";
import * as wikiService from "../src/server/services/wiki.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "wlink-admin";
const GUEST = "wlink-guest";
const PW = "wlink-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "链接管理员", ar!.id);
await mk(GUEST, "链接成员", mr!.id);
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `WLK${SUFFIX}`, name: "链接项目" } as never);
const other = await projectService.createProject(admin, { key: `WLX${SUFFIX}`, name: "另一项目" } as never);

const wi1 = await wiService.createWorkItem(admin, proj.id, { type: "TASK", title: "链接源工作项" } as never);
const wi2 = await wiService.createWorkItem(admin, proj.id, { type: "TASK", title: "链接目标工作项" } as never);
const wiOther = await wiService.createWorkItem(admin, other.id, { type: "TASK", title: "外部项目工作项" } as never);
const ideaRow = await ideaService.createIdea(admin, proj.id, { title: "链接想法" });
const pageRow = await wikiService.createPage(admin, proj.id, { title: "链接文档", content: "内容" });
const msRow = await planningService.createPlan(admin, proj.id, "milestone", { name: "链接里程碑", dueDate: "2026-12-01" });
const iterRow = await planningService.createPlan(admin, proj.id, "iteration", { name: "链接迭代", startDate: "2026-12-01", endDate: "2026-12-10" });

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return {
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(csrfToken),
  };
};
try {
  const H = { ...(await login(ADMIN)), "content-type": "application/json" };
  const post = (wid: string, targetType: string, targetId: string) => fetch(`${BASE}/api/v1/work-items/${wid}/links`, {
    method: "POST", headers: H, body: JSON.stringify({ targetType, targetId }),
  });
  const list = async (wid: string) => {
    const r = await fetch(`${BASE}/api/v1/work-items/${wid}/links`, { headers: { cookie: H.cookie } });
    return { status: r.status, body: await r.json() as { links?: { id: string; direction: string; target: { type: string; id: string; title: string; key: string | null } }[] } };
  };

  const toIdea = await post(wi1!.id, "IDEA", ideaRow!.id);
  const toIdeaBody = await toIdea.json() as { id: string; target: { title: string } };
  ok("链接到想法 201 且返回目标标题", toIdea.status === 201 && toIdeaBody.target.title === "链接想法", `${toIdea.status}`);
  ok("链接到文档/里程碑/迭代 均 201",
    (await post(wi1!.id, "PAGE", pageRow!.id)).status === 201
    && (await post(wi1!.id, "MILESTONE", msRow!.id)).status === 201
    && (await post(wi1!.id, "ITERATION", iterRow!.id)).status === 201);
  const toWi = await post(wi1!.id, "WORK_ITEM", wi2!.id);
  ok("链接到另一工作项 201", toWi.status === 201);

  const listed = await list(wi1!.id);
  ok("列表返回 5 条且类型齐全", listed.status === 200 && listed.body.links?.length === 5
    && ["IDEA", "PAGE", "MILESTONE", "ITERATION", "WORK_ITEM"].every((t) => listed.body.links!.some((l) => l.target.type === t)),
    JSON.stringify(listed.body.links?.map((l) => l.target.type)));

  ok("重复链接 → 400", (await post(wi1!.id, "IDEA", ideaRow!.id)).status === 400);
  ok("反向重复工作项链接 → 400", (await post(wi2!.id, "WORK_ITEM", wi1!.id)).status === 400);
  ok("链接到自身 → 400", (await post(wi1!.id, "WORK_ITEM", wi1!.id)).status === 400);
  ok("非法链接类型 → 400", (await post(wi1!.id, "COMMENT", ideaRow!.id)).status === 400);
  ok("跨项目目标 → 400", (await post(wi1!.id, "WORK_ITEM", wiOther!.id)).status === 400);

  const guestH = { ...(await login(GUEST)), "content-type": "application/json" };
  ok("无 work_item:update_any 者建链接 → 403", (await fetch(`${BASE}/api/v1/work-items/${wi1!.id}/links`, {
    method: "POST", headers: guestH, body: JSON.stringify({ targetType: "IDEA", targetId: ideaRow!.id }),
  })).status === 403);

  const del = await fetch(`${BASE}/api/v1/work-item-links/${toIdeaBody.id}`, {
    method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] },
  });
  ok("删除链接 200 且列表少一条", del.status === 200 && (await list(wi1!.id)).body.links?.length === 4);

  // ── C-15：目标删除时应用层清理 ──
  await ideaService.deleteIdea(admin, ideaRow!.id);
  await wikiService.deletePage(admin, pageRow!.id);
  const afterDel = await list(wi1!.id);
  ok("删除想法/文档后对应链接被清理", afterDel.body.links?.every((l) => l.target.type !== "IDEA" && l.target.type !== "PAGE"), JSON.stringify(afterDel.body.links?.map((l) => l.target.type)));
  await wiService.deleteWorkItem(admin, wi2!.id);
  const afterWi = await list(wi1!.id);
  ok("删除目标工作项后链接被清理", afterWi.body.links?.every((l) => l.target.type !== "WORK_ITEM"), JSON.stringify(afterWi.body.links?.map((l) => l.target.type)));

  // ── 想法转工作项：双向引用 ──
  const idea2 = await ideaService.createIdea(admin, proj.id, { title: "待转想法-链接" });
  const promoted = await ideaService.promote(admin, idea2!.id, {});
  const promotedLinks = await list(promoted.workItem!.id);
  ok("转工作项后工作项侧可见想法链接", promotedLinks.body.links?.some((l) => l.target.type === "IDEA" && l.target.title === "待转想法-链接"),
    JSON.stringify(promotedLinks.body.links?.map((l) => l.target.type)));
  ok("双向来源只展示一次且优先稳定的出向ID", promotedLinks.body.links?.length === 1
    && promotedLinks.body.links[0]?.direction === "outgoing");
  const both = await db.select().from(workItemLink).where(eq(workItemLink.sourceType, "IDEA"));
  ok("库内确有双向两行（IDEA→WORK_ITEM 与 WORK_ITEM→IDEA）",
    both.some((l) => l.sourceId === idea2!.id && l.targetType === "WORK_ITEM")
    && (await db.select().from(workItemLink).where(eq(workItemLink.targetType, "IDEA"))).some((l) => l.targetId === idea2!.id),
    JSON.stringify(both.length));
  const sourceLink = promotedLinks.body.links!.find((l) => l.direction === "outgoing")!;
  const removeSource = await fetch(`${BASE}/api/v1/work-item-links/${sourceLink.id}`, {
    method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] },
  });
  ok("一次移除完整双向引用且不残留隐藏项", removeSource.status === 200
    && (await list(promoted.workItem!.id)).body.links?.length === 0
    && !(await db.select().from(workItemLink)).some((l) => l.sourceId === idea2!.id || l.targetId === idea2!.id));
  const [incoming] = await db.insert(workItemLink).values({ sourceType: "IDEA", sourceId: idea2!.id,
    targetType: "WORK_ITEM", targetId: promoted.workItem!.id }).returning();
  const incomingList = (await list(promoted.workItem!.id)).body.links;
  ok("旧单向入向引用保持可见且禁止新建反向重复", incomingList?.length === 1
    && incomingList[0]?.id === incoming!.id && incomingList[0]?.direction === "incoming"
    && (await post(promoted.workItem!.id, "IDEA", idea2!.id)).status === 400);
} finally {
  await app.close();
  await db.delete(workItemLink);
  await db.delete(activityEntry);
  await db.delete(auditEntry);
  await db.delete(idea).where(eq(idea.projectId, proj.id));
  await db.delete(page).where(eq(page.projectId, proj.id));
  await db.delete(milestone).where(eq(milestone.projectId, proj.id));
  await db.delete(iteration).where(eq(iteration.projectId, proj.id));
  await db.delete(workItem).where(eq(workItem.projectId, proj.id));
  await db.delete(workItem).where(eq(workItem.projectId, other.id));
  for (const pid of [proj.id, other.id]) await db.delete(project).where(eq(project.id, pid));
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
