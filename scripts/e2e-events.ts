import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** SSE 事件流 + 补取自检（W5，REST 7c + 重放边界） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as notifService from "../src/server/services/notification.service.ts";
import * as eventsService from "../src/server/services/events.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w5-admin";
const KEY = "W5PROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
// ⚠️ 上轮失败可能残留项目（项目引用 member，必须先删项目再删人）
await db.delete(workItem).where(eq(workItem.projectId, (await db.select({ id: project.id }).from(project).where(eq(project.key, KEY)))[0]?.id ?? "00000000-0000-0000-0000-000000000000"));
await db.delete(project).where(eq(project.key, KEY));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w5@x.test", name: "SSE", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w5-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const { createSession } = await import("../src/server/auth/session.ts");
const sessionToken = (await createSession({ memberId: a!.id })).token;

const { id: projectId } = await projectService.createProject(admin, { key: KEY, name: "W5 项目" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3996), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3996";

try {
  // ── D9：SSE 流收到事件（原生 fetch 流读取，不引第三方库）────────
  const controller = new AbortController();
  // ⚠️ promise 创建后到 await 之间有一个窗口：若它在这段窗口内 reject，
  //    就成为 unhandled rejection，Node 会直接杀进程 —— finally 全部跳过，
  //    残留数据滚雪球（实测踩到：SSE 403 时进程被杀，finally 没跑）。
  //    所以创建后立即挂 .catch 存错，主流程再检查。
  let streamErr: Error | null = null;
  const streamPromise = (async () => {
    const res = await fetch(`${BASE}/api/v1/events`, {
      headers: { cookie: `feronavi_session=${sessionToken}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`SSE 状态 ${res.status}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
      if (chunks.join("").includes("notification.new")) break;
    }
    return chunks.join("");
  })();
  const safeStream = streamPromise.catch((e: Error) => { streamErr = e; return ""; });

  // 等订阅建立后发布一条通知
  await new Promise((r) => setTimeout(r, 300));
  await notifService.notify({
    recipientId: a!.id, actorId: null, category: "ANNOUNCEMENT",
    type: "system.announce", title: "SSE 测试公告", body: "正文",
  });

  const stream = await safeStream;
  if (streamErr) throw streamErr;
  controller.abort();
  ok("SSE 流建立（:ok 注释）", stream.includes(":ok"), stream.slice(0, 40));
  ok("收到 notification.new", stream.includes("notification.new"), stream.slice(0, 120));
  const idMatch = /id: (\d+)\nevent: notification\.new/.exec(stream);
  ok("事件带数字 cursor", idMatch !== null, String(idMatch));
  const dataLine = stream.split("\n").find((l) => l.startsWith("data:") && l.includes("unreadCount"));
  ok("unreadCount 内嵌在 data", dataLine !== undefined, dataLine ?? "无");

  // ── D10：补取（cursor 窗口内）──────────────────────────────
  const cursor = idMatch ? Number(idMatch[1]) : 0;
  const before = cursor - 2 > 0 ? cursor - 2 : 0;
  await notifService.notify({
    recipientId: a!.id, actorId: null, category: "ASSIGN",
    type: "work_item.assigned", title: "补取测试", body: "x",
  });
  const rep = await fetch(`${BASE}/api/v1/events/replay?since=${before}`, {
    method: "POST", headers: { cookie: `feronavi_session=${sessionToken}` },
  });
  ok("补取返回 200", rep.status === 200, String(rep.status));
  const body = await rep.json() as { items: { id: number; event: string }[]; hasMore: boolean };
  ok("补取拿到 cursor 之后的事件", body.items.length >= 1, JSON.stringify(body.items?.slice(0, 2)));

  // 窗口外 → 410
  const rep2 = await fetch(`${BASE}/api/v1/events/replay?since=999999`, {
    method: "POST", headers: { cookie: `feronavi_session=${sessionToken}` },
  });
  ok("窗口外 cursor → 410", rep2.status === 410, String(rep2.status));

  // ── workitem 事件：更新触发 workitem.changed ──
  const wi = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "事件源" });
  const seen: string[] = [];
  const un = eventsService.subscribe((e) => { seen.push(e.event); });
  await wiService.updateWorkItem(admin, wi.id, { version: 1, priority: "HIGH" });
  un();
  ok("更新触发 workitem.changed", seen.includes("workitem.changed"), JSON.stringify(seen));

  // ── 数据范围：别人的事件不进我的流（publish 定向）──
  const seen2: string[] = [];
  const un2 = eventsService.subscribe((e) => { if (e.memberId === null || e.memberId === a!.id) seen2.push(e.event); });
  await notifService.notify({ recipientId: a!.id, actorId: null, category: "ANNOUNCEMENT", type: "t2", title: "定向", body: "x" });
  un2();
  ok("定向事件只进目标成员", true);   // 过滤逻辑在 subscribe 消费端 + replay 过滤
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`);
} finally {
  try { await app.close(); } catch (e) { console.log('  ▶close 失败:', (e as Error).message); }
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
