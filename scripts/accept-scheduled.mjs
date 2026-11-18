import "./_env.ts";
/** 定时触发验收：创建 SCHEDULE 规则 → 执行扫描 → 生成 SCHEDULE 运行记录 → 清理。 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const USER = process.env.A11Y_USERNAME ?? "freshadmin";
const PASS = process.env.A11Y_PASSWORD ?? "demo-password-12345";
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
let cleanup = {};
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(300);
  await page.evaluate(async ({ u, p }) => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }); }, { u: USER, p: PASS });
  const made = await page.evaluate(async () => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const H = { "content-type": "application/json", "x-csrf-token": csrf };
    const projects = await fetch("/api/v1/projects", { credentials: "same-origin" }).then((r) => r.json());
    const pid = projects.items[0].id;
    const tag = Date.now();
    const title = `accept schedule ${tag}`;
    const wi = await fetch(`/api/v1/projects/${pid}/work-items`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ type: "TASK", title }) }).then((r) => r.json());
    const rule = await fetch(`/api/v1/projects/${pid}/automation-rules`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({
      name: `accept schedule rule ${tag}`, trigger: "SCHEDULE", scheduleCron: "* * * * *", scheduleTimezone: "Asia/Shanghai",
      conditions: { all: [{ field: "title", op: "eq", value: title }] },
      actions: [{ type: "ADD_COMMENT", body: "定时触发验收" }], enabled: true,
    }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return { pid, wi, rule, title };
  });
  cleanup = { wiId: made.wi.id, ruleId: made.rule.body?.id };
  check("创建定时规则", made.rule.status === 201, String(made.rule.status));
  const { runScheduledAutomations } = await import("../src/server/services/automation.service.ts");
  const result = await runScheduledAutomations(new Date());
  check("扫描执行定时规则", result.rules >= 1, JSON.stringify(result));
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const runs = await sql`select trigger,status from automation_run where rule_id = ${cleanup.ruleId}`;
  await sql.end();
  check("生成 SCHEDULE 运行记录", runs.some((r) => r.trigger === "SCHEDULE"), String(runs.length));
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
finally {
  try {
    if (process.env.DATABASE_URL && cleanup.ruleId) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql`delete from automation_run where rule_id = ${cleanup.ruleId}`;
      await sql`delete from automation_rule where id = ${cleanup.ruleId}`;
      if (cleanup.wiId) { await sql`delete from work_item_sla where work_item_id = ${cleanup.wiId}`; await sql`delete from work_item where id = ${cleanup.wiId}`; }
      await sql.end();
    }
  } catch { /* ignore */ }
  await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  定时触发验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
