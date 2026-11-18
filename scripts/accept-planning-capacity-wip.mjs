import "./_env.ts";
/** 迭代容量 + 看板 WIP 上限（真实 API + 真实页面）。 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const checks = [];
const check = (n, p, d = "") => { checks.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
let restoreWip = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  const its = await page.evaluate(async (pid) => (await (await fetch(`/api/v1/projects/${pid}/iterations`)).json()), pid);
  const iteration = its[0];
  const cap = await page.evaluate(async (id) => (await (await fetch(`/api/v1/iterations/${id}/capacity`)).json()), iteration.id);
  const m = cap.members?.[0];
  check("迭代容量接口返回项目成员", !!m, JSON.stringify(cap.members?.[0]?.name ?? null));
  const put = await page.evaluate(async ({ id, memberId }) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const h = { "content-type": "application/json", "x-csrf-token": csrf };
    const r = await fetch(`/api/v1/iterations/${id}/capacity/${memberId}`, { method: "PUT", headers: h, body: JSON.stringify({ capacityPoints: 8 }) });
    const bad = await fetch(`/api/v1/iterations/${id}/capacity/${memberId}`, { method: "PUT", headers: h, body: JSON.stringify({ capacityPoints: 8, capacityHours: 32 }) });
    const after = await (await fetch(`/api/v1/iterations/${id}/capacity`)).json();
    return { status: r.status, bad: bad.status, value: after.members?.find((x) => x.memberId === memberId)?.capacityPoints };
  }, { id: iteration.id, memberId: m.memberId });
  check("容量点数可保存", put.status === 200 && put.value === 8, JSON.stringify(put));
  check("容量点数和工时不能同时填", put.bad === 400, String(put.bad));

  const wip = await page.evaluate(async (pid) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const h = { "content-type": "application/json", "x-csrf-token": csrf };
    const board = await (await fetch(`/api/v1/projects/${pid}/work-items/board`)).json();
    const keys = new Set(board.columns.map((c) => c.stateKey));
    const wfs = await (await fetch(`/api/v1/workflows?projectId=${pid}`)).json();
    let patched = null;
    for (const wf of wfs) {
      const states = await (await fetch(`/api/v1/workflows/${wf.id}/states`)).json();
      for (const st of states.filter((x) => keys.has(x.key))) {
        await fetch(`/api/v1/workflows/${wf.id}/states/${st.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ wipLimit: 3 }) });
        patched = { stateId: st.id, wf: wf.id };
      }
    }
    const after = await (await fetch(`/api/v1/projects/${pid}/work-items/board`)).json();
    return { ...patched, wip: after.columns.find((c) => c.wipLimit != null)?.wipLimit };
  }, pid);
  restoreWip = wip;
  check("WIP 上限保存并出现在看板列", wip.wip === 3, JSON.stringify(wip));
  await page.goto(`${BASE}/projects/${pid}/board`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
  check("看板显示 WIP 上限", (await page.locator(".board-column").filter({ hasText: "/ 3" }).count()) > 0);
  await page.screenshot({ path: "/tmp/accept-wip-capacity.png" });
} catch (e) { console.error("  ❌", e); checks.push(false); }
finally {
  if (restoreWip) await page.evaluate(async (pid) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const h = { "content-type": "application/json", "x-csrf-token": csrf };
    const wfs = await (await fetch(`/api/v1/workflows?projectId=${pid}`)).json();
    for (const wf of wfs) {
      const states = await (await fetch(`/api/v1/workflows/${wf.id}/states`)).json();
      for (const st of states) if (st.wipLimit != null) await fetch(`/api/v1/workflows/${wf.id}/states/${st.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ wipLimit: null }) });
    }
  }, 0).catch(() => {});
  await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  容量/WIP 验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
