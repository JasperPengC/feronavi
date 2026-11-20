import "./_env.ts";
/** SMTP 实投验收：本地 smtp-server 收信 → 通过设置 API 配置 → /settings/smtp/test → 校验邮件。 */
import { chromium } from "playwright";
import { SMTPServer } from "smtp-server";
import postgres from "postgres";
const BASE = process.env.BASE;
const USER = process.env.A11Y_USERNAME ?? "freshadmin";
const PASS = process.env.A11Y_PASSWORD ?? "demo-password-12345";
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
const messages = [];
const DB = process.env.DATABASE_URL;
if (!DB) { console.error("缺少 DATABASE_URL（用于清理测试 SMTP 配置）"); process.exit(1); }
const db = postgres(DB, { max: 1 });
const pre = await db`select key from setting where key like 'smtp.%'`;
if (pre.length > 0) { console.error("SMTP 已配置，拒绝覆盖；请先在空配置实例运行该验收"); process.exit(1); }
const smtp = new SMTPServer({
  // 本地收件fixture明确使用无认证明文；生产认证通道必须校验 TLS 证书。
  disabledCommands: ["AUTH", "STARTTLS"],
  onData(stream, _session, callback) {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => { messages.push(Buffer.concat(chunks).toString("utf8")); callback(null, "OK"); });
  },
});
await new Promise((resolve, reject) => { smtp.on("error", reject); smtp.listen(0, "127.0.0.1", resolve); });
const port = smtp.server.address().port;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(300);
  await page.evaluate(async ({ u, p }) => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }); }, { u: USER, p: PASS });
  const result = await page.evaluate(async (smtpPort) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const H = { "content-type": "application/json", "x-csrf-token": csrf };
    const put = await fetch("/api/v1/settings", { method: "PUT", credentials: "same-origin", headers: H, body: JSON.stringify({ "smtp.host": "127.0.0.1", "smtp.port": smtpPort, "smtp.from": "feronavi@test.local" }) });
    const test = await fetch("/api/v1/settings/smtp/test", { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ to: "accept@example.com" }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return { put: put.status, test };
  }, port);
  check("写入 SMTP 配置", result.put === 200);
  check("SMTP 自检返回 ok", result.test.status === 200 && result.test.body?.ok === true, JSON.stringify(result.test.body));
  await new Promise((r) => setTimeout(r, 500));
  check("本地 SMTP 实际收到邮件", messages.length === 1, String(messages.length));
  check("邮件包含测试主题/收件人", messages[0]?.includes("accept@example.com") && /Subject:|测试/.test(messages[0] ?? ""));
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
finally {
  try { await db`delete from setting where key like 'smtp.%'`; } catch { /* ignore */ }
  await db.end();
  await browser.close();
  await new Promise((resolve) => smtp.close(resolve));
}
const ok = checks.filter(Boolean).length;
console.log(`\n  SMTP 实投验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
