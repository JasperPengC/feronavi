import "./_env.ts";
/** 个人及跨项目资源的真实SSE：当前受众、事务后提交、所有写入口共享服务。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, ragMessage, role, roleAssignment } from "../src/db/schema.ts";
import { buildApp } from "../src/server/app.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as todos from "../src/server/services/workbench.service.ts";
import * as focus from "../src/server/services/focus.service.ts";
import * as views from "../src/server/services/planning.service.ts";
import * as portfolios from "../src/server/services/portfolio.service.ts";
import * as dashboards from "../src/server/services/insight.service.ts";
import * as templates from "../src/server/services/project-template.service.ts";
import * as conversations from "../src/server/services/rag-conversation.service.ts";
import { canDeliverEvent, subscribe, type SseEvent } from "../src/server/services/events.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const app = await buildApp({ logger: false });
const marker = randomUUID().slice(0, 8);
const password = `workspace-${marker}-password`;
const streams: { abort: AbortController; done: Promise<void> }[] = [];
const local: SseEvent[] = [];
const unsubscribe = subscribe(event => { if (event.event === "workspace.invalidated") local.push(event); });
let checks = 0;
const check = (name: string) => { checks++; console.log(`OK ${name}`); };
async function connect(username: string) {
  const login = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const abort = new AbortController();
  const response = await fetch(`${process.env.BASE}/api/v1/events`, { headers: { cookie }, signal: abort.signal });
  assert.equal(response.status, 200);
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const reader = response.body!.getReader();
  const done = (async () => {
    let text = "";
    try {
      while (true) {
        const result = await reader.read(); if (result.done) return;
        text += new TextDecoder().decode(result.value);
        let split: number;
        while ((split = text.indexOf("\n\n")) >= 0) {
          const block = text.slice(0, split); text = text.slice(split + 2);
          const event = /^event: (.+)$/mu.exec(block)?.[1];
          if (event) events.push({ event, data: JSON.parse(/^data: (.+)$/mu.exec(block)![1]!) });
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
  })();
  streams.push({ abort, done });
  return events;
}
async function until(fn: () => boolean) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await delay(30); }
  assert.ok(fn(), "事件未在3秒内抵达");
}
try {
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT) });
  const roles = await db.select().from(role);
  const people = await db.insert(member).values(await Promise.all(["owner", "reader", "outsider"].map(async name => ({ username: `workspace-${name}-${marker}`, name, status: "ACTIVE", passwordHash: await hashPassword(password) })))).returning();
  const [owner, reader, outsider] = people;
  await db.insert(roleAssignment).values({ memberId: owner!.id, roleId: roles.find(r => r.key === "ADMIN")!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(owner!.id))!;
  const project = await projects.createProject(actor, { key: `E${marker.replaceAll("-", "").toUpperCase()}`, name: "个人事件项目" });
  await db.insert(roleAssignment).values({ memberId: reader!.id, roleId: roles.find(r => r.key === "MEMBER")!.id, scopeType: "PROJECT", scopeId: project.id });
  const [mine, visible, hidden] = await Promise.all([connect(owner!.username), connect(reader!.username), connect(outsider!.username)]);
  const mineHas = (id: string) => mine.some(e => e.event === "workspace.invalidated" && e.data.resourceId === id);
  const clear = () => { mine.length = 0; visible.length = 0; hidden.length = 0; local.length = 0; };
  const ownOnly = async (id: string) => {
    await until(() => mineHas(id)); await delay(120);
    assert.equal(visible.some(e => e.data.resourceId === id), false); assert.equal(hidden.some(e => e.data.resourceId === id), false);
    assert.ok(local.every(event => event.memberId === owner!.id));
    assert.deepEqual(Object.keys(local[0]!.data).sort(), ["domain", "projectId", "resourceId", "resourceType"]);
  };
  const todo = (await todos.createTodo(actor, { title: "私密待办正文不能广播" }))!;
  await ownOnly(todo.id); check("个人待办仅本人第二客户端收到，载荷不含业务正文");
  clear(); await todos.updateTodo(actor, todo.id, { done: true }); await ownOnly(todo.id);
  clear(); await todos.deleteTodo(actor, todo.id); await ownOnly(todo.id); check("待办修改和删除均产生本人定向事件");
  clear(); const conversation = await conversations.createConversation(actor, { projectId: project.id, title: "助手私密会话" });
  await ownOnly(conversation.id);
  const conversationEvent = local.find(event => event.data.resourceId === conversation.id)!;
  assert.equal(conversationEvent.data.projectId, null);
  assert.equal(await canDeliverEvent(reader!.id, { ...conversationEvent, memberId: reader!.id }), false);
  clear(); await conversations.updateConversation(actor, conversation.id, { title: "会话改名" }); await ownOnly(conversation.id);
  clear(); await conversations.updateConversation(actor, conversation.id, { deleted: true }); await ownOnly(conversation.id);
  clear(); await conversations.updateConversation(actor, conversation.id, { deleted: false }); await ownOnly(conversation.id);
  clear(); await conversations.cancelMessage(actor, conversation.id, randomUUID()); await ownOnly(conversation.id);
  check("助手会话创建改名删除恢复取消只通知真实所有者，项目同事和伪造历史受众拒绝");
  await db.insert(ragMessage).values({ conversationId: conversation.id, requestId: randomUUID(), question: "过期请求", status: "pending", updatedAt: new Date(0) });
  clear(); await conversations.getConversation(actor, conversation.id); await ownOnly(conversation.id);
  clear(); await conversations.getConversation(actor, conversation.id); await delay(120); assert.equal(local.length, 0);
  check("会话过期消息只在首次失败迁移时通知本人，普通GET不产生事件循环");
  clear(); await assert.rejects(db.transaction(async () => { await conversations.createConversation(actor, { title: "回滚会话" }); assert.equal(local.length, 0); throw new Error("conversation rollback"); }), /conversation rollback/u);
  await delay(120); assert.equal(local.length, 0); check("助手会话外层事务回滚不发布事件");
  clear(); const block = (await focus.createBlock(actor, { title: "私密时间块", startAt: "2026-11-20T09:00:00Z", endAt: "2026-11-20T10:00:00Z", projectId: project.id }))!;
  await ownOnly(block.id);
  clear(); await focus.updateBlock(actor, block.id, { color: "blue" }); await ownOnly(block.id);
  clear(); const session = (await focus.recordFocusSession(actor, { timeBlockId: block.id, startedAt: "2026-11-20T09:00:00Z", endedAt: "2026-11-20T09:25:00Z" }))!; await ownOnly(session.id);
  clear(); await focus.updateFocusSession(actor, session.id, { note: "个人记录" }); await ownOnly(session.id);
  clear(); await focus.deleteBlock(actor, block.id); await ownOnly(block.id); check("聚焦五个写入口按本人定向，项目成员也不能收到个人时间数据");
  clear(); const personal = (await views.createSavedView(actor, { name: "私密视图", viewType: "TABLE" }))!; await ownOnly(personal.id);
  clear(); await views.updateSavedView(actor, personal.id, { name: "私密改名" }); await ownOnly(personal.id);
  clear(); await views.reorderSavedViews(actor, [personal.id]); await ownOnly(personal.id);
  clear(); await views.deleteSavedView(actor, personal.id); await ownOnly(personal.id); check("个人视图创建修改排序删除均只有本人收到");
  clear(); const shared = (await views.createSavedView(actor, { name: "共享视图", viewType: "TABLE", scope: "PROJECT_SHARED", projectId: project.id }))!;
  await until(() => visible.some(e => e.data.resourceId === shared.id)); await delay(120);
  assert.equal(hidden.some(e => e.data.resourceId === shared.id), false);
  assert.ok(local.every(event => event.memberId !== null));
  const oldSharedEvent = local.find(e => e.memberId === reader!.id && e.data.resourceId === shared.id)!;
  check("共享视图逐成员定向合法项目受众");
  clear(); const portfolio = await portfolios.createPortfolio(actor, { name: "组织共享项目集" });
  await until(() => hidden.some(e => e.data.resourceId === portfolio.id));
  assert.ok(local.every(event => event.memberId !== null));
  assert.ok(await canDeliverEvent(outsider!.id, local.find(e => e.memberId === outsider!.id)!));
  clear(); await portfolios.addProject(actor, portfolio.id, project.id); await until(() => hidden.some(e => e.data.resourceId === portfolio.id));
  clear(); await portfolios.updatePortfolio(actor, portfolio.id, { name: "共享项目集改名" }); await until(() => hidden.some(e => e.data.resourceId === portfolio.id));
  clear(); await portfolios.removeProject(actor, portfolio.id, project.id); await until(() => hidden.some(e => e.data.resourceId === portfolio.id));
  clear(); await portfolios.deletePortfolio(actor, portfolio.id); await until(() => hidden.some(e => e.data.resourceId === portfolio.id));
  check("项目集按现有可读语义逐个合法账号定向，五个写入口无广播");
  clear(); const globalDash = (await dashboards.createDashboard(actor, { name: "全局仪表盘" }))!;
  await until(() => hidden.some(e => e.data.resourceId === globalDash.id));
  assert.ok(local.every(event => event.memberId !== null));
  clear(); const widget = (await dashboards.addWidget(actor, globalDash.id, { type: "COUNT" }))!;
  await until(() => hidden.some(e => e.data.resourceId === globalDash.id));
  clear(); await dashboards.updateWidget(actor, widget.id, { sortOrder: 1 }); await until(() => hidden.some(e => e.data.resourceId === globalDash.id));
  clear(); await dashboards.deleteWidget(actor, widget.id); await until(() => hidden.some(e => e.data.resourceId === globalDash.id));
  clear(); await dashboards.updateDashboard(actor, globalDash.id, { name: "全局修改" }); await until(() => hidden.some(e => e.data.resourceId === globalDash.id));
  clear(); await dashboards.deleteDashboard(actor, globalDash.id); await until(() => hidden.some(e => e.data.resourceId === globalDash.id));
  check("全局仪表盘和挂件六个写入口按可读受众定向");
  clear(); const projectDash = (await dashboards.createDashboard(actor, { name: "项目仪表盘", projectId: project.id }))!;
  await until(() => visible.some(e => e.data.resourceId === projectDash.id)); await delay(120);
  assert.equal(hidden.some(e => e.data.resourceId === projectDash.id), false); check("项目仪表盘只抵达当前可见成员");
  clear(); const template = (await templates.createTemplate(actor, { name: "受控项目模板" }))!;
  await ownOnly(template.id);
  const templateEvent = local.find(event => event.data.resourceId === template.id)!;
  assert.ok(await canDeliverEvent(owner!.id, templateEvent));
  assert.equal(await canDeliverEvent(reader!.id, { ...templateEvent, memberId: reader!.id }), false);
  clear(); await templates.updateTemplate(actor, template.id, { name: "模板改名" }); await ownOnly(template.id);
  assert.equal((await templates.getTemplate(actor, template.id)).name, "模板改名");
  clear(); await templates.deleteTemplate(actor, template.id); await ownOnly(template.id);
  assert.equal((await templates.listTemplates(actor)).some(row => row.id === template.id), false);
  const savedOwnerGrant = await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, owner!.id));
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId, owner!.id));
  assert.equal(await canDeliverEvent(owner!.id, templateEvent), false);
  await db.insert(roleAssignment).values(savedOwnerGrant);
  check("项目模板三个写入口只通知ORG建项目受众，撤权后历史事件拒绝");
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId, reader!.id));
  assert.equal(await canDeliverEvent(reader!.id, oldSharedEvent), false);
  clear(); await views.updateSavedView(actor, shared.id, { name: "撤权后共享" }); await until(() => mineHas(shared.id)); await delay(120);
  assert.equal(visible.some(e => e.data.resourceId === shared.id), false); check("撤销项目权限立即停止实时和历史共享视图事件");
  clear(); await assert.rejects(db.transaction(async () => { await todos.createTodo(actor, { title: "不能泄露回滚" }); assert.equal(local.length, 0); throw new Error("rollback fixture"); }), /rollback fixture/u);
  await delay(120); assert.equal(local.length, 0); check("外层事务回滚个人事件不发布");
  const activeTodo = (await todos.createTodo(actor, { title: "账号禁用边界" }))!; await until(() => mineHas(activeTodo.id));
  const ownEvent = local.find(e => e.data.resourceId === activeTodo.id)!;
  await db.update(member).set({ status: "DISABLED" }).where(eq(member.id, owner!.id));
  assert.equal(await canDeliverEvent(owner!.id, ownEvent), false); check("成员停用后已有个人事件不可重放");
  console.log(`工作空间SSE闭环 ${checks}/${checks}`);
} finally {
  for (const stream of streams) stream.abort.abort();
  await Promise.all(streams.map(stream => stream.done));
  unsubscribe(); await app.close(); await sql.end();
}
