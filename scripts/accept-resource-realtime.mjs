import "./_env.ts";
/** 以 --browser 隔离运行：观察页面不刷新，另客户端通过 MCP/REST 写入。 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const BASE = process.env.BASE;
const screenshotDirectory = ".cache/resource-realtime";
let browser, reader, writer, page, csrf, token, rpcId = 0, checks = 0, documentRequests = 0;
async function api(path, method = "GET", body) {
  const r = await writer.request.fetch(`${BASE}/api/v1${path}`, { method, headers: { "x-csrf-token": csrf }, ...(body === undefined ? {} : { data: body }) });
  assert.notEqual(r.status(), 429, "遇到限流，停止本轮");
  const data = await r.json(); assert.ok(r.ok(), `${path}: ${JSON.stringify(data)}`); return data;
}
async function mcp(name, args) {
  const r = await writer.request.post(`${BASE}/api/v1/mcp`, { headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: { ...args, userConfirmed: true } } } });
  assert.notEqual(r.status(), 429, "遇到限流，停止本轮");
  const envelope = await r.json(); assert.equal(envelope.error, undefined);
  const data = JSON.parse(envelope.result.content[0].text); assert.notEqual(envelope.result.isError, true, JSON.stringify(data));
  return data.result ?? data;
}
const check = name => { checks++; console.log(`OK ${name}`); };
try {
  await mkdir(screenshotDirectory, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: process.env.HEADED !== "1" });
  writer = await browser.newContext();
  reader = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "zh-CN" });
  await reader.addInitScript(() => localStorage.setItem("feronavi_locale", "zh-CN"));
  for (const context of [writer, reader]) {
    const login = await context.request.post(`${BASE}/api/v1/auth/login`, { data: { username: "demo", password: "demo-password-12345" } });
    assert.ok(login.ok()); const result = await login.json(); if (context === writer) csrf = result.csrfToken;
  }
  const project = await api("/projects", "POST", { key: `RT${Date.now().toString(36).slice(-6).toUpperCase()}`, name: "独立客户端实时验收" });
  token = (await api("/tokens", "POST", { name: "实时验收", tier: "READ_WRITE", projectWhitelist: [project.id] })).token;
  page = await reader.newPage();
  page.on("request", request => { if (request.resourceType() === "document") documentRequests++; });
  await page.goto(`${BASE}/projects/${project.id}/milestones`);
  await page.getByRole("tab", { name: "迭代", exact: true }).click();
  const baseline = documentRequests;
  const plan = await mcp("plan.createIteration", { projectId: project.id, name: "远端新建迭代", startDate: "2026-11-20", endDate: "2026-11-30" });
  await expect(page.locator("#planning-panel-iteration").getByText("远端新建迭代", { exact: true })).toBeVisible();
  await api(`/iterations/${plan.id}`, "PATCH", { name: "远端修改迭代" });
  await expect(page.getByText("远端修改迭代", { exact: true })).toBeVisible();
  await api(`/iterations/${plan.id}/complete`, "POST", {});
  await expect(page.locator("#planning-panel-iteration").getByText("已完成", { exact: true })).toBeVisible();
  assert.equal(documentRequests, baseline);
  await page.screenshot({ path: `${screenshotDirectory}/plan-completed.png` });
  check("计划MCP创建、REST更新与完成自动显示");

  const item = await api(`/projects/${project.id}/work-items`, "POST", { type: "TASK", title: "远端附件验收任务" });
  await page.goto(`${BASE}/projects/${project.id}/board`);
  await page.getByText(item.title, { exact: true }).click();
  await page.locator("summary").filter({ hasText: "附件" }).click();
  const attachmentBaseline = documentRequests;
  const upload = await writer.request.post(`${BASE}/api/v1/uploads`, { headers: { "x-csrf-token": csrf }, multipart: {
    targetType: "WORK_ITEM", targetId: item.id, file: { name: "实时附件.txt", mimeType: "text/plain", buffer: Buffer.from("独立客户端附件") },
  } });
  assert.ok(upload.ok()); const attachment = await upload.json();
  await expect(page.getByText("实时附件.txt", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/attachment-uploaded.png` });
  await api(`/attachments/${attachment.id}`, "DELETE");
  await expect(page.getByText("实时附件.txt", { exact: true })).toHaveCount(0);
  assert.equal(documentRequests, attachmentBaseline);
  check("附件REST上传和删除自动显示");

  await page.goto(`${BASE}/projects/${project.id}/import`);
  await page.getByRole("tab", { name: "导入记录", exact: true }).click();
  const importBaseline = documentRequests;
  const batch = await mcp("import.create", { projectId: project.id, filename: "实时导入.csv", contentBase64: Buffer.from("来源编号,任务标题,备注\nremote-1,实时导入任务,远端说明\n").toString("base64") });
  await expect(page.getByText("实时导入.csv", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  const scope = { projectId: project.id, batchId: batch.batchId };
  await mcp("import.setMapping", { ...scope, fieldMap: { 任务标题: "title", 备注: "description" }, externalIdColumn: "来源编号" });
  await expect(page.getByRole("button", { name: "校验数据", exact: true })).toBeVisible();
  await mcp("import.dryRun", scope);
  await expect(page.getByRole("button", { name: "导入 1 条工作项", exact: true })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/import-preview.png` });
  await mcp("import.confirm", scope);
  const panel = page.getByRole("tabpanel", { name: "导入工作项" });
  await expect(panel.getByText("已完成", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/import-confirmed.png` });
  await mcp("import.rollback", scope);
  await expect(panel.getByText("已回滚", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入 1 条工作项", exact: true })).toHaveCount(0);
  assert.equal(documentRequests, importBaseline);
  await page.screenshot({ path: `${screenshotDirectory}/import-rolled-back.png` });
  check("导入MCP创建、映射、预览、确认和回滚自动显示且无需重新加载文档");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  console.log(`真实浏览器资源实时验收 ${checks}/${checks}`);
} catch (error) {
  process.exitCode = 1; console.error(error);
  await page?.screenshot({ path: `${screenshotDirectory}/failure.png` }).catch(() => {});
} finally { await browser?.close(); }
