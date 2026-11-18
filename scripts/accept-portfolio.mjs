import "./_env.ts";
/** 项目集高级视图验收：建组合 → 加项目 → summary 口径 → 详情页 → 清理。 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const USER = process.env.A11Y_USERNAME ?? "freshadmin";
const PASS = process.env.A11Y_PASSWORD ?? "demo-password-12345";
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let data = {};
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(300);
  await page.evaluate(async ({ u, p }) => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }); }, { u: USER, p: PASS });
  data = await page.evaluate(async () => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const H = { "content-type": "application/json", "x-csrf-token": csrf };
    const projects = { items: [] };
    for (const suffix of ["A", "B"]) {
      const response = await fetch("/api/v1/projects", { method: "POST", credentials: "same-origin", headers: H,
        body: JSON.stringify({ key: `PF${Date.now().toString(36).slice(-6).toUpperCase()}${suffix}`, name: `验收项目${suffix}` }) });
      if (!response.ok) throw new Error(`测试项目创建失败：${response.status}`);
      projects.items.push(await response.json());
    }
    const pf = await fetch("/api/v1/portfolios", { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ name: `accept portfolio ${Date.now().toString(36)}` }) }).then((r) => r.json());
    for (const p of projects.items.slice(0, 2)) await fetch(`/api/v1/portfolios/${pf.id}/projects`, { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ projectId: p.id }) });
    const summary = await fetch(`/api/v1/portfolios/${pf.id}/summary`, { credentials: "same-origin" }).then((r) => r.json());
    return { id: pf.id, summary, projectIds: projects.items.slice(0, 2).map((x) => x.id) };
  });
  check("创建项目集并添加项目", data.summary?.totals?.projectCount === 2, String(data.summary?.totals?.projectCount));
  check("summary 返回项目进度", (data.summary?.projects?.length ?? 0) === 2);
  check("summary 返回总计", typeof data.summary?.totals?.completionPercent === "number");
  check("summary 返回风险数组", Array.isArray(data.summary?.risks));
  check("summary 返回里程碑", Array.isArray(data.summary?.milestones));
  await page.goto(`${BASE}/portfolios/${data.id}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(600);
  const text = await page.locator("body").innerText();
  check("详情页渲染项目进度", text.includes("项目进度") && text.includes("风险"));
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
finally {
  try {
    if (data.id) await page.evaluate(async (id) => {
      const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
      await fetch(`/api/v1/portfolios/${id}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": csrf } });
    }, data.id);
  } catch { /* ignore */ }
  await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  项目集验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
