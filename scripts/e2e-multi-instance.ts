import "./_env.ts";   // 环境预设必须最先加载
/**
 * 多副本 SSE/Presence 自检（Round 61）
 *
 * 起两个真实 server 进程（同库、同 Valkey，不同端口），验证：
 *   ① presence 注册表跨实例（A 开连接，B 的 GET /presence 也能看到）；
 *   ② SSE 事件经 Valkey Pub/Sub 跨实例（B 上线的 presence 事件被 A 的连接收到）；
 *   ③ 通知跨实例（B 上临时成员发 @demo 评论，A 的 demo 连接收到 notification.new）；
 *   ④ 下线跨实例（B 关闭连接后 A 的在线列表回落）。
 * 由隔离 runner 提供测试数据库；本脚本创建独立缓存与两个动态端口应用。
 */
import { startIsolatedMultiInstance } from "../tests/support/isolated-special.ts";
import { db, sql } from "../src/db/index.ts";
import { auditEntry, activityEntry, comment, member, roleAssignment } from "../src/db/schema.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();
import { eq } from "drizzle-orm";

const instances = await startIsolatedMultiInstance();
const A = instances.a.baseURL;
const B = instances.b.baseURL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const TS = Date.now().toString(36).slice(-6);
const TEMP = `multi-${TS}`;
const PW = "multi-instance-pass-123456";
const NEW_PW = "multi-instance-changed-123456";
const request: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
let tempId = "";
function sseClient(base: string, cookie: string) {
  const ac = new AbortController();
  const events: { event: string; data: Record<string, unknown> }[] = [];
  let failure: Error | undefined;
  let opened = false;
  let heartbeats = 0;
  const done = (async () => {
    try {
      const res = await fetch(`${base}/api/v1/events`, { headers: { cookie, accept: "text/event-stream" }, signal: ac.signal });
      if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
      opened = true;
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done: d } = await reader.read();
        if (d) throw new Error("SSE 意外断开");
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (block.startsWith(":")) { if (block === ":ping") heartbeats++; continue; }
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch (error) { if (!ac.signal.aborted) failure = error as Error; }
  })();
  return {
    events,
    get heartbeats() { return heartbeats; },
    close: () => { ac.abort(); },
    ready: async () => {
      for (let i = 0; i < 120; i++) {
        if (failure) throw failure;
        if (opened) return;
        await sleep(50);
      }
      throw new Error("SSE 连接建立超时");
    },
    wait: async (pred: (e: { event: string; data: Record<string, unknown> }) => boolean, timeoutMs = 6000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (failure) throw failure;
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(50);
      }
      return null;
    },
    done,
  };
}
const login = async (base: string, username: string, password: string) => {
  const res = await request(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return null;
  const { csrfToken } = await res.json() as { csrfToken: string };
  return { cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), csrf: decodeURIComponent(csrfToken) };
};

let sa: ReturnType<typeof sseClient> | null = null;
let sb: ReturnType<typeof sseClient> | null = null;
let duplicate: ReturnType<typeof sseClient> | null = null;
try {
  ok("两个隔离实例都启动", A !== B);

  const demo = await login(A, "demo", "demo-password-12345");
  ok("实例 A demo 登录", !!demo);
  const me = await (await request(`${A}/api/v1/auth/me`, { headers: { cookie: demo!.cookie } })).json() as { memberId: string };
  const H = { cookie: demo!.cookie, "x-csrf-token": demo!.csrf, "content-type": "application/json" };
  const projects = await (await request(`${A}/api/v1/projects`, { headers: { cookie: demo!.cookie } })).json() as { items: { id: string }[] };
  const pid = projects.items[0]!.id;
  const table = await (await request(`${A}/api/v1/projects/${pid}/work-items?view=table&pageSize=5`, { headers: { cookie: demo!.cookie } })).json() as { rows: { id: string }[] };
  const wiId = table.rows[0]!.id;

  // 真实建临时成员（A 上）
  await deleteTestMember(TEMP);
  const created = await request(`${A}/api/v1/members`, {
    method: "POST", headers: H, body: JSON.stringify({ username: TEMP, name: "多副本临时成员", email: `${TEMP}@x.test`, password: PW }),
  });
  tempId = created.ok ? (await created.json() as { id: string }).id : "";
  ok("实例 A 创建临时成员", !!tempId);
  let tempLogin = await login(B, TEMP, PW);
  ok("实例 B 上临时成员登录（同库共享会话）", !!tempLogin);
  const changed = await request(`${B}/api/v1/auth/password/change`, {
    method: "POST", headers: { cookie: tempLogin!.cookie, "x-csrf-token": tempLogin!.csrf, "content-type": "application/json" },
    body: JSON.stringify({ currentPassword: PW, newPassword: NEW_PW }),
  });
  ok("临时成员完成首次改密", changed.ok);
  tempLogin = await login(B, TEMP, NEW_PW);

  // ①/② presence + SSE 跨实例
  sa = sseClient(A, demo!.cookie);
  const demoOnlineOnA = await sa.wait((e) => e.event === "presence" && e.data.memberId === me.memberId && e.data.online === true);
  ok("A 收到自己的 online 事件", !!demoOnlineOnA);
  sb = sseClient(B, tempLogin!.cookie);
  const tempOnlineOnB = await sb.wait((e) => e.event === "presence" && e.data.memberId === tempId && e.data.online === true);
  ok("B 收到自己的 online 事件", !!tempOnlineOnB);

  const seenOnA = await sa.wait((e) => e.event === "presence" && e.data.memberId === tempId && e.data.online === true);
  ok("跨实例 Pub/Sub：A 的 SSE 收到 B 上线的 presence", !!seenOnA, JSON.stringify(sa.events.slice(-3)));

  const listA = await (await request(`${A}/api/v1/presence`, { headers: { cookie: demo!.cookie } })).json() as { count: number; online: { memberId: string }[] };
  const listB = await (await request(`${B}/api/v1/presence`, { headers: { cookie: tempLogin!.cookie } })).json() as { count: number };
  ok("A 的在线列表含两个实例的成员", listA.count === 2 && listA.online.some((m) => m.memberId === tempId), JSON.stringify(listA));
  ok("B 的在线列表同样为 2（共享注册表）", listB.count === 2, JSON.stringify(listB));

  // ③ 通知跨实例：B 上临时成员 @demo 评论 → A 的 SSE 收到 notification.new
  const before = sa.events.length;
  const commentRes = await request(`${B}/api/v1/work-items/${wiId}/comments`, {
    method: "POST", headers: { cookie: tempLogin!.cookie, "x-csrf-token": tempLogin!.csrf, "content-type": "application/json" },
    body: JSON.stringify({ body: `@demo 多副本通知冒烟 ${TS}` }),
  });
  ok("B 上创建 @提及评论 201", commentRes.status === 201, String(commentRes.status));
  const commentBody = commentRes.ok ? await commentRes.json() as { id: string } : null;
  const notify = await sa.wait((e) => e.event === "notification.new" && sa!.events.indexOf(e) >= before, 6000);
  ok("跨实例通知：A 的 SSE 收到 B 触发的 notification.new", !!notify, JSON.stringify(sa.events.filter((e) => e.event === "notification.new").slice(-2)));

  if (process.env.MULTI_INSTANCE_RECOVERY === "1") {
    duplicate = sseClient(B, demo!.cookie);
    await duplicate.ready();
    await instances.cache.suspend();
    const outageStart = Date.now();
    const local = await request(`${B}/api/v1/work-items/${wiId}/comments`, {
      method: "POST", headers: { cookie: tempLogin!.cookie, "x-csrf-token": tempLogin!.csrf, "content-type": "application/json" },
      body: JSON.stringify({ body: `@demo 缓存中断确认写入 ${TS}` }),
    });
    const localBody = await local.json() as { id?: string };
    ok("缓存不可用时评论写入仍确认成功", local.status === 201 && !!localBody.id, `status=${local.status}, elapsedMs=${Date.now() - outageStart}`);
    const localEvent = await sb.wait(e => e.event === "comment.created" && e.data.id === localBody.id);
    ok("缓存不可用时本实例 SSE 仍送达", !!localEvent);
    await instances.cache.resume();
    const heartbeatsA = sa.heartbeats;
    const heartbeatsDuplicate = duplicate.heartbeats;
    const recoveryStart = Date.now();
    let recovered = false;
    for (let i = 0; i < 65; i++) {
      const list = await (await request(`${A}/api/v1/presence`, { headers: { cookie: demo!.cookie } })).json() as { online: { memberId: string; name: string; username: string }[] };
      recovered = sa.heartbeats > heartbeatsA && duplicate.heartbeats > heartbeatsDuplicate
        && list.online?.length === 2 && list.online.every(m => !!m.name && !!m.username);
      if (recovered) break;
      await sleep(500);
    }
    ok("缓存重启后心跳恢复成员及名称（无需重连）", recovered, `elapsedMs=${Date.now() - recoveryStart}`);
    const persisted = await db.select({ id: comment.id }).from(comment).where(eq(comment.id, localBody.id!));
    ok("缓存重启后已确认评论仍在 PostgreSQL", persisted.length === 1);
    const cursor = sa.events.length;
    const recoveredComment = await request(`${B}/api/v1/work-items/${wiId}/comments`, {
      method: "POST", headers: { cookie: tempLogin!.cookie, "x-csrf-token": tempLogin!.csrf, "content-type": "application/json" },
      body: JSON.stringify({ body: `@demo 缓存恢复通知 ${TS}` }),
    });
    ok("缓存恢复后评论写入成功", recoveredComment.status === 201);
    const delivered = await sa.wait(e => e.event === "notification.new" && sa!.events.indexOf(e) >= cursor);
    ok("缓存恢复后跨实例通知重新送达", !!delivered);
    duplicate.close(); await duplicate.done;
    await sleep(300);
    const remaining = await (await request(`${A}/api/v1/presence`, { headers: { cookie: demo!.cookie } })).json() as { online: { memberId: string }[] };
    ok("缓存恢复后关闭同成员另一副本连接仍保持在线", remaining.online.some(m => m.memberId === me.memberId));
  }

  // ④ 下线跨实例
  const closeStart = Date.now();
  sb.close();
  let listAfter = listA;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    listAfter = await (await request(`${A}/api/v1/presence`, { headers: { cookie: demo!.cookie } })).json() as typeof listA;
    if (listAfter.count === 1) break;
  }
  ok("B 关闭连接后 A 的在线列表回落到 1", listAfter.count === 1, `耗时约 ${Date.now() - closeStart}ms，count=${listAfter.count}`);

  // 清理评论
  if (commentBody?.id) {
    await request(`${A}/api/v1/comments/${commentBody.id}`, { method: "DELETE", headers: H }).catch(() => {});
  }
} finally {
  sa?.close(); sb?.close(); duplicate?.close();
  await Promise.all([sa?.done, sb?.done, duplicate?.done]);
  await instances.stop();
  if (tempId) {
    try {
      await db.delete(comment).where(eq(comment.authorId, tempId));
      await db.delete(auditEntry).where(eq(auditEntry.actorId, tempId));
      await db.delete(activityEntry).where(eq(activityEntry.actorId, tempId));
      await db.delete(roleAssignment).where(eq(roleAssignment.memberId, tempId));
      await db.delete(member).where(eq(member.id, tempId));
    } catch { /* 清理失败不改变结论 */ }
  }
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
