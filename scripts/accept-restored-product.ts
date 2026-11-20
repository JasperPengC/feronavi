import "./_env.ts";
/** 随机隔离库里的原产品恢复验收：真实REST/浏览器，已保存回答为合成fixture，不调用模型。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, notification, ragConversation, ragMessage } from "../src/db/schema.ts";

const base = process.env.BASE!;
const projectId = process.env.PROJECT_ID!;
const marker = Date.now().toString(36);
const directory = ".cache/source-recovery";
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
const page = await context.newPage();
const readerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
const reader = await readerContext.newPage();
const errors: string[] = [];
const workers: string[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("worker", worker => workers.push(worker.url()));
reader.on("pageerror", error => errors.push(error.message));
let checks = 0;
const check = (name: string) => { checks++; console.log(`OK ${name}`); };
async function request(method: string, path: string, body?: object) {
  return page.evaluate(async ({ method, path, body }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "");
    const response = await fetch(path, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { method, path, body });
}
try {
  await mkdir(directory, { recursive: true });
  const [demo] = await db.select().from(member).where(eq(member.username, "demo"));
  await db.insert(notification).values({ recipientId: demo!.id, type: "ACCEPT", category: "MENTION", title: `恢复验收通知-${marker}`, body: "隔离数据库合成通知" });
  await page.goto(`${base}/login`);
  await page.locator("#username").fill("demo"); await page.locator("#password").fill("demo-password-12345");
  await page.locator('button[type="submit"]').click(); await page.waitForURL("**/projects", { timeout: 15000 });
  await page.locator('.shell-sidebar a[href="/assistant"]').waitFor();
  assert.ok(await page.locator(".shell-header-tabs").isVisible());
  check("独立知识助手入口和恢复后的顶栏标签可见");

  const first = await request("POST", "/api/v1/rag/conversations", { projectId, title: `图表会话-${marker}` });
  const second = await request("POST", "/api/v1/rag/conversations", { title: `全局会话-${marker}` });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const answer = "## 交付记录\n\n| 阶段 | 状态 |\n| --- | --- |\n| 界面恢复 | 已完成 |\n\n- [x] 保留协作刷新\n- [ ] 后续联调\n\n```mermaid\nflowchart LR\n  A[需求] --> B[实现] --> C[验收]\n```\n\n```mermaid\npie title 交付统计\n  \"已完成\": 8\n  \"待处理\": 2\n```";
  await db.insert(ragMessage).values([
    { conversationId: first.body.id, requestId: randomUUID(), question: "展示交付记录和流程图", status: "completed", reply: { ok: true, answer, citations: [], mode: "none", scope: { projectIds: [projectId], projectCount: 1 } } },
    { conversationId: second.body.id, requestId: randomUUID(), question: "这是另一个对话吗？", status: "completed", reply: { ok: true, answer: "这是独立保存的第二个会话。\n\n```mermaid\nflowchart-elk LR\n A[接收] --> B[计算] --> C[完成]\n```", citations: [], mode: "none", scope: { projectIds: [], projectCount: 0 } } },
  ]);
  await page.goto(`${base}/assistant?conversation=${first.body.id}`);
  await reader.goto(`${base}/login`);
  await reader.locator("#username").fill("demo"); await reader.locator("#password").fill("demo-password-12345");
  await reader.locator('button[type="submit"]').click(); await reader.waitForURL("**/projects", { timeout: 15000 });
  await reader.goto(`${base}/assistant?conversation=${first.body.id}`);
  await reader.getByRole("heading", { name: "交付记录", exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "交付记录", exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".assistant-conversation table").count(), 1);
  assert.equal(await page.locator('.assistant-conversation input[type="checkbox"]').count(), 2);
  check("真实已保存会话恢复Markdown表格和任务列表");
  await page.frameLocator('iframe[title="Mermaid 图表"]').first().locator("svg").waitFor({ timeout: 15000 });
  assert.equal(await page.getByTitle("Mermaid 图表", { exact: true }).first().getAttribute("sandbox"), "");
  check("Mermaid真实绘图库在隔离iframe中渲染流程图");
  await page.frameLocator('iframe[title="Mermaid 图表"]').nth(1).locator("svg").getByText("交付统计", { exact: true }).waitFor({ timeout: 15000 });
  check("拆包后的真实语法解析器渲染饼图，保持图表语义");
  assert.equal(workers.length, 0, "普通流程图不应预加载ELK Worker");
  await page.screenshot({ path: `${directory}/restored-assistant-desktop.png` });

  await page.locator(`.assistant-session-link[href*="${second.body.id}"]`).click();
  await page.getByText("这是独立保存的第二个会话。", { exact: true }).waitFor();
  await page.frameLocator('iframe[title="Mermaid 图表"]').locator("svg").getByText("接收", { exact: true }).waitFor({ timeout: 15000 });
  assert.ok(workers.some(url => url.includes("elk-worker")), "ELK流程图必须在独立Worker完成布局");
  check("ELK布局按需启动真实Worker并渲染SVG，普通流程图不加载ELK");
  assert.equal(await page.getByRole("heading", { name: "交付记录", exact: true }).count(), 0);
  await page.locator(`.assistant-session-link[href*="${first.body.id}"]`).click();
  await page.getByRole("heading", { name: "交付记录", exact: true }).waitFor();
  await page.reload(); await page.getByRole("heading", { name: "交付记录", exact: true }).waitFor();
  check("两个真实会话切换不串内容，刷新后保留选中会话及回答");

  await page.getByRole("button", { name: "重命名对话", exact: true }).click();
  await page.getByLabel("对话名称", { exact: true }).fill(`已改名会话-${marker}`);
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await page.getByRole("heading", { name: `已改名会话-${marker}`, exact: true }).waitFor();
  await reader.getByRole("heading", { name: `已改名会话-${marker}`, exact: true }).waitFor();
  await reader.locator(`.assistant-session-link[href*="${first.body.id}"]`).getByText(`已改名会话-${marker}`, { exact: true }).waitFor();
  assert.equal((await request("GET", `/api/v1/rag/conversations/${first.body.id}`)).body.conversation.title, `已改名会话-${marker}`);
  check("浏览器重命名会话后真实REST复读一致，第二浏览器无刷新同步标题及会话列表");
  await page.getByRole("button", { name: "删除对话", exact: true }).click();
  await reader.getByRole("button", { name: "恢复对话", exact: true }).waitFor();
  await reader.locator(`.assistant-session-link[href*="${first.body.id}"]`).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "已删除", exact: true }).click();
  await page.locator(`.assistant-session-link[href*="${first.body.id}"]`).click();
  await page.getByRole("button", { name: "恢复对话", exact: true }).click();
  await page.getByRole("button", { name: "删除对话", exact: true }).waitFor();
  await reader.getByRole("button", { name: "删除对话", exact: true }).waitFor();
  await reader.locator(`.assistant-session-link[href*="${first.body.id}"]`).waitFor();
  assert.equal((await request("GET", `/api/v1/rag/conversations/${first.body.id}`)).body.conversation.deletedAt, null);
  check("会话软删除恢复原回答，第二浏览器无刷新同步软删除状态及列表");
  const added = await request("POST", "/api/v1/rag/conversations", { title: `跨端新会话-${marker}` });
  assert.equal(added.status, 200);
  await reader.locator(`.assistant-session-link[href*="${added.body.id}"]`).waitFor();
  check("新建会话立即抵达另一浏览器会话列表");

  const unread = (await request("GET", "/api/v1/notifications")).body.unreadCount;
  await page.locator(".notification-trigger").click();
  await page.locator(".notification-popover").getByText(`恢复验收通知-${marker}`, { exact: true }).waitFor();
  const marked = page.waitForResponse(response => response.url().endsWith("/api/v1/notifications/read") && response.request().method() === "POST");
  await page.locator(".notification-popover").getByRole("button", { name: "标为已读", exact: true }).first().click();
  assert.equal((await marked).status(), 200);
  assert.equal((await request("GET", "/api/v1/notifications")).body.unreadCount, unread - 1);
  await page.keyboard.press("Escape");
  check("恢复后的通知浮层读操作真实减少服务端未读数");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "会话列表", exact: true }).click();
  await page.locator(".assistant-session-drawer").waitFor();
  await page.locator(`.assistant-session-drawer .assistant-session-link[href*="${second.body.id}"]`).click();
  await page.getByText("这是独立保存的第二个会话。", { exact: true }).waitFor();
  await page.locator(".assistant-session-drawer").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: `${directory}/restored-assistant-mobile.png` });
  check("手机会话抽屉选择后关闭，页面无横向溢出");
  assert.deepEqual(errors, []);
  check("完整恢复交互无浏览器运行时异常");
  assert.equal((await db.select().from(ragConversation).where(eq(ragConversation.id, first.body.id))).length, 1);
  console.log(`恢复产品浏览器 ${checks}/${checks}`);
} catch (error) {
  await page.screenshot({ path: `${directory}/restored-browser-error.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); await sql.end(); }
