import "./_env.ts";
/**
 * 跨项目问题总览界面验收（Round 71 对标 YouQu P2）——真实浏览器。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const stamp = Date.now().toString(36);
const ownTitle = `跨项目本组缺陷 ${stamp}`;
const otherTitle = `跨项目对照缺陷 ${stamp}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let fixture;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  fixture = await page.evaluate(async ({ projectId, stamp, ownTitle, otherTitle }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const create = async (path, body) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
      const result = await response.json();
      if (response.status !== 201 || !result.id) throw new Error(`跨项目 fixture 创建失败：${response.status}`);
      return result;
    };
    const project = await fetch(`/api/v1/projects/${projectId}`).then(response => response.json());
    const otherProject = await create("/api/v1/projects", { key: `IG${stamp.slice(-6).toUpperCase()}`, name: `问题筛选对照项目 ${stamp}` });
    const own = await create(`/api/v1/projects/${projectId}/work-items`, { type: "DEFECT", title: ownTitle, severity: "S1" });
    const other = await create(`/api/v1/projects/${otherProject.id}/work-items`, { type: "DEFECT", title: otherTitle, severity: "S3" });
    return { project, otherProjectId: otherProject.id, itemIds: [own.id, other.id] };
  }, { projectId: pid, stamp, ownTitle, otherTitle });
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" });
  await page.getByText("总登记", { exact: true }).waitFor({ timeout: 15_000 });
  await page.locator(".issues-item-open").filter({ hasText: ownTitle }).waitFor();
  await page.locator(".issues-item-open").filter({ hasText: otherTitle }).waitFor();
  check("全局问题列表覆盖两个真实项目", await page.getByRole("heading", { name: "问题追踪", exact: true }).count() === 1);
  await page.getByRole("button", { name: "展开趋势与分布", exact: true }).click();
  await page.getByText("近 14 天缺陷趋势", { exact: true }).waitFor({ timeout: 15_000 });
  const body = await page.locator("main").innerText();
  const insights = page.getByRole("dialog", { name: "问题概览", exact: true });
  check("全局统计卡可见", ["总登记", "未完成", "未完成 S1"].every((x) => body.includes(x)));
  const insightText = await insights.innerText();
  check("趋势抽屉展示 14 天与严重度分布", insightText.includes("近 14 天缺陷趋势") && insightText.includes("严重度分布")
    && await insights.locator(".issues-trend-day").count() === 14 && await insights.locator(".issues-severity li").count() >= 4);
  await insights.getByRole("button", { name: "关闭", exact: true }).click();
  await insights.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const projectFilter = page.getByRole("button", { name: "按项目筛选", exact: true });
  check("项目筛选控件存在", await projectFilter.count() === 1);
  const rowsBefore = await page.locator("main tbody tr").count();
  check("问题标题附带所属项目", (await page.locator(".issues-item-open").filter({ hasText: ownTitle }).locator(".issues-item-meta").innerText()).includes(fixture.project.name) && rowsBefore >= 2, `rows=${rowsBefore}`);

  await projectFilter.click();
  await page.getByRole("option", { name: `${fixture.project.key} ${fixture.project.name}`, exact: true }).click();
  await page.waitForTimeout(1000);
  const filtered = await page.locator("main tbody tr").count();
  const filteredText = await page.locator("main tbody").innerText();
  check("按项目筛选保留本项目并排除对照项目", filtered >= 1 && filteredText.includes(ownTitle) && !filteredText.includes(otherTitle), `rows=${filtered}`);
  check("项目页问题视图仍可用", await (async () => {
    await page.goto(`${BASE}/projects/${pid}/issues`, { waitUntil: "domcontentloaded" });
    await page.getByText("总登记", { exact: true }).waitFor({ timeout: 15_000 });
    await page.locator(".issues-item-open").filter({ hasText: ownTitle }).waitFor();
    return await page.getByRole("heading", { name: "项目问题", exact: true }).count() === 1 && !(await page.locator("main tbody").innerText()).includes(otherTitle);
  })());
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/issues-global.png" });
} finally {
  if (fixture) {
    for (const id of fixture.itemIds) {
      await sql`delete from activity_entry where target_id = ${id}`;
      await sql`delete from audit_entry where target_id = ${id}`;
      await sql`delete from work_item where id = ${id}`;
    }
    await sql`delete from project where id = ${fixture.otherProjectId}`;
  }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  跨项目问题总览验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
