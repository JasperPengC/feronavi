import "./_env.ts";
/** 自动化规则 + SLA 验收：创建规则/策略/工作项，验证自动指派与 SLA 生成，最后清理。 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const USER = process.env.A11Y_USERNAME ?? "freshadmin";
const PASS = process.env.A11Y_PASSWORD ?? "demo-password-12345";
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
let createdAt = {};
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(300);
  await page.evaluate(async ({ user, pass }) => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password: pass }) }); }, { user: USER, pass: PASS });
  const result = await page.evaluate(async () => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const H = { "content-type": "application/json", "x-csrf-token": csrf };
    const projects = await fetch("/api/v1/projects", { credentials: "same-origin" }).then((r) => r.json());
    const pid = projects.items[0].id;
    const members = await fetch("/api/v1/members", { credentials: "same-origin" }).then((r) => r.json());
    const member = members.members[0];
    const tag = Date.now();
    const rule = await fetch(`/api/v1/projects/${pid}/automation-rules`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ name: `accept auto ${tag}`, trigger: "WORK_ITEM_CREATED", conditions: { all: [{ field: "priority", op: "eq", value: "URGENT" }] }, actions: [{ type: "ASSIGN", memberId: member.id }, { type: "ADD_COMMENT", body: "自动化验收：多动作" }], enabled: true }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const policy = await fetch(`/api/v1/projects/${pid}/sla-policies`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ name: `accept sla ${tag}`, priority: "URGENT", responseMinutes: 60, resolveMinutes: 60, escalateRoles: ["ADMIN"], enabled: true }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const wi = await fetch(`/api/v1/projects/${pid}/work-items`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ type: "TASK", title: `accept auto/sla ${tag}`, priority: "URGENT" }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    await new Promise((r) => setTimeout(r, 800));
    const after = await fetch(`/api/v1/work-items/${wi.body.id}`, { credentials: "same-origin" }).then((r) => r.json());
    const sla = await fetch(`/api/v1/work-items/${wi.body.id}/sla`, { credentials: "same-origin" }).then((r) => r.json());
    const runs = await fetch(`/api/v1/projects/${pid}/automation-runs?workItemId=${wi.body.id}`, { credentials: "same-origin" }).then((r) => r.json());
    const paused = await fetch(`/api/v1/work-items/${wi.body.id}/sla/pause`, { method: "POST", credentials: "same-origin", headers: H, body: "{}" }).then(async (r) => ({ status: r.status, body: await r.json() }));
    await new Promise((r) => setTimeout(r, 1100));
    const resumed = await fetch(`/api/v1/work-items/${wi.body.id}/sla/resume`, { method: "POST", credentials: "same-origin", headers: H, body: "{}" }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return { pid, memberId: member.id, rule, policy, wi, after, sla, runs, paused, resumed, csrf };
  });
  createdAt = { pid: result.pid, ruleId: result.rule.body?.id, policyId: result.policy.body?.id, wiId: result.wi.body?.id, csrf: result.csrf };
  check("创建自动化规则", result.rule.status === 201, String(result.rule.status));
  check("创建 SLA 策略", result.policy.status === 201, String(result.policy.status));
  check("创建 URGENT 工作项", result.wi.status === 201, String(result.wi.status));
  check("自动指派生效", result.after.assigneeId === result.memberId, `${result.after.assigneeId ?? "null"}`);
  check("自动化执行记录", (result.runs.runs?.length ?? 0) >= 1, String(result.runs.runs?.length ?? 0));
  check("多动作一次执行", (result.runs.runs?.[0]?.run?.actions?.length ?? 0) >= 2, String(result.runs.runs?.[0]?.run?.actions?.length ?? 0));
  check("SLA 自动生成", result.sla.sla?.state === "ACTIVE" && result.sla.sla?.policy?.name?.startsWith("accept sla"), JSON.stringify(result.sla.sla?.state));
  check("SLA 可暂停", result.paused.status === 200 && !!result.paused.body?.sla?.pausedAt, JSON.stringify(result.paused.status));
  check("SLA 恢复后顺延", result.resumed.status === 200 && !result.resumed.body?.sla?.pausedAt && result.resumed.body?.sla?.pausedMs >= 1000, String(result.resumed.body?.sla?.pausedMs));
} catch (e) { console.error("  ❌", e); checks.push(false); }
finally {
  try {
    // 直接按本次生成的 id 清理，避免 API 权限/软删导致测试数据残留
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      try {
        if (createdAt.wiId) {
          await sql`delete from automation_run where work_item_id = ${createdAt.wiId}`;
          await sql`delete from work_item_sla where work_item_id = ${createdAt.wiId}`;
          await sql`delete from work_item where id = ${createdAt.wiId}`;
        }
        if (createdAt.ruleId) await sql`delete from automation_rule where id = ${createdAt.ruleId}`;
        if (createdAt.policyId) await sql`delete from sla_policy where id = ${createdAt.policyId}`;
        if (createdAt.ruleId) await sql`delete from automation_run where rule_id = ${createdAt.ruleId}`;
      } finally { await sql.end(); }
    }
  } catch { /* ignore cleanup */ }
  await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  自动化/SLA 验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
