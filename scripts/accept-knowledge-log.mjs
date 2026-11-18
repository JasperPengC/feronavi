import "./_env.ts";
/**
 * 知识检索日志界面验收（Round 25 长任务第 28 项）——只读（日志是真实检索产物）。
 * 真实浏览器发起一次检索 → 系统页运维状态「近 30 天查询」计数增加。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const before = await page.evaluate(async () => (await fetch("/api/v1/system/operations", { credentials: "same-origin" })).json());
  check("运维状态可读且含近 30 天查询数", typeof before?.knowledge?.queries30d === "number", JSON.stringify(before?.knowledge));
  const search = await page.evaluate(async (p) => {
    const r = await fetch(`/api/v1/projects/${p}/knowledge/search?q=${encodeURIComponent("活动验收检索词")}`, { credentials: "same-origin" });
    return { status: r.status, body: await r.json() };
  }, pid);
  check("真实浏览器发起知识检索 200", search.status === 200, JSON.stringify(search.body?.mode));
  await page.goto(`${BASE}/system`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  const text = await page.locator(".card", { hasText: "运维状态" }).innerText();
  check("系统页显示知识检索与近 30 天查询", text.includes("知识检索") && text.includes("近 30 天查询"), text.split("\n").find((l) => l.includes("知识检索")) ?? "");
  const after = await page.evaluate(async () => (await fetch("/api/v1/system/operations", { credentials: "same-origin" })).json());
  check("检索后计数增加", after.knowledge.queries30d >= before.knowledge.queries30d + 1, `${before.knowledge.queries30d} → ${after.knowledge.queries30d}`);
  await page.screenshot({ path: "/tmp/knowledge-log.png" });
} finally {
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  知识检索日志界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
