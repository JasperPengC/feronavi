import "./_env.ts";   // 环境预设必须最先加载
/**
 * 在线状态自检（Round 25 长任务第 48 项，REST 7c `presence`）：
 * 真实 SSE 连接生命周期 → 在线列表；多人上线/下线；事件 payload 正确；最后一个连接关闭才离线。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";

// 隔离：主实例/其它套件共用默认 DB(0) 的 presence 键，会互相污染在线列表（真实踩到 count=1 抖动）。
// 本套件改用独立 DB index（默认 8）；realtime redis 是懒加载，所以在任何调用前设置即可。
if (process.env.REDIS_URL) {
  try {
    const u = new URL(process.env.REDIS_URL);
    u.pathname = "/8";
    process.env.REDIS_URL = u.toString();
  } catch { /* 非 URL 时保持原值 */ }
}
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { resetPresenceForTests } from "../src/server/services/presence.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "presence-admin";
const GUEST = "presence-guest";
const PW = "presence-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
await resetPresenceForTests();
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
const adminId = await mk(ADMIN, "在线管理员", ar!.id);
const guestId = await mk(GUEST, "在线成员", mr!.id);

function sseClient(cookie: string) {
  const ac = new AbortController();
  const events: { event: string; data: Record<string, unknown> }[] = [];
  let readerDone = false;
  const done = (async () => {
    try {
      const res = await fetch(`${BASE}/api/v1/events`, { headers: { cookie, accept: "text/event-stream" }, signal: ac.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (!readerDone) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (block.startsWith(":")) continue;
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const dataLine = /^data: (.+)$/m.exec(block)?.[1];
          if (ev && dataLine) {
            try { events.push({ event: ev, data: JSON.parse(dataLine) as Record<string, unknown> }); } catch { /* 忽略坏事件 */ }
          }
        }
      }
    } catch { /* abort 属预期 */ }
  })();
  return {
    events,
    close: () => { readerDone = true; ac.abort(); },
    wait: async (pred: (e: { event: string; data: Record<string, unknown> }) => boolean, timeoutMs = 5000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(50);
      }
      return null;
    },
    done,
  };
}

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
};
let a: ReturnType<typeof sseClient> | null = null;
let b: ReturnType<typeof sseClient> | null = null;
try {
  const cookieA = await login(ADMIN);
  const cookieB = await login(GUEST);
  a = sseClient(cookieA);
  const onlineSelf = await a.wait((e) => e.event === "presence" && e.data.memberId === adminId && e.data.online === true);
  ok("A 连接后收到自己的 presence online 事件", !!onlineSelf, JSON.stringify(onlineSelf?.data));
  await sleep(300);
  const p1 = await (await fetch(`${BASE}/api/v1/presence`, { headers: { cookie: cookieB } })).json() as { online: { memberId: string }[]; count: number };
  ok("GET /presence 返回 1 人在线（含 A）", p1.count === 1 && p1.online.some((m) => m.memberId === adminId), JSON.stringify(p1));

  b = sseClient(cookieB);
  await b.wait((e) => e.event === "presence" && e.data.memberId === guestId && e.data.online === true);
  await sleep(300);
  const p2 = await (await fetch(`${BASE}/api/v1/presence`, { headers: { cookie: cookieA } })).json() as { online: { memberId: string }[]; count: number };
  ok("两人在线时 count=2 且包含双方", p2.count === 2 && p2.online.some((m) => m.memberId === adminId) && p2.online.some((m) => m.memberId === guestId), JSON.stringify(p2));

  // 同一成员第二个标签页：不应重复广播 online，关闭一个也不该 offline
  const a2 = sseClient(cookieA);
  await sleep(400);
  a.close();
  await sleep(500);
  const p3 = await (await fetch(`${BASE}/api/v1/presence`, { headers: { cookie: cookieB } })).json() as { count: number };
  ok("同成员多连接：关一个仍在线", p3.count === 2, JSON.stringify(p3));
  a2.close();

  const offlineEvt = await b.wait((e) => e.event === "presence" && e.data.memberId === adminId && e.data.online === false, 6000);
  ok("A 全部连接关闭后收到 offline 事件", !!offlineEvt, JSON.stringify(b.events.map((e) => e.data)));
  await sleep(300);
  const p4 = await (await fetch(`${BASE}/api/v1/presence`, { headers: { cookie: cookieB } })).json() as { online: { memberId: string }[]; count: number };
  ok("A 离线后只剩 B", p4.count === 1 && p4.online.every((m) => m.memberId === guestId), JSON.stringify(p4));

  b.close();
  await sleep(700);
  const p5 = await (await fetch(`${BASE}/api/v1/presence`, { headers: { cookie: cookieA } })).json() as { count: number };
  ok("全部关闭后在线数为 0", p5.count === 0, JSON.stringify(p5));
} finally {
  a?.close(); b?.close();
  await app.close();
  await resetPresenceForTests();
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
