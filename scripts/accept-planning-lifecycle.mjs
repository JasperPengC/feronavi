import "./_env.ts";
/** 计划生命周期界面验收：真实 API 自建数据，完整检查结转、结束、归档与恢复。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import postgres from "postgres";

const BASE = process.env.BASE;
const marker = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const projectIds = [], fixtureIds = [];
const screenshots = ".cache/planning-lifecycle";
let browser, ctx, page, csrfToken = "", checks = 0;
const check = async (name, assertion) => { await assertion(); checks++; console.log(`  ✓ ${name}`); };

async function api(path, method = "GET", body) {
  const response = await ctx.request.fetch(`${BASE}/api/v1${path}`, {
    method, headers: { "x-csrf-token": csrfToken }, ...(body === undefined ? {} : { data: body }),
  });
  const result = await response.json();
  assert.notEqual(response.status(), 429, `接口限流，停止本轮：${path}`);
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(result)}`);
  if (method === "POST" && result.id) fixtureIds.push(result.id);
  return result;
}

async function finishTask(id) {
  for (const toStateKey of ["IN_PROGRESS", "DONE"]) {
    const detail = await api(`/work-items/${id}`);
    assert.ok(detail.allowedTransitions.some(edge => edge.toStateKey === toStateKey), `任务应允许流转至 ${toStateKey}`);
    await api(`/work-items/${id}/transition`, "POST", { version: detail.version, toStateKey });
  }
}

const row = (panel, name) => panel.locator(".plan-entity-list > li").filter({ has: page.getByText(name, { exact: true }) });
async function archiveAndRestore(panel, name, kind, id) {
  const completed = await api(`/${kind}s/${id}`);
  await row(panel, name).getByRole("button", { name: "归档", exact: true }).click();
  await page.getByRole("dialog", { name: "确认归档？" }).getByRole("button", { name: "确认", exact: true }).click();
  await expect(row(panel, name)).toHaveCount(0);
  await panel.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(row(panel, name)).toBeVisible();
  await check(`${kind} 归档后真实回读并显示在归档列表`, async () => assert.ok((await api(`/${kind}s/${id}`)).archivedAt));
  await expect(row(panel, name).getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await row(panel, name).getByRole("button", { name: "恢复", exact: true }).click();
  await expect(row(panel, name)).toHaveCount(0);
  await panel.getByRole("button", { name: "当前", exact: true }).click();
  await expect(row(panel, name)).toBeVisible();
  await check(`${kind} 恢复后保留完成时间和结转记录`, async () => {
    const restored = await api(`/${kind}s/${id}`);
    assert.equal(restored.archivedAt, null);
    assert.equal(restored.completedAt, completed.completedAt);
    assert.deepEqual(restored.completionResult, completed.completionResult);
    await expect(row(panel, name).getByText("已完成", { exact: true })).toBeVisible();
  });
}

try {
  await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ channel: "chrome" });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "zh-CN", colorScheme: "light" });
  await ctx.addInitScript(() => localStorage.setItem("feronavi_locale", "zh-CN"));
  await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: new URL(BASE).hostname, path: "/" }]);
  page = await ctx.newPage();
  const login = await ctx.request.post(`${BASE}/api/v1/auth/login`, { data: { username: "demo", password: "demo-password-12345" } });
  assert.ok(login.ok(), `登录失败：${login.status()}`);
  csrfToken = decodeURIComponent((await login.json()).csrfToken);
  const project = await api("/projects", "POST", { key: `LC${marker}`, name: `生命周期界面验收 ${marker}` });
  projectIds.push(project.id);
  const other = await api("/projects", "POST", { key: `LF${marker}`, name: `结转隔离项目 ${marker}` });
  projectIds.push(other.id);
  const createIteration = (name, projectId = project.id) => api(`/projects/${projectId}/iterations`, "POST", { name, startDate: "2026-11-19", endDate: "2026-11-30", carryOver: true });
  const source = await createIteration("本轮迭代");
  const target = await createIteration("下轮迭代");
  const completed = await createIteration("已结束目标");
  const archived = await createIteration("已归档目标");
  await createIteration("其他项目目标", other.id);
  await api(`/iterations/${completed.id}/complete`, "POST", {});
  await api(`/iterations/${archived.id}/complete`, "POST", {});
  await api(`/iterations/${archived.id}/archive`, "POST", {});
  const pending = await api(`/projects/${project.id}/work-items`, "POST", { type: "TASK", title: "应结转的任务", iterationId: source.id });
  const terminal = await api(`/projects/${project.id}/work-items`, "POST", { type: "TASK", title: "应保留的已完成任务", iterationId: source.id });
  await finishTask(terminal.id);
  const release = await api(`/projects/${project.id}/releases`, "POST", { name: "待完成版本", versionTag: "v1.0.0" });
  const releaseTask = await api(`/projects/${project.id}/work-items`, "POST", { type: "TASK", title: "阻止版本完成的任务", releaseId: release.id });

  await page.goto(`${BASE}/projects/${project.id}/milestones`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "迭代", exact: true }).click();
  const iterations = page.locator("#planning-panel-iteration");
  await expect(row(iterations, source.name)).toBeVisible();
  await row(iterations, source.name).getByRole("button", { name: "结束迭代", exact: true }).click();
  const completion = page.getByRole("dialog", { name: `结束迭代 · ${source.name}` });
  await check("存在未完成工作项时必须先选择目标", async () => {
    await expect(completion.getByText("未完成工作项：1", { exact: true })).toBeVisible();
    await expect(completion.getByRole("button", { name: "结束迭代", exact: true })).toBeDisabled();
  });
  await completion.getByRole("button", { name: "结转目标迭代", exact: true }).click();
  await check("目标排除自身、已完成、已归档和其他项目迭代", async () => {
    for (const name of [source.name, completed.name, archived.name, "其他项目目标"]) await expect(page.getByRole("option", { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: target.name, exact: true })).toBeVisible();
  });
  await page.getByRole("option", { name: target.name, exact: true }).click();
  await page.screenshot({ path: `${screenshots}/iteration-completion.png`, fullPage: true });
  await completion.getByRole("button", { name: "结束迭代", exact: true }).click();
  await expect(completion).toHaveCount(0);
  await check("结束后只结转未完成工作项并刷新列表", async () => {
    const after = await api(`/iterations/${source.id}`);
    assert.ok(after.completedAt);
    assert.equal(after.pendingWorkItemCount, 0);
    assert.equal(after.completionResult.movedCount, 1);
    assert.equal(after.completionResult.targetIterationId, target.id);
    assert.deepEqual(after.completionResult.movedWorkItemIds, [pending.id]);
    assert.equal((await api(`/work-items/${pending.id}`)).iterationId, target.id);
    assert.equal((await api(`/work-items/${terminal.id}`)).iterationId, source.id);
    await expect(row(iterations, source.name).getByText("已完成", { exact: true })).toBeVisible();
  });
  await archiveAndRestore(iterations, source.name, "iteration", source.id);

  await page.getByRole("tab", { name: "版本", exact: true }).click();
  const releases = page.locator("#planning-panel-release");
  await row(releases, release.name).getByRole("button", { name: "完成版本", exact: true }).click();
  const releaseDialog = page.getByRole("dialog", { name: `完成版本 · ${release.name}` });
  await releaseDialog.getByRole("button", { name: "完成版本", exact: true }).click();
  await check("版本被未完成工作项阻止时保留抽屉并显示真实原因", async () => {
    await expect(releaseDialog.getByRole("alert")).toHaveText("版本仍有未完成工作项");
    assert.equal((await api(`/releases/${release.id}`)).completedAt, null);
  });
  await page.screenshot({ path: `${screenshots}/release-blocked.png`, fullPage: true });
  await finishTask(releaseTask.id);
  await releaseDialog.getByRole("button", { name: "完成版本", exact: true }).click();
  await expect(releaseDialog).toHaveCount(0);
  await check("处理工作项后可在原抽屉重试完成版本", async () => {
    const after = await api(`/releases/${release.id}`);
    assert.ok(after.completedAt);
    assert.equal(after.pendingWorkItemCount, 0);
    assert.equal((await api(`/work-items/${releaseTask.id}`)).releaseId, release.id);
    await expect(row(releases, release.name).getByText("已完成", { exact: true })).toBeVisible();
  });
  await archiveAndRestore(releases, release.name, "release", release.id);
  await page.screenshot({ path: `${screenshots}/release-restored.png`, fullPage: true });
  console.log(`计划生命周期界面验收 ${checks}/${checks}`);
} catch (error) {
  process.exitCode = 1;
  console.error(error);
  if (page) await page.screenshot({ path: `${screenshots}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  if (browser) await browser.close();
  try {
    if (fixtureIds.length) await sql`delete from audit_entry where target_id in ${sql([...new Set(fixtureIds)])}`;
    for (const projectId of projectIds) await sql`delete from project where id = ${projectId}`;
  } catch (error) { process.exitCode = 1; console.error("验收数据清理失败", error.message); }
  await sql.end();
}
