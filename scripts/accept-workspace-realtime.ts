import "./_env.ts";
/** 两个已登录真实浏览器：MCP和REST写入后无需刷新即可更新可见UI。 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as tokens from "../src/server/services/token.service.ts";

const base = process.env.BASE!;
const projectId = process.env.PROJECT_ID!;
const marker = Date.now().toString(36);
const [demo] = await db.select().from(member).where(eq(member.username, "demo"));
const actor = (await loadActor(demo!.id))!;
const token = await tokens.createToken(actor, { name: "浏览器实时隔离验收", tier: "READ_WRITE", projectWhitelist: [] });
const browser = await chromium.launch({ channel: "chrome" });
const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" })));
const pages = await Promise.all(contexts.map(context => context.newPage()));
const [writer, reader] = pages;
let checks = 0, rpcId = 0;
const check = (name: string) => { checks++; console.log(`OK ${name}`); };
async function mcp(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${base}/api/v1/mcp`, { method: "POST", headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined);
  const data = JSON.parse(body.result.content[0].text);
  assert.notEqual(body.result.isError, true, `${name}: ${JSON.stringify(data)}`);
  return data;
}
async function rest(method: string, path: string, body?: object) {
  return writer!.evaluate(async ({ method, path, body }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "");
    const response = await fetch(path, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { method, path, body });
}
async function seen(text: string) { await reader!.getByText(text, { exact: true }).first().waitFor({ state: "visible", timeout: 6000 }); }
async function gone(text: string) { await reader!.getByText(text, { exact: true }).first().waitFor({ state: "hidden", timeout: 6000 }); }
const confirmed = { userConfirmed: true };
try {
  for (const page of pages) {
    await page.goto(`${base}/login`);
    await page.locator("#username").fill("demo"); await page.locator("#password").fill("demo-password-12345");
    await page.locator('button[type="submit"]').click(); await page.waitForURL("**/projects", { timeout: 15000 });
  }
  await reader!.goto(`${base}/workbench`);
  await reader!.locator(".workbench-page").waitFor();
  await reader!.getByText("个人待办", { exact: true }).first().waitFor({ timeout: 10000 });
  const todoTitle = `跨客户端待办-${marker}`;
  const todo = await mcp("todo.create", { ...confirmed, title: todoTitle });
  await seen(todoTitle); check("MCP创建个人待办后第二浏览器自动出现");
  assert.equal((await rest("PATCH", `/api/v1/todos/${todo.id}`, { title: `${todoTitle}-REST` })).status, 200);
  await seen(`${todoTitle}-REST`); await gone(todoTitle); check("第一浏览器REST改名后第二浏览器自动替换待办");
  await mcp("todo.delete", { ...confirmed, todoId: todo.id }); await gone(`${todoTitle}-REST`); check("MCP删除待办后第二浏览器自动移除");

  await reader!.goto(`${base}/portfolios`); await reader!.locator(".page").waitFor();
  const portfolioName = `实时项目集-${marker}`;
  const portfolio = await mcp("portfolio.create", { ...confirmed, name: portfolioName });
  await seen(portfolioName); check("MCP创建项目集后第二浏览器自动出现");
  await mcp("portfolio.update", { ...confirmed, portfolioId: portfolio.id, name: `${portfolioName}-更新` });
  await seen(`${portfolioName}-更新`); await gone(portfolioName); check("项目集修改跨浏览器自动更新");
  await mcp("portfolio.delete", { ...confirmed, portfolioId: portfolio.id }); await gone(`${portfolioName}-更新`); check("项目集删除跨浏览器自动移除");

  await reader!.goto(`${base}/projects/${projectId}/table`);
  const savedViewButton = reader!.getByRole("button", { name: "保存视图", exact: true }).first();
  await savedViewButton.waitFor({ timeout: 15000 });
  const viewName = `实时个人视图-${marker}`;
  const saved = await mcp("savedView.create", { ...confirmed, name: viewName, viewType: "TABLE", scope: "PERSONAL" });
  await savedViewButton.click(); await reader!.getByRole("option", { name: `${viewName}（仅自己）`, exact: true }).waitFor({ timeout: 6000 });
  await reader!.getByRole("option", { name: `${viewName}（仅自己）`, exact: true }).click(); check("MCP个人视图创建后已打开页面选项自动更新");
  await mcp("savedView.update", { ...confirmed, savedViewId: saved.id, name: `${viewName}-更新` });
  await seen(`${viewName}-更新（仅自己）`); check("个人视图改名跨浏览器自动更新");
  await mcp("savedView.delete", { ...confirmed, savedViewId: saved.id }); await gone(`${viewName}-更新（仅自己）`); check("个人视图删除跨浏览器自动更新");

  const dashboardName = `实时仪表盘-${marker}`;
  const dash = await mcp("dashboard.create", { ...confirmed, projectId, name: dashboardName, isDefault: true });
  await reader!.goto(`${base}/projects/${projectId}/insights`);
  await reader!.getByRole("tab", { name: "仪表盘", exact: true }).click();
  const chooser = reader!.getByRole("button", { name: "选择仪表盘", exact: true });
  await chooser.waitFor({ timeout: 15000 }); await chooser.click();
  await reader!.getByRole("option", { name: dashboardName, exact: true }).click();
  await mcp("dashboard.update", { ...confirmed, projectId, dashboardId: dash.id, name: `${dashboardName}-更新` });
  await seen(`${dashboardName}-更新`); check("仪表盘名称跨浏览器自动更新");
  const widget = await mcp("dashboard.addWidget", { ...confirmed, projectId, dashboardId: dash.id, type: "COUNT", config: {} });
  await reader!.locator(".widget-card").first().waitFor({ timeout: 6000 }); check("仪表盘挂件新增跨浏览器自动出现");
  await mcp("dashboard.deleteWidget", { ...confirmed, projectId, dashboardId: dash.id, widgetId: widget.id });
  await reader!.locator(".widget-card").waitFor({ state: "hidden", timeout: 6000 }); check("仪表盘挂件删除跨浏览器自动移除");
  await mkdir(".cache/mcp-workspace-closure", { recursive: true });
  await reader!.screenshot({ path: ".cache/mcp-workspace-closure/realtime-browser.png", fullPage: false });
  assert.equal(await reader!.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  check("实时更新后页面无横向溢出并保存截图");
  console.log(`工作空间浏览器实时 ${checks}/${checks}`);
} finally { await browser.close(); await sql.end(); }
