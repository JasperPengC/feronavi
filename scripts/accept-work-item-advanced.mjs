import "./_env.ts";
/** 工作项详情高级面板：关系/工时/协作者/子工作项（真实 API + 真实抽屉）。 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const checks = [];
const check = (n, p, d = "") => { checks.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await ctx.newPage();
let cleanup = [];
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  const rows = await page.evaluate(async (pid) => (await (await fetch(`/api/v1/projects/${pid}/work-items?view=table&pageSize=3`)).json()).rows, pid);
  const [a, b] = rows;
  const setup = await page.evaluate(async ({ pid, a, b }) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const h = { "content-type": "application/json", "x-csrf-token": csrf };
    const child = await fetch(`/api/v1/projects/${pid}/work-items`, { method: "POST", headers: h, body: JSON.stringify({ type: "SUBTASK", title: `高级面板子任务 ${Date.now()}`, parentId: a.id }) });
    const childBody = await child.json();
    let relBody = {};
    for (const target of [b, ...(await (await fetch(`/api/v1/projects/${pid}/work-items?view=table&pageSize=3`)).json()).rows.filter((r) => r.id !== a.id)]) {
      for (const type of ["BLOCKS", "RELATES_TO"]) {
        const rel = await fetch(`/api/v1/work-items/${a.id}/relations`, { method: "POST", headers: h, body: JSON.stringify({ targetId: target.id, type }) });
        const body = await rel.json();
        if (rel.ok) { relBody = body; break; }
      }
      if (relBody.id) break;
    }
    const t = await fetch(`/api/v1/work-items/${a.id}/time-logs`, { method: "POST", headers: h, body: JSON.stringify({ minutes: 30, loggedDate: new Date().toISOString().slice(0, 10), note: "验收工时" }) });
    const timeBody = await t.json();
    const members = await (await fetch(`/api/v1/projects/${pid}/members`)).json();
    const memberId = members.members[0].id;
    await fetch(`/api/v1/work-items/${a.id}/collaborators`, { method: "POST", headers: h, body: JSON.stringify({ memberId }) });
    return { child: childBody.id, childKey: childBody.key, rel: relBody.id, time: timeBody.id, memberId, aId: a.id, bId: b.id };
  }, { pid, a, b });
  cleanup = setup;
  check("准备子任务/关系/工时/协作者", !!(setup.child && setup.rel && setup.time), JSON.stringify({ child: !!setup.child, rel: !!setup.rel, time: !!setup.time }));

  await page.goto(`${BASE}/projects/${pid}/table?item=${a.id}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const drawer = page.locator(".ui-drawer");
  await drawer.locator("summary", { hasText: "关联与子项" }).click();
  await drawer.locator("summary", { hasText: "协作与工时" }).click();
  const body = await drawer.innerText();
  check("详情显示子工作项", body.includes("子工作项") && body.includes(setup.childKey), setup.childKey);
  check("详情显示依赖关系", body.includes("依赖关系") && body.includes("阻塞"), "");
  check("详情显示工时", body.includes("工时") && body.includes("30 分钟"), "");
  check("详情显示协作者", body.includes("协作者"), "");
  check("无 i18n 裸键", !body.includes("common.add") && !body.includes("wiTime.") && !body.includes("wiCollab."), "");
  await page.screenshot({ path: "/tmp/accept-work-item-advanced.png", fullPage: true });
} catch (e) { console.error("  ❌", e); checks.push(false); }
finally {
  if (cleanup.aId) {
    await page.evaluate(async (s) => {
      const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
      const h = { "content-type": "application/json", "x-csrf-token": csrf };
      if (s.rel) await fetch(`/api/v1/work-items/${s.aId}/relations/${s.rel}`, { method: "DELETE", headers: h });
      if (s.time) await fetch(`/api/v1/time-logs/${s.time}`, { method: "DELETE", headers: h });
      if (s.memberId) await fetch(`/api/v1/work-items/${s.aId}/collaborators/${s.memberId}`, { method: "DELETE", headers: h });
      if (s.child) await fetch(`/api/v1/work-items/${s.child}`, { method: "DELETE", headers: h });
    }, cleanup).catch(() => {});
  }
  await ctx.close(); await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  工作项高级面板验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
