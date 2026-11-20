import "./_env.ts";
/**
 * 全量筛选导出界面验收（Round 80）——真实浏览器下载 + CSV 内容核对。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const parseCsv = (raw) => {
  const text = raw.replace(/^\uFEFF/, "");
  const lines = text.trim().split(/\r?\n/);
  return lines.map((line) => {
    const out = []; let cur = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
      else if (ch === '"') quoted = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out;
  });
};
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const projects = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items);
  const pid = projects[0].id;
  await page.goto(`${BASE}/projects/${pid}/issues`, { waitUntil: "domcontentloaded" });
  await page.locator(".issues-table tbody tr").first().waitFor({ timeout: 15_000 });

  // ① 未筛选导出：应覆盖当前表格中的全部行（全量匹配，而不是当前页截断）
  const tableRows = await page.locator(".page tbody tr").count();
  const [downloadAll] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "导出全部筛选结果", exact: true }).click(),
  ]);
  const rawAll = readFileSync(await downloadAll.path(), "utf8");
  const rowsAll = parseCsv(rawAll).filter((r) => r.some((c) => c !== ""));
  const header = rowsAll[0];
  const sevIdx = header.indexOf("severity");
  check("点击导出触发真实下载", !!downloadAll, downloadAll.suggestedFilename());
  check("CSV 带 BOM/CRLF 且表头正确", rawAll.startsWith("\uFEFF") && rawAll.includes("\r\n") && header.includes("key") && header.includes("title") && sevIdx > 0);
  check("未筛选导出覆盖表格全部行", tableRows > 0 && rowsAll.length - 1 === tableRows, `表格=${tableRows} 导出=${rowsAll.length - 1}`);

  // ② S2 筛选导出：全量匹配且每行 severity=S2
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByRole("button", { name: "严重度", exact: true }).click();
  await page.getByRole("option", { name: "S2", exact: true }).click();
  await page.waitForTimeout(900);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "导出全部筛选结果", exact: true }).click(),
  ]);
  const raw = readFileSync(await download.path(), "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c !== ""));
  check("筛选导出只含 S2（全量匹配）", rows.length > 1 && rows.slice(1).every((r) => r[sevIdx] === "S2"), `${rows.length - 1} 行`);

  // 全局问题总览导出（项目筛选同款）
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" });
  await page.locator(".issues-table tbody tr").first().waitFor({ timeout: 15_000 });
  const [download2] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "导出全部筛选结果", exact: true }).click(),
  ]);
  const raw2 = readFileSync(await download2.path(), "utf8");
  const rows2 = parseCsv(raw2).filter((r) => r.some((c) => c !== ""));
  check("跨项目导出含项目列且行数正确", rows2[0].includes("project") && rows2.length >= 2, `${rows2.length - 1} 行`);
  await page.screenshot({ path: "/tmp/export-filtered.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  全量筛选导出验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
