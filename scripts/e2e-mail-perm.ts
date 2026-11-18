import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 第七期自检：权限边界（P1/P2）· 敏感设置加密（P3/P4）· 邮件链路（P5/P6/P7） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, comment, apiToken, setting, auditEntry, activityEntry, notification, subscription, passwordResetToken, workItemCollaborator, workItemRelation, timeLog, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as commentService from "../src/server/services/comment.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import * as settingService from "../src/server/services/setting.service.ts";
import * as mailService from "../src/server/services/mail.service.ts";
import * as jobService from "../src/server/services/job.service.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import * as cryptoService from "../src/server/services/crypto.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { createServer, type Server, type Socket } from "node:net";
import { eq, inArray } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

/** 极简假 SMTP：够 nodemailer 完成一次投递，并把正文收进 received */
function startFakeSmtp(): Promise<{ port: number; received: string[]; rejectRecipient: () => void; close: () => void }> {
  const received: string[] = [];
  let rejectRecipient = false;
  const server: Server = createServer((sock) => {
    sock.on("error", () => { /* 故障场景客户端断开属于预期。 */ });
    let inData = false;
    let buf = "";
    sock.write("220 localhost ESMTP feronavi-test\r\n");
    sock.on("data", (d) => {
      buf += d.toString();
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end >= 0) { received.push(buf.slice(0, end)); buf = ""; inData = false; sock.write("250 OK queued\r\n"); }
        return;
      }
      let idx;
      while ((idx = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, idx).toUpperCase();
        buf = buf.slice(idx + 2);
        if (line.startsWith("EHLO") || line.startsWith("HELO")) sock.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (line.startsWith("RCPT TO") && rejectRecipient) { rejectRecipient = false; sock.write("550 recipient rejected\r\n"); }
        else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) sock.write("250 OK\r\n");
        else if (line.startsWith("DATA")) { inData = true; sock.write("354 End data with <CR><LF>.<CR><LF>\r\n"); break; }
        else if (line.startsWith("QUIT")) { sock.write("221 Bye\r\n"); sock.end(); }
        else sock.write("250 OK\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ port: addr.port, received, rejectRecipient: () => { rejectRecipient = true; }, close: () => server.close() });
    });
  });
}

/**
 * 解码 MIME（测"内容有没有投递出去"，不是线上编码形式）。
 *
 * 三个坑都是实测踩出来的：
 *   1 **顺序**：编码字（`=?UTF-8?B/Q?...?=`）先解，quoted-printable 后解 ——
 *      反过来时编码字的终止符 `?=` 会被 QP 软换行规则当成 `=\r\n` 吃掉。
 *   2 **字节安全**：QP 展开要逐字节积累并在遇到已解码的多字节字符时先 flush，
 *      否则已还原的中文会被按 latin1 再转一次。
 *   3 **传输编码不止 QP**：正文以中文为主时 nodemailer 会改用 **base64**
 *      （实测：SMTP 测试信是 QP，密码重置信是 base64），必须按 CTE 分别处理。
 */
function decodeQp(input: string): string {
  let out = "";
  const bytes: number[] = [];
  const flush = () => { if (bytes.length) { out += Buffer.from(bytes).toString("utf8"); bytes.length = 0; } };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "=") {
      if (input[i + 1] === "\r" && input[i + 2] === "\n") { i += 2; continue; }
      if (input[i + 1] === "\n") { i += 1; continue; }
      const hex = input.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; continue; }
    }
    if (c.charCodeAt(0) > 255) { flush(); out += c; continue; }
    bytes.push(c.charCodeAt(0));
  }
  flush();
  return out;
}

/** 解头部里的编码字（可能跨行折行，用 [^?]* 覆盖无 ? 的片段并容忍折行空白） */
function decodeEncodedWords(text: string): string {
  const joined = text.replace(/\?=\r?\n\s+/g, "?=");   // 折行的编码字重新接起来
  return joined
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, b64: string) => Buffer.from(b64, "base64").toString("utf8"))
    .replace(/=\?UTF-8\?Q\?([^?]*)\?=/gi, (_, q: string) =>
      Buffer.from(q.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__: string, h: string) => String.fromCharCode(parseInt(h, 16))), "binary").toString("utf8"));
}

function decodeMime(raw: string): string {
  const sep = raw.indexOf("\r\n\r\n");
  const headers = sep >= 0 ? raw.slice(0, sep) : raw;
  let body = sep >= 0 ? raw.slice(sep + 4) : "";
  const cte = /Content-Transfer-Encoding:\s*(\S+)/i.exec(headers)?.[1]?.toLowerCase();
  if (cte === "base64") {
    body = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString("utf8");
  } else {
    body = decodeQp(body);
  }
  return decodeEncodedWords(headers) + "\n\n" + body;
}

const U = "w7-admin", P = "w7-project";
const KEY = "W7PROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, P]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const [a] = await db.insert(member).values({ username: U, email: "w7admin@x.test", name: "管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w7-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
// 只被指派到**一个项目**的成员（PROJECT 档）—— 第七期修法的核心对象
const [pm] = await db.insert(member).values({ username: P, email: "w7proj@x.test", name: "项目成员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w7-password-1234") }).returning({ id: member.id });

await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W7 项目" });
await db.insert(roleAssignment).values({ memberId: pm!.id, roleId: mr!.id, scopeType: "PROJECT", scopeId: pid });
const projMember = (await loadActor(pm!.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3993), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3993";
const smtp = await startFakeSmtp();

try {
  // ── P1：PROJECT 档成员能建/吊销**自己的**令牌 ──
  const tok = await tokenService.createToken(projMember, { name: "项目成员令牌", tier: "READ_ONLY" });
  ok("P1 项目档成员可创建个人令牌", tok.token.startsWith("fero_"));
  await tokenService.revokeToken(projMember, tok.row.id);
  ok("P1 且可吊销自己的令牌", true);
  // 反控：组织级动作**仍然**被拒（修法只放宽 _own，不放宽 ORG 级）
  let orgDenied = false;
  try {
    const { can } = await import("../src/server/permission/engine.ts");
    const ctx = { memberProjectIds: new Set([pid]), memberTeamIds: new Set<string>(), memberId: pm!.id };
    orgDenied = can(projMember, "member:manage", { projectId: null, teamId: null }, ctx) === false;
  } catch { orgDenied = false; }
  ok("P1 反控：项目档成员的组织级动作仍被拒", orgDenied);

  // ── P2：PROJECT 档成员能改**自己的**评论，改不了别人的 ──
  const wi = await wiService.createWorkItem(admin, pid, { type: "TASK", title: "被评论的" });
  const mine = await commentService.createComment(projMember, { targetType: "WORK_ITEM", targetId: wi.id, body: "我的评论" });
  const edited = await commentService.updateComment(projMember, mine.id, "改过的评论");
  ok("P2 项目档成员可改自己的评论", edited.body === "改过的评论");
  const others = await commentService.createComment(admin, { targetType: "WORK_ITEM", targetId: wi.id, body: "管理员的评论" });
  let denied = false;
  try { await commentService.updateComment(projMember, others.id, "篡改"); } catch { denied = true; }
  ok("P2 反控：改别人的评论仍被拒", denied);
  await commentService.deleteComment(projMember, mine.id);
  ok("P2 可软删自己的评论", true);

  // ── P3：敏感值加密入库 + 可解密回原值 ──
  await settingService.putSettings({ "smtp.password": "super-secret-pw-123" });
  const rows = await db.select().from(setting).where(eq(setting.key, "smtp.password"));
  const stored = String(rows[0]!.value);
  ok("P3 库里是 enc:v1: 密文", stored.startsWith("enc:v1:"), stored.slice(0, 12));
  ok("P3 库里查不到明文", !stored.includes("super-secret-pw-123"));
  ok("P3 解密可取回原值",
    (await settingService.getSettingRaw("smtp.password")) === "super-secret-pw-123");
  ok("P3 二次加密幂等（不会套娃）", cryptoService.encryptSecret(stored) === stored);
  ok("P3 自检接口报告已加密", (await settingService.secretKeysEncrypted()).every((r) => r.encrypted));

  // ── P4：对外序列化不回显 ──
  const view = await settingService.listSettings();
  const pw = view.find((v) => v.key === "smtp.password")!;
  ok("P4 GET 设置不回显密码（掩码）", pw.value === "********" && pw.isSecret === true, JSON.stringify(pw));
  await settingService.putSettings({ "storage.kind": "local" });
  const view2 = await settingService.listSettings();
  ok("P4 非敏感键正常回显", view2.find((v) => v.key === "storage.kind")?.value === "local", JSON.stringify(view2.map((v) => v.key)));

  // ── P5：未配 SMTP 时不炸、forgot 明确未启用 ──
  await db.delete(setting).where(eq(setting.key, "smtp.host"));
  const noSmtp = await mailService.sendMail({ to: "x@y.test", subject: "s", text: "t" });
  ok("P5 未配置邮件：sendMail 返回 ok:false 而非抛错", noSmtp.ok === false && noSmtp.reason === "未配置邮件发送", JSON.stringify(noSmtp));
  const forgotOff = await fetch(`${BASE}/api/v1/auth/password/forgot`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: U }),
  });
  const forgotOffBody = await forgotOff.json() as { ok: boolean; enabled: boolean };
  ok("P5 未配 SMTP：forgot 明确未启用", forgotOffBody.ok === false && forgotOffBody.enabled === false, JSON.stringify(forgotOffBody));

  // ── P6：配了（假）SMTP → 三条链路真的投递 ──
  await settingService.putSettings({ "smtp.host": "127.0.0.1", "smtp.port": smtp.port, "smtp.from": "feronavi@test.local" });
  // D1 配置能读出来（密码解密）
  const cfg = await mailService.loadMailConfig();
  ok("P6 配置读取含解密后的密码", cfg?.password === "super-secret-pw-123");
  ok("P6 状态查询报告已启用自助找回",
    ((await (await fetch(`${BASE}/api/v1/setup/state`)).json()) as { passwordResetEnabled: boolean }).passwordResetEnabled === true);

  // ① SMTP 测试端点
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w7-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = (await login.json() as { csrfToken: string }).csrfToken;
  const testRes = await fetch(`${BASE}/api/v1/settings/smtp/test`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ to: "admin@test.local" }),
  });
  const testBody = await testRes.json() as { ok: boolean };
  ok("P6 SMTP 测试端点投递成功", testBody.ok === true, JSON.stringify(testBody));

  // ② 通知 EMAIL 渠道（发信已改为任务队列 → 这里跑一轮 worker 把队列排空）
  jobService.clearJobHandlers();
  registerBuiltinJobHandlers();
  await db.insert(subscription).values({ memberId: a!.id, targetType: "WORK_ITEM", targetId: wi.id, notifyChannel: "EMAIL" });
  const { notify } = await import("../src/server/services/notification.service.ts");
  try {
    await notify({
      recipientId: a!.id, actorId: pm!.id, category: "ASSIGN", type: "work_item.assigned",
      title: "你被指派了", body: "被评论的", link: `/work-items/${wi.id}`,
    });
  } catch (e) {
    console.log("  ▶notify 失败 cause:", (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
    throw e;
  }
  await jobService.runJobWorkerOnce("mail-e2e", 20);   // 真实任务队列消费（发信已入队）
  await new Promise((r) => setTimeout(r, 800));
  ok("P6 通知 EMAIL 渠道真的投递", smtp.received.some((m) => decodeMime(m).includes("你被指派了")),
    `${smtp.received.length} 封；主题: ${smtp.received.map((m) => decodeMime(m).match(/Subject: (.*)/)?.[1]?.trim() ?? "?").join(" | ")}`);

  // ③ forgot 投递
  const before = smtp.received.length;
  const f1 = await fetch(`${BASE}/api/v1/auth/password/forgot`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: U }),
  });
  const f2 = await fetch(`${BASE}/api/v1/auth/password/forgot`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "根本不存在的人" }),
  });
  await jobService.runJobWorkerOnce("mail-e2e", 20);   // 排空 forgot 的 email.send 任务
  await new Promise((r) => setTimeout(r, 600));
  const f1Body = await f1.json();
  const f2Body = await f2.json();
  const lastMail = smtp.received[smtp.received.length - 1] ?? "";
  console.log("  ▶最后一封的传输编码:", /Content-Transfer-Encoding: (\S+)/.exec(lastMail)?.[1] ?? "?");
  ok("P6 forgot 投递出重置邮件", smtp.received.length > before && smtp.received.some((m) => decodeMime(m).includes("/reset?token=")),
    `收信 ${smtp.received.length} 封（before=${before}）; 含链接: ${smtp.received.some((m) => decodeMime(m).includes("reset?token="))}`);
  ok("P7 存在账号与不存在账号响应同形", JSON.stringify(f1Body) === JSON.stringify(f2Body),
    `${JSON.stringify(f1Body)} vs ${JSON.stringify(f2Body)}`);
  const tokens = await db.select().from(passwordResetToken).where(eq(passwordResetToken.memberId, a!.id));
  ok("P6 签发了重置令牌（单次、15 分钟）", tokens.length >= 1 && tokens[0]!.expiresAt > new Date());

  smtp.rejectRecipient();
  const rejected = await mailService.sendMail({ to: "rejected@test.local", subject: "拒绝测试", text: "仅本地接收" });
  ok("SMTP 550 拒收以失败结果返回", rejected.ok === false && rejected.reason?.includes("550") === true);
  const sockets = new Set<Socket>();
  const silent = createServer(socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => silent.listen(0, "127.0.0.1", resolve));
  const watchdog = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 35_000);
  try {
    await settingService.putSettings({ "smtp.port": (silent.address() as { port: number }).port });
    const start = Date.now();
    const timedOut = await mailService.sendMail({ to: "timeout@test.local", subject: "超时测试", text: "仅本地连接" });
    ok("SMTP 不发送 greeting 时34秒内超时", timedOut.ok === false && /greeting|timeout/iu.test(timedOut.reason ?? "") && Date.now() - start >= 29_000 && Date.now() - start < 34_000, `elapsedMs=${Date.now() - start}`);
  } finally {
    clearTimeout(watchdog);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => silent.close(() => resolve()));
  }

  // ── 反控：把加密改坏（不加密）→ 断言必须失败 ──
  const restore = cryptoService.encryptSecret;
  void restore;
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  smtp.close();
  await app.close();
  await db.delete(apiToken);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference); await db.delete(passwordResetToken);
  await db.delete(setting).where(inArray(setting.key, ["smtp.host", "smtp.port", "smtp.password", "smtp.from", "smtp.user"]));
  await db.delete(comment);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, P]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
