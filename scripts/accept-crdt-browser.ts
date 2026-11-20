import "./_env.ts";
/** 三个独立账号通过真实浏览器验证协作草稿、并发输入、断网队列与重新打开恢复。 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { PNG } from "pngjs";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";

const base = process.env.BASE!;
const projectId = process.env.PROJECT_ID!;
const directory = process.env.CRDT_BROWSER_OUTPUT ?? ".cache/source-recovery/crdt-browser";
const storageMode = process.env.CRDT_STORAGE_MODE ?? "indexeddb";
assert.ok(["indexeddb", "localstorage"].includes(storageMode), "协作存储验收模式有效");
const marker = Date.now().toString(36);
const password = `Crdt-${marker}-acceptance`;
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" })));
if (storageMode === "localstorage") {
  await Promise.all(contexts.map(context => context.addInitScript(() => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
      open() { throw new DOMException("验收模拟浏览器拒绝 IndexedDB", "SecurityError"); },
    } });
  })));
}
const pages = await Promise.all(contexts.map(context => context.newPage()));
const [a, b, c] = pages as [Page, Page, Page];
const errors: string[] = [];
const checks: string[] = [];
const check = (name: string) => { checks.push(name); console.log(`OK ${name}`); };
for (const page of pages) page.on("pageerror", error => errors.push(error.message));
async function request(page: Page, method: string, path: string, body?: object) {
  const result = await page.evaluate(async ({ method, path, body }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "");
    const response = await fetch(path, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { method, path, body });
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
  return result.body;
}
const editor = (page: Page) => page.getByRole("textbox", { name: "文档正文", exact: true });
async function edit(page: Page, pageId: string) {
  await page.goto(`${base}/projects/${projectId}/wiki?page=${pageId}`);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("协作已连接", { exact: true }).waitFor({ timeout: 15000 });
}
async function append(page: Page, value: string) {
  await editor(page).focus();
  await editor(page).evaluate(element => { const input = element as HTMLTextAreaElement; input.setSelectionRange(input.value.length, input.value.length); });
  await page.keyboard.insertText(value);
}
async function outbox(page: Page): Promise<number> {
  if (storageMode === "localstorage") {
    return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("feronavi:collab:outbox:operation:")).length);
  }
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open("feronavi-collab:feronavi:collab:outbox", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains("outbox")) { database.close(); resolve(0); return; }
      const request = database.transaction("outbox").objectStore("outbox").count();
      request.onsuccess = () => { database.close(); resolve(request.result); };
      request.onerror = () => { database.close(); reject(request.error); };
    };
  }));
}
let failure: string | null = null;
try {
  await mkdir(directory, { recursive: true });
  const [admin] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const passwordHash = await hashPassword(password);
  for (const [index, page] of pages.entries()) {
    const username = `collab-${marker}-${index}`;
    const [person] = await db.insert(member).values({ username, name: `协作验收${index + 1}`, status: "ACTIVE", passwordHash }).returning();
    await db.insert(roleAssignment).values({ memberId: person!.id, roleId: admin!.id, scopeType: "ORG", scopeId: null });
    await page.goto(`${base}/login`);
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    const login = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST");
    await page.locator('button[type="submit"]').click();
    assert.equal((await login).status(), 200);
    await page.waitForURL("**/projects", { timeout: 15000 });
  }
  check("三个独立账号分别登录独立浏览器上下文");
  const created = await request(a, "POST", `/api/v1/projects/${projectId}/pages`, { title: `多人协作验收-${marker}`, content: "原始正文\n" });
  const statePath = `/api/v1/collaboration/rooms/PAGE/${created.id}/state`;
  const serverText = async () => {
    const state = await request(a, "GET", statePath);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(state.stateBase64, "base64"));
    const text = doc.getText("content").toString(); doc.destroy(); return text;
  };
  await edit(a, created.id);
  await append(a, "甲的未发布草稿\n");
  await expect.poll(serverText).toBe("原始正文\n甲的未发布草稿\n");
  assert.equal((await request(a, "GET", `/api/v1/pages/${created.id}`)).content, "原始正文\n");
  check("首位编辑者的草稿同步服务端但尚未发布");
  await edit(b, created.id);
  await expect(editor(b)).toHaveValue("原始正文\n甲的未发布草稿\n");
  await expect(editor(a)).toHaveValue("原始正文\n甲的未发布草稿\n");
  assert.equal(await serverText(), "原始正文\n甲的未发布草稿\n");
  check("第二位用户加入保留远端未发布草稿");
  await edit(c, created.id);
  for (const page of pages) await expect(page.getByText("在线成员 3", { exact: true })).toBeVisible({ timeout: 15000 });
  check("三人在线人数在所有浏览器中无刷新同步");

  await Promise.all([append(a, "[甲并发]\n"), append(b, "[乙并发]\n"), append(c, "[丙并发]\n")]);
  const concurrentMarkers = ["[甲并发]", "[乙并发]", "[丙并发]"];
  await expect.poll(async () => {
    const values = await Promise.all(pages.map(page => editor(page).inputValue()));
    return values.every(value => value === values[0] && concurrentMarkers.every(marker => value.split(marker).length === 2));
  }, { timeout: 15000 }).toBe(true);
  check("三名用户并发输入收敛，三方内容各保留一次");
  await expect.poll(() => outbox(c)).toBe(0);
  await contexts[2]!.setOffline(true);
  await append(c, "[丙离线一]\n");
  await append(c, "[丙离线二]\n");
  await expect.poll(() => outbox(c), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  await append(a, "[甲在线]\n");
  await expect(editor(b)).toHaveValue(/\[甲在线\]/u);
  check(`断网两次编辑写入真实${storageMode === "indexeddb" ? "IndexedDB" : "localStorage降级队列"}，其他用户继续协作`);
  // 离线关闭编辑页面，再联网重新打开，强制依赖持久队列恢复，而非旧页面内存。
  await c.goto("about:blank");
  await contexts[2]!.setOffline(false);
  await edit(c, created.id);
  const allMarkers = [...concurrentMarkers, "[丙离线一]", "[丙离线二]", "[甲在线]"];
  await expect.poll(async () => {
    const values = await Promise.all(pages.map(page => editor(page).inputValue()));
    return values.every(value => value === values[0] && allMarkers.every(marker => value.split(marker).length === 2));
  }, { timeout: 20000 }).toBe(true);
  await expect.poll(() => outbox(c)).toBe(0);
  check("重新打开页面后离线编辑完整恢复，与在线修改合并且队列清空");
  await contexts[2]!.setOffline(true);
  await append(b, "[乙离线期间修改]\n");
  await expect(editor(a)).toHaveValue(/\[乙离线期间修改\]/u);
  await contexts[2]!.setOffline(false);
  await expect(editor(c)).toHaveValue(/\[乙离线期间修改\]/u, { timeout: 15000 });
  check("离线期间没有本地修改也能在联网后自动补齐遗漏内容");
  const sibling = await contexts[0]!.newPage();
  sibling.on("pageerror", error => errors.push(error.message));
  await edit(sibling, created.id);
  await append(sibling, "[同账号另一个标签页]\n");
  await expect(editor(a)).toHaveValue(/\[同账号另一个标签页\]/u);
  const leave = sibling.waitForResponse(response => response.url().endsWith(`/PAGE/${created.id}/leave`));
  await sibling.getByRole("button", { name: "退出编辑", exact: true }).click();
  const confirmation = sibling.getByRole("dialog", { name: "这篇文档有未保存的修改。确认放弃修改并继续？", exact: true });
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await leave;
  await sibling.close();
  await append(a, "[原标签页继续编辑]\n");
  await expect.poll(serverText).toContain("[原标签页继续编辑]");
  await expect(editor(b)).toHaveValue(/\[原标签页继续编辑\]/u);
  check("同账号多标签页同步，退出其中一个后另一个仍可继续协作");
  const picture = new PNG({ width: 16, height: 16 }); picture.data.fill(255);
  await a.getByLabel("选择正文图片").setInputFiles({ name: "协作图片.png", mimeType: "image/png", buffer: PNG.sync.write(picture) });
  await expect(editor(b)).toHaveValue(/!\[协作图片.png\]\(\/api\/v1\/attachments\/[^)]+\/preview\)/u, { timeout: 15000 });
  assert.ok(!(await editor(b).inputValue()).includes("draft-image:"), "本机临时图片引用不得进入其他用户的草稿");
  await b.getByRole("button", { name: "预览", exact: true }).click();
  await expect.poll(() => b.locator(".md-editor-preview img").evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(16);
  check("图片先持久化后进入协作正文，另一用户可以预览和发布");
  await b.getByRole("button", { name: "编辑", exact: true }).click();
  const expected = await editor(b).inputValue();
  const publish = b.waitForResponse(response => response.url().endsWith(`/PAGE/${created.id}/publish`) && response.request().method() === "POST");
  await b.getByRole("button", { name: "保存修改", exact: true }).click();
  assert.equal((await publish).status(), 200);
  await expect(editor(b)).toHaveCount(0);
  assert.equal((await request(a, "GET", `/api/v1/pages/${created.id}`)).content, expected);
  await a.reload();
  await expect(a.locator(".wiki-reading-body")).toContainText("[丙离线二]");
  check("协作草稿发布后REST复读及刷新保持完整内容");
  assert.deepEqual(errors, []);
  check("完整多人及离线流程无未处理浏览器异常");
  await a.screenshot({ path: `${directory}/published.png`, fullPage: true });
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `${directory}/failure-${index}.png` }).catch(() => {});
  console.error(failure); process.exitCode = 1;
} finally {
  await writeFile(`${directory}/report.json`, JSON.stringify({ storageMode, checks, errors, failure }, null, 2));
  await browser.close(); await sql.end();
  console.log(`CRDT 浏览器验收 ${checks.length} 项；${failure ? "失败" : "全部通过"}`);
}
