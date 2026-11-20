/** Real HTTP/session/DB integration. Runs only in disposable feronavi_test_* databases. */
import "./_env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { buildApp } from "../src/server/app.ts";
import { createSession, revokeSession } from "../src/server/auth/session.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { createProject } from "../src/server/services/project.service.ts";
import { createWorkItem } from "../src/server/services/work-item.service.ts";
import { publish } from "../src/server/services/events.service.ts";
import {
  notify,
  listNotifications,
  markRead,
  markAllRead,
} from "../src/server/services/notification.service.ts";
import {
  listOnline,
  resetPresenceForTests,
} from "../src/server/services/presence.service.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { closeRealtimeRedis } from "../src/server/services/realtime-redis.ts";
assert.match(
  new URL(process.env.DATABASE_URL!).pathname,
  /^\/feronavi_test_[a-f0-9]{32}$/,
);
const app = await buildApp({ logger: false });
const streams: {
  controller: AbortController;
  text: string;
  ended: boolean;
  reading: Promise<void>;
}[] = [];
let passed = 0;
const pass = (name: string) => {
  passed++;
  console.log(`PASS ${name}`);
};
async function wait(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(20);
  }
  throw Error("Condition timeout");
}
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  assert.ok(adminRole);
  const [owner, outsider] = await db
    .insert(member)
    .values(
      ["owner", "outsider"].map((name) => ({
        username: `events-${name}-${randomUUID()}`,
        name,
        passwordHash: "not-a-login-password",
        status: "ACTIVE",
      })),
    )
    .returning();
  await db.insert(roleAssignment).values({
    memberId: owner!.id,
    roleId: adminRole.id,
    scopeType: "ORG",
    scopeId: null,
  });
  const actor = (await loadActor(owner!.id))!;
  const outsideActor = (await loadActor(outsider!.id))!;
  const project = await createProject(actor, {
    key: `EV${randomUUID().slice(0, 6).toUpperCase()}`,
    name: "isolated private project",
  });
  const item = (await createWorkItem(actor, project.id, {
    type: "TASK",
    title: "isolated resource",
  }))!;
  const ownerSession = await createSession({ memberId: owner!.id });
  const outsideSession = await createSession({ memberId: outsider!.id });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  async function connect(token: string, lastId?: string) {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/v1/events`, {
      headers: {
        cookie: `feronavi_session=${token}`,
        ...(lastId ? { "Last-Event-ID": lastId } : {}),
      },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const stream = {
      controller,
      text: "",
      ended: false,
      reading: Promise.resolve(),
    };
    streams.push(stream);
    const reader = response.body!.getReader();
    stream.reading = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          stream.text += new TextDecoder().decode(value);
        }
      } catch {
        /* abort */
      } finally {
        stream.ended = true;
        reader.releaseLock();
      }
    })();
    await wait(() => stream.text.includes(":ok"));
    return stream;
  }
  const first = await connect(ownerSession.token);
  const second = await connect(ownerSession.token);
  const outside = await connect(outsideSession.token);
  await wait(async () => (await listOnline()).length === 2);
  pass("真实两个成员三标签在线，同成员不重复计数");
  await publish("workitem.changed", { id: item.id, version: 1 }, null);
  await publish(
    "comment.created",
    { id: randomUUID(), targetType: "WORK_ITEM", targetId: item.id },
    null,
  );
  await wait(() => first.text.includes("comment.created"));
  await delay(100);
  assert.ok(!outside.text.includes(item.id));
  pass("零授权成员收不到私有工作项/评论元数据，拥有者正常收到");
  await notify({
    recipientId: owner!.id,
    actorId: null,
    category: "MENTION",
    type: "isolated.test",
    title: "isolated recipient only",
    body: "database notification",
  });
  await wait(
    () =>
      first.text.includes("notification.new") &&
      second.text.includes("notification.new"),
  );
  assert.ok(!outside.text.includes("notification.new"));
  assert.equal((await listNotifications(actor)).length, 1);
  assert.equal((await listNotifications(outsideActor)).length, 0);
  pass("真实通知DB与定向SSE隔离一致，多标签都收到本人通知");
  const notice = (await listNotifications(actor))[0]!;
  await markRead(actor, notice.id);
  await wait(
    () =>
      first.text.includes("notification.changed") &&
      second.text.includes("notification.changed"),
  );
  assert.ok(!outside.text.includes("notification.changed"));
  pass("单条已读跨标签定向失效，不通知其它成员");
  await notify({
    recipientId: owner!.id,
    actorId: null,
    category: "MENTION",
    type: "aggregate",
    title: "aggregate",
    body: "one",
    groupKey: "isolated-group",
  });
  const beforeAggregate = second.text.length;
  await notify({
    recipientId: owner!.id,
    actorId: null,
    category: "MENTION",
    type: "aggregate",
    title: "aggregate",
    body: "two",
    groupKey: "isolated-group",
  });
  await wait(() =>
    second.text.slice(beforeAggregate).includes("notification.changed"),
  );
  assert.equal(
    (await listNotifications(actor)).find(
      (n) => n.groupKey === "isolated-group",
    )?.itemCount,
    2,
  );
  const beforeReadAll = second.text.length;
  await markAllRead(actor);
  await wait(() =>
    second.text.slice(beforeReadAll).includes("notification.changed"),
  );
  pass("聚合与全部已读均触发跨标签失效，DB聚合数保持正确");
  first.controller.abort();
  await first.reading;
  await delay(100);
  assert.ok((await listOnline()).some((m) => m.memberId === owner!.id));
  pass("关闭一个标签仍保留该成员在线");
  const reconnected = await connect(ownerSession.token, "1");
  await wait(() => reconnected.text.includes("event: dropped"));
  pass("Last-Event-ID重连明确触发全量恢复信号");
  await revokeSession(ownerSession.token);
  await publish(
    "notification.new",
    { id: randomUUID(), title: "revoked secret" },
    owner!.id,
  );
  await wait(() => second.ended && reconnected.ended);
  assert.ok(!second.text.includes("revoked secret"));
  assert.ok(!reconnected.text.includes("revoked secret"));
  const denied = await fetch(`${base}/api/v1/events`, {
    headers: { cookie: `feronavi_session=${ownerSession.token}` },
  });
  assert.equal(denied.status, 403);
  await wait(
    async () => !(await listOnline()).some((m) => m.memberId === owner!.id),
  );
  pass("真实注销后旧流拒绝后续通知且新流403，最后标签回收presence");
  await app.close();
  await wait(() => outside.ended);
  pass("app.close主动完成活跃SSE并回收连接");
  console.log(`SSE隔离验证 ${passed} 项通过`);
} finally {
  for (const s of streams) s.controller.abort();
  await Promise.all(streams.map((s) => s.reading));
  await app.close();
  await resetPresenceForTests();
  await closeRealtimeRedis();
  await closeCache();
  await sql.end();
}
