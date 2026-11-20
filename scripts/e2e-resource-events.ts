import "./_env.ts";
/** 无协作房间的真实 SSE、当前权限、提交边界；数据仅在隔离测试库。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, pagePermission, collabRoom } from "../src/db/schema.ts";
import { buildApp } from "../src/server/app.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import { recordBusinessEvent } from "../src/server/services/event-log.ts";
import { canDeliverEvent, publish, subscribe, type SseEvent } from "../src/server/services/events.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const app = await buildApp({ logger: false });
const marker = randomUUID().slice(0, 8);
const password = `resource-${marker}-password`;
let checks = 0;
const check = (name: string) => { checks++; console.log(`OK ${name}`); };
const streams: { abort: AbortController; done: Promise<void> }[] = [];
const local: SseEvent[] = [];
const unsubscribe = subscribe(event => local.push(event));
async function connect(username: string, lastEventId?: number) {
  const login = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const abort = new AbortController();
  const response = await fetch(`${process.env.BASE}/api/v1/events`, { headers: { cookie, ...(lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) }) }, signal: abort.signal });
  assert.equal(response.status, 200);
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const reader = response.body!.getReader();
  const done = (async () => {
    let text = "";
    try {
      while (true) {
        const r = await reader.read(); if (r.done) return;
        text += new TextDecoder().decode(r.value);
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
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const people = await db.insert(member).values(await Promise.all(["writer", "reader", "outsider"].map(async name => ({
    username: `sse-${name}-${marker}`, name, status: "ACTIVE", passwordHash: await hashPassword(password),
  })))).returning();
  const [writer, reader, outsider] = people;
  await db.insert(roleAssignment).values({ memberId: writer!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(writer!.id))!;
  const project = await projects.createProject(actor, { key: `S${marker.replaceAll("-", "").toUpperCase()}`, name: "SSE权限隔离" });
  await db.insert(roleAssignment).values({ memberId: reader!.id, roleId: adminRole!.id, scopeType: "PROJECT", scopeId: project.id });
  const [visible, hidden] = await Promise.all([connect(reader!.username), connect(outsider!.username)]);
  const plan = await plans.createPlan(actor, project.id, "iteration", { name: "无需房间的计划", startDate: "2026-11-20", endDate: "2026-11-30" });
  await until(() => visible.some(e => e.data.resourceId === plan.id));
  assert.equal((await db.select().from(collabRoom)).length, 0);
  await delay(120);
  assert.equal(hidden.filter(e => e.event === "resource.invalidated").length, 0);
  assert.deepEqual(Object.keys(visible.find(e => e.data.resourceId === plan.id)!.data).sort(), ["domain", "projectId", "resourceId", "resourceType"]);
  check("普通登录SSE无room收到计划，范围外成员收不到，载荷只有受控定位");

  const restricted = await wiki.createPage(actor, project.id, { title: "不可泄漏的私密标题", visibility: "RESTRICTED" });
  const pageEvent = local.find(e => e.event === "resource.invalidated" && e.data.resourceId === restricted.id)!;
  assert.ok(pageEvent);
  assert.equal(await canDeliverEvent(reader!.id, pageEvent), false);
  assert.equal(await canDeliverEvent(writer!.id, pageEvent), true);
  // 先等待创建事件完成投递判定，再临时授予 ACL；授权有效时收到事件属于正确行为。
  await delay(120);
  assert.equal(visible.some(e => e.data.resourceId === restricted.id), false);
  await db.insert(pagePermission).values({ pageId: restricted.id, principalType: "MEMBER", principalId: reader!.id, canRead: true, canWrite: false });
  assert.equal(await canDeliverEvent(reader!.id, pageEvent), true);
  await db.delete(pagePermission).where(and(eq(pagePermission.pageId, restricted.id), eq(pagePermission.principalId, reader!.id)));
  assert.equal(await canDeliverEvent(reader!.id, pageEvent), false);
  await publish(pageEvent.event, pageEvent.data, pageEvent.memberId, pageEvent.scope);
  await delay(120);
  assert.equal(visible.some(e => e.data.resourceId === restricted.id), false);
  check("受限页实时与历史事件按当前ACL过滤，撤销授权立即失效");

  const count = local.length;
  await assert.rejects(db.transaction(async () => {
    await plans.createPlan(actor, project.id, "iteration", { name: "回滚计划", startDate: "2026-11-20", endDate: "2026-11-30" });
    assert.equal(local.length, count);
    throw new Error("rollback fixture");
  }), /rollback fixture/u);
  assert.equal(local.length, count);
  const noAccount = local.length;
  await recordBusinessEvent({ actor, action: "notification.prefs_updated", targetType: "MEMBER", targetId: writer!.id });
  assert.equal(local.length, noAccount);
  check("外层事务回滚无事件，账号私有业务不进入项目广播");

  const planEvent = local.find(e => e.data.resourceId === plan.id)!;
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId, reader!.id));
  assert.equal(await canDeliverEvent(reader!.id, planEvent), false);
  visible.length = 0;
  await plans.updatePlan(actor, plan.id, "iteration", { name: "撤权后的计划" });
  await delay(220);
  assert.equal(visible.some(e => e.data.resourceId === plan.id), false);
  check("长连接未重连也立即采用撤销后的项目权限，旧事件无法补取");
  const reconnect = await connect(writer!.username, 1);
  await until(() => reconnect.some(e => e.event === "dropped"));
  await publish("notification.new", { unreadCount: 7 }, writer!.id);
  check("无缓存重放窗口返回dropped，客户端可全量回源并重连");
  console.log(`资源事件隔离验收 ${checks}/${checks}`);
} finally {
  for (const stream of streams) stream.abort.abort();
  await Promise.all(streams.map(stream => stream.done));
  unsubscribe();
  await app.close();
  await sql.end();
}
