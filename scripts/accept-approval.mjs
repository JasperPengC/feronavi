import "./_env.ts";
/** 审批节点验收：开启审批 → 流转被拦截 → 审批通过 → 状态变更 → 清理。 */
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
  const r = await page.evaluate(async () => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const H = { "content-type": "application/json", "x-csrf-token": csrf };
    const projects = await fetch("/api/v1/projects", { credentials: "same-origin" }).then((x) => x.json());
    const pid = projects.items[0].id;
    const wfs = await fetch(`/api/v1/workflows?projectId=${pid}`, { credentials: "same-origin" }).then((x) => x.json());
    const wi = await fetch(`/api/v1/projects/${pid}/work-items`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ type: "TASK", title: `accept approval ${Date.now()}` }) }).then((x) => x.json());
    const wf = wfs.find((w) => w.id === wi.workflowId) ?? wfs[0];
    const states = await fetch(`/api/v1/workflows/${wf.id}/states`, { credentials: "same-origin" }).then((x) => x.json());
    const transitions = await fetch(`/api/v1/workflows/${wf.id}/transitions`, { credentials: "same-origin" }).then((x) => x.json());
    const edge = transitions.find((t) => t.fromStateId === wi.statusId);
    const from = states.find((s) => s.id === edge.fromStateId);
    const to = states.find((s) => s.id === edge.toStateId);
    const cfgRes = await fetch(`/api/v1/workflows/${wf.id}/transitions/${edge.id}`, { method: "PATCH", credentials: "same-origin", headers: H, body: JSON.stringify({ requiresApproval: true, approverRoleKeys: ["ADMIN"] }) });
    const cfg = { status: cfgRes.status, body: await cfgRes.text() };
    const blocked = await fetch(`/api/v1/work-items/${wi.id}/transition`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ toStateKey: to.key, version: wi.version }) });
    const blockedBody = await blocked.json();
    const approvals = await fetch(`/api/v1/work-items/${wi.id}/approvals`, { credentials: "same-origin" }).then((x) => x.json());
    const approvalId = approvals.approvals?.[0]?.id;
    const decided = await fetch(`/api/v1/approvals/${approvalId}/approve`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ comment: "验收通过" }) }).then(async (x) => ({ status: x.status, body: await x.json() }));
    const after = await fetch(`/api/v1/work-items/${wi.id}`, { credentials: "same-origin" }).then((x) => x.json());
    await fetch(`/api/v1/workflows/${wf.id}/transitions/${edge.id}`, { method: "PATCH", credentials: "same-origin", headers: H, body: JSON.stringify({ requiresApproval: false, approverRoleKeys: [] }) });
    return { pid, wf, wi, edge, from, to, cfg, blocked: { status: blocked.status, body: blockedBody }, approvals, approvalId, decided, after };
  });
  cleanup = { wiId: r.wi.id, approvalId: r.approvalId };
  console.log("CFG", r.cfg);
  check("审批配置保存", r.cfg.status === 200, `${r.cfg.status} ${r.from.name} → ${r.to.name}`);
  console.log("BLOCKED", JSON.stringify(r.blocked));
  check("流转被审批拦截", r.blocked.status >= 400 && !!r.approvalId, `${r.blocked.status}/${r.approvalId ?? "no-id"}`);
  check("审批记录生成", (r.approvals.approvals?.length ?? 0) === 1);
  check("审批通过并流转", r.decided.status === 200 && r.after.statusId === r.to.id, String(r.decided.status));
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
finally {
  try {
    if (process.env.DATABASE_URL && cleanup.wiId) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql`delete from approval_request where work_item_id = ${cleanup.wiId}`;
      await sql`delete from work_item where id = ${cleanup.wiId}`;
      await sql.end();
    }
  } catch { /* ignore */ }
  await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  审批验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
