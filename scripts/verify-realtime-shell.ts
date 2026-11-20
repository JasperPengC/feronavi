import "./_env.ts";
/** 临时隔离库：50名成员、250条真实SSE；可保留本轮夹具供CUA检查。 */
import assert from "node:assert/strict";
import { writeFile, access, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "../src/db/index.ts";
import { createSession } from "../src/server/auth/session.ts";
import { closeCache } from "../src/server/auth/cache.ts";

const base = process.env.BASE!;
assert.equal(new URL(base).hostname, "127.0.0.1");
assert.notEqual(new URL(base).port, "51476");
assert.match(process.env.FERONAVI_TEST_DATABASE ?? "", /^feronavi_test_/);
const directory = ".cache/realtime-shell-20261116";
await mkdir(directory, { recursive: true });
const clients: { memberId: string; cookie: string; csrf: string }[] = [];
const streams: {
  index: number;
  memberId: string;
  ac: AbortController;
  events: { event: string; data: Record<string, unknown> }[];
  done: Promise<void>;
}[] = [];
const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
const check = (name: string, passed: boolean, detail?: unknown) => {
  checks.push({ name, passed, detail });
  assert.ok(passed, name);
  console.log(`PASS ${name}`);
};
let failure: unknown;
try {
  const login = await fetch(base + "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
  });
  assert.equal(login.status, 200);
  const auth = (await login.json()) as { csrfToken: string };
  const demoCookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const [demo] = await sql`select id,password_hash from member where username='demo'`;
  clients.push({
    memberId: demo!.id as string,
    cookie: demoCookie,
    csrf: auth.csrfToken,
  });
  const [role] = await sql`select id from role where key='MEMBER'`;
  for (let i = 1; i < 50; i++) {
    const username = `rt-shell-${String(i).padStart(2, "0")}`;
    const name =
      i === 1
        ? "😀超长在线成员名称用于验证界面不会被姓名撑开"
        : i === 2
          ? "李明"
          : i === 3
            ? "Alexandra Montgomery"
            : `在线验收成员${i}`;
    const [row] =
      await sql`insert into member(username,email,name,status,timezone,password_hash) values(${username},${username + "@test.invalid"},${name},'ACTIVE','Asia/Shanghai',${demo!.password_hash}) returning id`;
    if (i < 49)
      await sql`insert into role_assignment(member_id,role_id,scope_type,scope_id) values(${row!.id},${role!.id},'ORG',null)`;
    const session = await createSession({ memberId: row!.id as string });
    clients.push({
      memberId: row!.id as string,
      cookie: `feronavi_session=${session.token}`,
      csrf: "",
    });
  }
  async function open(index: number) {
    const client = clients[index % clients.length]!,
      ac = new AbortController(),
      events: { event: string; data: Record<string, unknown> }[] = [];
    const response = await fetch(base + "/api/v1/events", {
      headers: { cookie: client.cookie },
      signal: ac.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    const done = (async () => {
      let buffer = "";
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          buffer += decoder.decode(r.value, { stream: true });
          let n;
          while ((n = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, n);
            buffer = buffer.slice(n + 2);
            const type = /^event: (.+)$/m.exec(frame)?.[1],
              data = /^data: (.+)$/m.exec(frame)?.[1];
            if (type && data)
              events.push({ event: type, data: JSON.parse(data) });
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) throw e;
      }
    })();
    void done.catch(() => {});
    streams.push({ index, memberId: client.memberId, ac, events, done });
  }
  for (let i = 0; i < 250; i += 10)
    await Promise.all(Array.from({ length: 10 }, (_, j) => open(i + j)));
  check("50名不同成员建立250条真实SSE", streams.length === 250);
  const getPresence = async () => {
    const r = await fetch(base + "/api/v1/presence", {
      headers: { cookie: demoCookie },
    });
    assert.equal(r.status, 200);
    return (await r.json()) as {
      count: number;
      online: { memberId: string }[];
    };
  };
  let presence = await getPresence();
  check(
    "在线人数按成员去重为50（不是250标签）",
    presence.count === 50 &&
      new Set(presence.online.map((m) => m.memberId)).size === 50,
    { count: presence.count },
  );
  const one = streams.find((s) => s.index === 1)!;
  one.ac.abort();
  await one.done;
  await delay(150);
  presence = await getPresence();
  check(
    "同成员关闭一个标签仍在线",
    presence.online.some((m) => m.memberId === one.memberId),
  );
  const own = clients[0]!;
  const tableResponse = await fetch(
    base +
      `/api/v1/projects/${process.env.PROJECT_ID}/work-items?view=table&pageSize=5`,
    { headers: { cookie: demoCookie } },
  );
  const table = (await tableResponse.json()) as { rows: { id: string }[] };
  const itemId = table.rows[0]!.id;
  // demo提及另一名成员，五条该成员连接中的一条已关闭，仍有四条应收定向通知。
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const body = `@rt-shell-01 多成员SSE定向验收 ${i}`;
    const before = Date.now();
    const r = await fetch(base + `/api/v1/work-items/${itemId}/comments`, {
      method: "POST",
      headers: {
        cookie: own.cookie,
        "content-type": "application/json",
        "x-csrf-token": own.csrf,
      },
      body: JSON.stringify({ body }),
    });
    assert.equal(r.status, 201);
    await r.arrayBuffer();
    const [notice] =
      await sql`select id from notification where recipient_id=${one.memberId} and body=${body} order by created_at desc limit 1`;
    assert.ok(notice);
    const targets = streams.filter(
      (s) => s.memberId === one.memberId && !s.ac.signal.aborted,
    );
    const deadline = Date.now() + 10000;
    while (
      Date.now() < deadline &&
      !targets.every((s) =>
        s.events.some(
          (e) => e.event === "notification.new" && e.data.id === notice!.id,
        ),
      )
    )
      await delay(10);
    check(
      `第${i + 1}条通知送达目标全部4个标签`,
      targets.length === 4 &&
        targets.every((s) =>
          s.events.some(
            (e) => e.event === "notification.new" && e.data.id === notice!.id,
          ),
        ),
    );
    check(
      `第${i + 1}条通知未泄露给其他49名成员`,
      streams
        .filter((s) => s.memberId !== one.memberId)
        .every(
          (s) =>
            !s.events.some(
              (e) => e.event === "notification.new" && e.data.id === notice!.id,
            ),
        ),
    );
    samples.push(Date.now() - before);
  }
  const unauthorized = streams.filter(
    (s) => s.memberId === clients[49]!.memberId,
  );
  check(
    "无项目授权成员未收到私有工作项评论元数据",
    unauthorized.every(
      (s) =>
        !s.events.some(
          (e) => e.event === "comment.created" && e.data.targetId === itemId,
        ),
    ),
  );
  await writeFile(
    directory + "/multiuser-live.json",
    JSON.stringify(
      { base, members: 50, connections: 250, checks, notificationMs: samples },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      base,
      members: 50,
      connections: 250,
      notificationMs: samples,
      readyForUI: process.env.REALTIME_UI_HOLD === "1",
    }),
  );
  if (process.env.REALTIME_UI_HOLD === "1") {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      try {
        await access(directory + "/stop-multiuser");
        break;
      } catch {
        /* 夹具仍供UI验收使用。 */
      }
      await delay(500);
    }
  }
} catch (e) {
  failure = e;
  console.error(e instanceof Error ? e.message : String(e));
} finally {
  for (const s of streams) s.ac.abort();
  await Promise.allSettled(streams.map((s) => s.done));
  await closeCache();
  await sql.end();
}
if (failure) process.exitCode = 1;
