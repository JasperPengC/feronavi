import "./_env.ts";
/**
 * 导出包保留期界面验收（Round 25 长任务第 47 项）——可重复执行、自建自清。
 * 设置页改导出包保留期 → 保存 → 系统页运维状态显示新值 → 恢复默认。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  const field = page.getByLabel("导出包保留期（小时）");
  check("设置页出现「导出包保留期（小时）」", (await field.count()) === 1);
  await field.fill("48");
  await page.getByRole("button", { name: "保存留存期" }).click();
  await page.waitForTimeout(1300);
  check("保存成功提示", (await page.getByText("留存期已保存").count()) > 0);
  const saved = (await sql`select value from setting where key = 'export.retentionHours'`)[0];
  check("真实库写入 48", Number(saved?.value) === 48, JSON.stringify(saved));

  await page.goto(`${BASE}/system`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  const body = await page.locator("body").innerText();
  check("系统页运维状态显示导出包 48h", /导出包\s*48h/.test(body), (body.match(/日志保留期[^\n]*/) ?? [""])[0]);
  await page.screenshot({ path: "/tmp/export-retention.png" });

  // 恢复默认（删除设置键 → 回落 24）
  await sql`delete from setting where key = 'export.retentionHours'`;
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  check("恢复默认后系统页回到 24h", /导出包\s*24h/.test(await page.locator("body").innerText()));
} finally {
  await sql`delete from setting where key = 'export.retentionHours'`;
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  导出包保留期验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
