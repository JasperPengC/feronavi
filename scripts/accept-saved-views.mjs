import "./_env.ts";
/**
 * 保存视图界面验收（Round 25 长任务第 36 项）——可重复执行、自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const pid = process.env.PROJECT_ID;
const stamp = Date.now().toString(36).slice(-5);
const NAME = `验收视图A ${stamp}`;
const NAME_B = `验收视图B ${stamp}`;
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
  await page.goto(`${BASE}/projects/${pid}/table`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  check("表格页出现保存视图控件", (await page.getByRole("button", { name: "保存当前视图" }).count()) === 1);
  await page.getByRole("button", { name: "保存当前视图" }).click();
  await page.getByLabel("视图名称").fill(NAME);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1300);
  check("保存后提示「视图已保存」", (await page.getByText("视图已保存").count()) > 0);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  await page.getByRole("button", { name: "保存视图", exact: true }).click(); await page.waitForTimeout(500);
  const option = page.getByRole("option", { name: new RegExp(stamp) });
  check("刷新后下拉里出现该视图", (await option.count()) === 1);
  await option.click(); await page.waitForTimeout(600);
  // 保存第二个视图，验证「上移」真实改变下拉顺序
  await page.getByRole("button", { name: "保存当前视图" }).click();
  await page.getByLabel("视图名称").fill(NAME_B);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1200);
  const orderOf = async () => {
    await page.getByRole("button", { name: "保存视图", exact: true }).click();
    await page.waitForTimeout(400);
    const names = await page.getByRole("option").allTextContents();
    await page.keyboard.press("Escape");
    return names.filter((n) => n.includes(stamp));
  };
  const before = await orderOf();
  check("两个视图按保存顺序（A,B）", before.length === 2 && before[0].includes("视图A") && before[1].includes("视图B"), JSON.stringify(before));
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page.getByRole("option", { name: new RegExp("视图B") }).click();
  await page.getByRole("button", { name: "上移", exact: true }).click();
  await page.waitForTimeout(1000);
  const after = await orderOf();
  check("上移后顺序变为（B,A）", after.length === 2 && after[0].includes("视图B") && after[1].includes("视图A"), JSON.stringify(after));

  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page.getByRole("option", { name: new RegExp("视图B") }).click();
  await page.getByRole("button", { name: "删除视图" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page.getByRole("option", { name: new RegExp("视图A") }).click();
  await page.getByRole("button", { name: "删除视图" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForTimeout(1100);
  check("删除后提示「视图已删除」", (await page.getByText("视图已删除").count()) > 0);
  check("真实库中两个视图均已删除", (await sql`select count(*)::int as n from saved_view where name like ${"验收视图%" + stamp}`)[0].n === 0);
  await page.screenshot({ path: "/tmp/saved-views.png" });
} finally {
  await sql`delete from saved_view where name like ${"验收视图%" + stamp}`;
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  保存视图界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
