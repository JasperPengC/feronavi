import "./_env.ts";
/** PWA 验收：manifest / service worker / 离线壳。需要生产构建 + 本地服务。 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(900);
  const meta = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')?.getAttribute("href");
    const reg = await navigator.serviceWorker.getRegistration();
    const manifest = link ? await fetch(link).then((r) => r.json()).catch(() => null) : null;
    return { link, reg: !!reg, name: manifest?.name, icons: manifest?.icons?.length ?? 0, display: manifest?.display };
  });
  check("manifest 已声明", meta.link === "/site.webmanifest", meta.link ?? "");
  check("manifest 字段完整", meta.name === "Feronavi" && meta.display === "standalone" && meta.icons >= 2, `${meta.icons} icons`);
  check("service worker 已注册", meta.reg);
  const ready = await page.evaluate(async () => { await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 4000))]); return !!navigator.serviceWorker.controller || !!(await navigator.serviceWorker.getRegistration()); });
  check("service worker ready", ready);
  await ctx.setOffline(true);
  await page.goto(`${BASE}/workbench`).catch(() => {});
  await page.waitForTimeout(600);
  const text = await page.locator("body").innerText().catch(() => "");
  check("离线时显示离线页", text.includes("离线"));
} catch (e) { console.error("  ❌", e); checks.push(false); }
finally { await ctx.close(); await browser.close(); }
const ok = checks.filter(Boolean).length;
console.log(`\n  PWA 验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
