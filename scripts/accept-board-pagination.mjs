import "./_env.ts";
/** 看板列分页：首屏 ≤25/列，大列可加载更多，DOM 不因大列爆掉。 */
import { chromium } from "playwright";
const HOST = process.env.BASE;
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
const checks = [];
const check = (name, ok, detail = "") => { checks.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`); };
try {
  await p.goto(`${HOST}/login`); await p.waitForTimeout(300);
  await p.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await p.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  await p.goto(`${HOST}/projects/${pid}/board`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(900);
  const counts = await p.locator(".board-column").evaluateAll((cols) => cols.map((c) => c.querySelectorAll(".card").length));
  check("首屏每列最多 50 张卡（多工作流合并上限）", counts.every((n) => n <= 50), JSON.stringify(counts));
  const more = p.getByRole("button", { name: /加载更多/ }).first();
  check("大列出现加载更多", await more.count() > 0);
  if (await more.count()) {
    const col = p.locator(".board-column").filter({ has: more }).first();
    const before = await col.locator(".card").count();
    await more.click(); await p.waitForTimeout(800);
    const after = await col.locator(".card").count();
    check("加载更多追加下一批", after > before, `${before} → ${after}`);
    check("加载后单列仍受分页控制", after <= 75, String(after));
  }
} catch (e) {
  console.error("  ❌", e); checks.push(false);
} finally { await b.close(); }
const passed = checks.filter(Boolean).length;
console.log(`\n  看板列分页验收 ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
