import "./_env.ts";
/** 隔离生产实例上的真实 HTTP 传输与缓存测量；浏览器请求不拦截，避免禁用 HTTP 缓存。 */
import assert from "node:assert/strict";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE;
assert(base && process.env.FERONAVI_TEST_DIRECTORY, "需要隔离浏览器 runner");
const directory = await realpath(process.env.FERONAVI_TEST_DIRECTORY);
assert(basename(directory).startsWith("isolated-test-"), "只允许替换本轮一次性服务的静态产物");
const evidence = resolve(process.env.FRONTEND_REPORT_DIR ?? ".cache/release-tuning-2026-11-08");
await mkdir(evidence, { recursive: true });
const variants = ["before", "after"];
const report = { measuredAt: new Date().toISOString(), browser: "Chromium", base,
  scope: "同源生产服务，未拦截请求；serviceWorkers:block 用于单独测量 HTTP 缓存。传输字节来自 Resource Timing，包含响应头；API/SSE 不计入静态资源。", variants: {} };
const browser = await chromium.launch();
const errors = [];
try {
  for (const variant of variants) {
    const source = join(evidence, `frontend-${variant}-dist`);
    await readFile(join(source, "index.html"));
    await cp(source, join(directory, "dist"), { recursive: true, force: true });
    const results = {};
    for (const [name, path, heading] of [["login", "/login", "登录"], ["workbench", "/workbench", "我的工作台"]]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block", locale: "zh-CN" });
      try {
        if (name !== "login") {
          const login = await context.request.post(`${base}/api/v1/auth/login`, { data: { username: "demo", password: "demo-password-12345" } });
          assert.equal(login.status(), 200, "测量账号登录成功");
        }
        const page = await context.newPage();
        page.on("pageerror", error => errors.push(error.message));
        const headers = {};
        page.on("response", response => {
          if (new URL(response.url()).pathname.startsWith("/assets/")) {
            headers[new URL(response.url()).pathname] = response.headers()["cache-control"];
          }
        });
        for (const cache of ["cold", "warm"]) {
          const navigation = await page.goto(`${base}${path}`, { waitUntil: "load" });
          await page.getByRole("heading", { name: heading, exact: true }).waitFor();
          if (name === "workbench") await page.locator(".workbench-item-row button").first().waitFor();
          await page.waitForFunction(() => !document.querySelector('[role="status"][aria-busy="true"]'));
          await page.waitForTimeout(300);
          const entries = await page.evaluate(() => [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")]
            .filter(item => { const path = new URL(item.name).pathname; return !path.startsWith("/api/") && !path.endsWith("/sw.js"); })
            .map(item => ({ path: new URL(item.name).pathname, type: item.entryType,
              transferBytes: item.transferSize, encodedBodyBytes: item.encodedBodySize, decodedBodyBytes: item.decodedBodySize })));
          results[`${name}-${cache}`] = { requests: entries.length,
            networkRequests: entries.filter(item => item.transferBytes > 0).length,
            transferBytes: entries.reduce((n, item) => n + item.transferBytes, 0),
            encodedBodyBytes: entries.reduce((n, item) => n + item.encodedBodyBytes, 0),
            documentCacheControl: navigation.headers()["cache-control"], entries };
        }
        if (name === "workbench") {
          const before = await page.evaluate(() => performance.getEntriesByType("resource").length);
          const trigger = page.locator(".workbench-item-row button").first();
          await trigger.click();
          await page.locator('.work-item-detail .wi-drawer').waitFor();
          const drawer = page.locator('.work-item-detail');
          const title = await drawer.locator('h2').innerText();
          await drawer.getByRole("button", { name: "关闭", exact: true }).click();
          await drawer.waitFor({ state: "detached" });
          assert.equal(await trigger.evaluate(element => element === document.activeElement), true, "详情关闭后焦点回到入口");
          const resources = await page.evaluate(offset => performance.getEntriesByType("resource").slice(offset)
            .filter(item => new URL(item.name).pathname.startsWith("/assets/"))
            .map(item => ({ path: new URL(item.name).pathname, transferBytes: item.transferSize, encodedBodyBytes: item.encodedBodySize })), before);
          await trigger.click();
          await page.locator('.work-item-detail .wi-drawer').waitFor();
          assert.equal(await page.locator('.work-item-detail h2').innerText(), title);
          results.drawer = { opened: true, reopened: true, focusRestored: true, resources,
            requests: resources.length, transferBytes: resources.reduce((n, item) => n + item.transferBytes, 0) };
        }
        assert(Object.values(headers).every(value => value === "public, max-age=31536000, immutable"), "带内容哈希资源具有一年 immutable 缓存");
        results[`${name}-asset-cache-headers`] = headers;
      } finally { await context.close(); }
    }
    report.variants[variant] = results;
    console.log(`${variant}: ${JSON.stringify(Object.fromEntries(Object.entries(results).filter(([name]) => name.includes("-cold") || name.includes("-warm")).map(([name, { entries: _entries, ...summary }]) => [name, summary])))}`);
  }
  assert.deepEqual(errors, [], "浏览器无脚本异常");
  const before = report.variants.before["workbench-cold"];
  const after = report.variants.after["workbench-cold"];
  assert(after.transferBytes < before.transferBytes - 100_000, "工作台首屏至少减少100KB实际传输");
  assert(report.variants.after["workbench-warm"].entries.filter(item => item.path.startsWith("/assets/"))
    .every(item => item.transferBytes === 0), "缓存后的内容哈希资源不再传输");
  assert(report.variants.after.drawer.resources.some(item => item.path.includes("WorkItemDrawer-")), "首次打开才下载详情模块");
  report.passed = true;
} finally {
  await browser.close();
  report.errors = errors;
  await writeFile(join(evidence, "frontend-network.json"), JSON.stringify(report, null, 2) + "\n");
}
