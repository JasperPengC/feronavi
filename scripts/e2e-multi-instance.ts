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
import * as Y from "yjs";
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
let collabPageId: string | undefined;
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

  const pageRes = await request(`${A}/api/v1/projects/${pid}/pages`, {
    method: "POST", headers: H, body: JSON.stringify({ title: `多实例协作验收 ${TS}`, content: "base" }),
  });
  const collabPage = pageRes.ok ? await pageRes.json() as { id: string } : null;
  collabPageId = collabPage?.id ?? "";
  ok("为多实例 CRDT 验收创建临时页面", pageRes.status === 201 && !!collabPageId, String(pageRes.status));

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
  const demoOnB = await login(B, "demo", "demo-password-12345");

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

  // ④ CRDT update 在 B 写入，经共享 PostgreSQL/Valkey 到达 A，并可在 A 读取最终状态。
  const collabBase = `/api/v1/collaboration/rooms/PAGE/${collabPageId ?? ""}`;
  const clientA = `multi-a-${TS}`;
  const clientB = `multi-b-${TS}`;
  const joinA = await request(`${A}${collabBase}/join`, { method: "POST", headers: H, body: JSON.stringify({ clientId: clientA }) });
  const joinB = await request(`${B}/api/v1/collaboration/rooms/PAGE/${collabPageId ?? ""}/join`, {
    method: "POST", headers: { cookie: demoOnB!.cookie, "x-csrf-token": demoOnB!.csrf, "content-type": "application/json" },
    body: JSON.stringify({ clientId: clientB }),
  });
  const joinedRoom = joinA.ok ? await joinA.json() as { room: { id: string } } : null;
  const roomId = joinedRoom?.room.id;
  ok("A、B 两个实例加入同一页面协作房间", joinA.ok && joinB.ok && !!roomId, `A=${joinA.status}, B=${joinB.status}`);
  const initialState = await (await request(`${B}${collabBase}/state`, { headers: { cookie: tempLogin!.cookie } })).json() as { stateBase64: string };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(initialState.stateBase64, "base64")));
  const text = doc.getText("content");
  text.insert(text.length, `CRDT-${TS}`);
  const updateBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  const updateStart = sa.events.length;
  const updateRes = await request(`${B}/api/v1/collaboration/rooms/PAGE/${collabPageId ?? ""}/updates`, {
    method: "POST", headers: { cookie: demoOnB!.cookie, "x-csrf-token": demoOnB!.csrf, "content-type": "application/json" },
    body: JSON.stringify({ clientId: clientB, operationId: `op-${TS}`, updateBase64 }),
  });
  ok("B 实例提交页面 CRDT update", updateRes.status === 200, String(updateRes.status));
  const collabEvent = roomId ? await sa.wait((e) => e.event === "collab.update" && e.data.roomId === roomId && sa!.events.indexOf(e) >= updateStart) : null;
  ok("跨实例 Pub/Sub：A 的 SSE 收到 collab.update", !!collabEvent, JSON.stringify(collabEvent?.data));
  const stateRes = await request(`${A}${collabBase}/state`, { headers: { cookie: demo!.cookie } });
  const state = stateRes.ok ? await stateRes.json() as { sequence: number; stateBase64: string } : null;
  const restored = new Y.Doc();
  if (state?.stateBase64) Y.applyUpdate(restored, Uint8Array.from(Buffer.from(state.stateBase64, "base64")));
  ok("A 实例读取到 B 写入的 CRDT 正文与递增序号", stateRes.ok && state!.sequence === 1 && restored.getText("content").toString() === `baseCRDT-${TS}`,
    `status=${stateRes.status}, seq=${state?.sequence}, content=${restored.getText("content").toString()}`);
  doc.destroy(); restored.destroy();

  // 附件上传/删除事件定向发给页面协作成员。
  const uploadForm = new FormData();
  uploadForm.append("targetType", "PAGE");
  uploadForm.append("targetId", collabPageId ?? "");
  uploadForm.append("file", new Blob([`attachment-${TS}`], { type: "text/plain" }), `collab-${TS}.txt`);
  const uploadStart = sa.events.length;
  const uploaded = await request(`${B}/api/v1/uploads`, { method: "POST", headers: { cookie: demo!.cookie, "x-csrf-token": demo!.csrf }, body: uploadForm });
  const attachmentRow = uploaded.ok ? await uploaded.json() as { id: string } : null;
  const uploadEvent = await sa.wait((e) => e.event === "attachment.uploaded" && e.data.attachmentId === attachmentRow?.id && sa!.events.indexOf(e) >= uploadStart);
  ok("页面附件上传成功并向协作者发事件", uploaded.status === 201 && !!attachmentRow && !!uploadEvent, `status=${uploaded.status}`);
  const deleteStart = sa.events.length;
  const deletedAttachment = attachmentRow ? await request(`${B}/api/v1/attachments/${attachmentRow.id}`, {
    method: "DELETE", headers: { cookie: demo!.cookie, "x-csrf-token": demo!.csrf },
  }) : null;
  const deleteEvent = await sa.wait((e) => e.event === "attachment.deleted" && e.data.attachmentId === attachmentRow?.id && sa!.events.indexOf(e) >= deleteStart);
  ok("页面附件删除成功并向协作者发事件", deletedAttachment?.ok === true && !!deleteEvent, `status=${deletedAttachment?.status}`);

  // 导入确认与整批回滚发项目级事件，不按工作项逐条广播。
  const importForm = new FormData();
  importForm.append("file", new Blob([`external_id,title\nimport-${TS},协作导入验收-${TS}\n`], { type: "text/csv" }), `import-${TS}.csv`);
  const importCreated = await request(`${B}/api/v1/projects/${pid}/imports`, {
    method: "POST", headers: { cookie: demo!.cookie, "x-csrf-token": demo!.csrf }, body: importForm,
  });
  const batch = importCreated.ok ? await importCreated.json() as { batchId: string } : null;
  let importReady = !!batch;
  if (batch) {
    const mapping = await request(`${B}/api/v1/imports/${batch.batchId}/mapping`, {
      method: "PUT", headers: { ...H, cookie: demo!.cookie },
      body: JSON.stringify({ fieldMap: { title: "title" }, externalIdColumn: "external_id" }),
    });
    const mappingBody = mapping.ok ? null : await mapping.text();
    const dryRun = mapping.ok ? await request(`${B}/api/v1/imports/${batch.batchId}/dry-run`, { method: "POST", headers: H, body: "{}" }) : null;
    if (!mapping.ok) console.log(`  导入映射失败: ${mapping.status} ${mappingBody}`);
    if (dryRun && !dryRun.ok) console.log(`  导入试运行失败: ${dryRun.status} ${await dryRun.text()}`);
    importReady = mapping.ok && dryRun?.ok === true;
  }
  const importStart = sa.events.length;
  const confirmed = batch && importReady ? await request(`${B}/api/v1/imports/${batch.batchId}/confirm`, { method: "POST", headers: H, body: "{}" }) : null;
  const confirmEvent = await sa.wait((e) => e.event === "import.completed" && e.data.batchId === batch?.batchId && sa!.events.indexOf(e) >= importStart);
  ok("CSV 导入确认成功并向项目协作者广播统计", importCreated.status === 201 && importReady && confirmed?.ok === true && !!confirmEvent,
    `create=${importCreated.status}, confirmed=${confirmed?.status}`);
  const rollbackStart = sa.events.length;
  const rolledBack = batch && confirmed?.ok ? await request(`${B}/api/v1/imports/${batch.batchId}/rollback`, { method: "POST", headers: H, body: "{}" }) : null;
  const rollbackEvent = await sa.wait((e) => e.event === "import.rolled_back" && e.data.batchId === batch?.batchId && sa!.events.indexOf(e) >= rollbackStart);
  ok("导入整批回滚成功并向项目协作者广播", rolledBack?.ok === true && !!rollbackEvent, `status=${rolledBack?.status}`);

  if (process.env.MULTI_INSTANCE_RECOVERY === "1") {
    duplicate = sseClient(B, demo!.cookie);
    await duplicate.ready();
    const beforeRecovery = sa.events.filter(e => e.event === "dropped").length;
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
    const recoverySignal = await sa.wait(e => e.event === "dropped");
    ok("缓存断线重订阅后SSE通知客户端全量刷新缺口", !!recoverySignal && sa.events.filter(e => e.event === "dropped").length > beforeRecovery);
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

  // ⑤ 下线跨实例
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
  if (collabPageId) {
    await request(`${A}/api/v1/pages/${collabPageId}`, { method: "DELETE", headers: H }).catch(() => {});
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
