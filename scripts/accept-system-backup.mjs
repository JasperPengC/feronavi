import "./_env.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { chromium, expect } from "@playwright/test";
import {
  createIsolatedDatabase,
  prepareDatabase,
  runNode,
} from "../tests/support/isolated-database.ts";
import { startIsolatedApp } from "../tests/support/isolated-app.ts";
import { base32Decode, totp } from "../src/server/lib/totp.ts";

const evidence = resolve("docs/evidence/system-backup-restore");
const shared = process.env.FERONAVI_TEST_DIRECTORY;
const migrationPassword = "cross-db-migration-password-123";
const loginPassword = "synthetic-admin-password-123";
const controller = new AbortController();
const interrupt = () => {
  controller.abort();
  process.exitCode = 130;
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
const resources = [];
const apps = [];
const checks = [];
let browser,
  stage = "start";
const adminURL = new URL(process.env.DATABASE_URL);
adminURL.pathname = "/postgres";
process.env.TEST_DATABASE_ADMIN_URL = adminURL.toString();
const pass = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const safeError = (error) =>
  String(error?.message ?? error)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, "<redacted-uuid>")
    .replace(/[A-Za-z0-9_-]{24,}/gu, "<redacted-token>")
    .slice(0, 500);
const worker = async (database, phase) => {
  const result = await runNode(
    ["scripts/system-backup-browser-support.ts", ...(phase ? [phase] : [])],
    database.env,
    120_000,
    controller.signal,
    { terminationGraceMs: 1000 },
  );
  process.stdout.write(result.stdout);
  const workerLine = result.stdout
    .split("\n")
    .find((line) => line.startsWith("PASS real worker:"));
  if (workerLine) console.log(`WORKER_RESULT ${workerLine}`);
};
const makeDatabase = async (name) => {
  const database = await createIsolatedDatabase(controller.signal);
  resources.push(database);
  console.log(
    `INSTANCE browser-${name}: ${database.name}; independent DATA_DIR`,
  );
  await prepareDatabase(database, controller.signal, {
    terminationGraceMs: 1000,
  });
  return database;
};
const screenshot = async (page, name) => {
  const panel = page.locator(".sys-backup-panel");
  if (await panel.count()) {
    const region = name.includes("downloaded")
      ? panel.locator(".sys-backup-history")
      : name.includes("admin-rebuild")
        ? panel.locator(".sys-backup-rebuild")
        : panel.getByRole("heading", { name: "系统数据备份与恢复" });
    await region.scrollIntoViewIfNeeded();
  }
  const stableViewport = /^target-full-(upload|success)-390$/u.test(name);
  const image = await page.screenshot({
    path: join(evidence, "screenshots", `${name}.png`),
    fullPage: !stableViewport,
  });
  if (stableViewport) {
    assert.equal(image.readUInt32BE(16), 390, `${name}: PNG width`);
    assert.equal(image.readUInt32BE(20), 844, `${name}: PNG height`);
  }
};
const narrow = async (page, name) => {
  stage = `narrow.${name}.set-viewport`;
  await page.setViewportSize({ width: 390, height: 844 });
  const closeNavigation = page.getByRole("button", {
    name: "关闭导航",
    exact: true,
  });
  stage = `narrow.${name}.close-navigation`;
  if ((await closeNavigation.count()) > 0 && (await closeNavigation.isVisible())) {
    try {
      await closeNavigation.click({ timeout: 2_000 });
    } catch (error) {
      // 视口切换可能让按钮在可见性检查后卸载；消失即视为已关闭。
      if ((await closeNavigation.count()) > 0 && (await closeNavigation.isVisible()))
        throw error;
    }
  }
  stage = `narrow.${name}.overflow-check`;
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
  if (/^target-full-(upload|success)-390$/u.test(name)) {
    const topbars = page.locator(".setup-topbar");
    assert.equal(
      await topbars.count(),
      1,
      `${name}: expected one setup topbar`,
    );
    const bounds = await topbars.first().boundingBox();
    assert.ok(
      bounds && bounds.y >= 0 && bounds.height > 0,
      `${name}: stable topbar geometry`,
    );
  }
  stage = `narrow.${name}.stable-frame`;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  stage = `narrow.${name}.screenshot`;
  await screenshot(page, name);
  if (/^target-full-(upload|success)-390$/u.test(name)) {
    assert.equal(await page.locator(".product-mark:visible").count(), 1, `${name}: one visible product mark`);
    assert.equal(await page.locator(".public-display-controls:visible").count(), 1, `${name}: one visible display controls group`);
    const bounds = await page.locator(".setup-topbar").boundingBox();
    pass(`${name}: stable 390x844 PNG; one visible product mark/display controls; one setup topbar at y=${Math.round(bounds.y)}, height=${Math.round(bounds.height)}`);
  }
  const form = page.locator(".sys-backup-form");
  if (await form.count()) {
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(evidence, "screenshots", `${name}-form.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};
async function login(page, base, user, secret) {
  page.setDefaultTimeout(15_000);
  stage = `login.${user}.${secret ? "2fa" : "password"}`;
  await page.goto(`${base}/login`);
  await page.getByLabel(/^用户名/).fill(user);
  await page.getByLabel(/^密码/).fill(loginPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  if (secret) {
    await expect(
      page.getByLabel("双因素动态验证码", { exact: true }),
    ).toBeVisible();
    await page
      .locator('input[autocomplete="one-time-code"]')
      .fill(totp(base32Decode(secret)));
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}
async function request(page, path, method = "GET", body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = decodeURIComponent(
        document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "",
      );
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await response.json().catch(() => null);
      return { status: response.status, code: json?.code, json };
    },
    { path, method, body },
  );
}
try {
  await fs.mkdir(join(evidence, "screenshots"), { recursive: true });
  stage = "source.seed";
  const source = await makeDatabase("source");
  const seeded = await runNode(
    ["scripts/e2e-system-backup.ts", "source", shared],
    source.env,
    120_000,
    controller.signal,
    { terminationGraceMs: 1000 },
  );
  process.stdout.write(seeded.stdout);
  const scenario = JSON.parse(
    await fs.readFile(join(shared, "scenario.json"), "utf8"),
  );
  const sourceApp = await startIsolatedApp(source, {
    signal: controller.signal,
  });
  apps.push(sourceApp);
  browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    colorScheme: "light",
  });
  const page = await context.newPage();
  await login(page, sourceApp.baseURL, "migration_admin", scenario.totpSecret);
  await page.goto(`${sourceApp.baseURL}/system?tab=data`);
  const panel = page.locator(".sys-backup-panel");
  await expect(
    panel.getByRole("heading", { name: "系统数据备份与恢复" }),
  ).toBeVisible();
  await expect(panel.locator(".sys-backup-estimate")).toBeVisible();
  await expect(panel.getByLabel("备份模式", { exact: true })).toContainText(
    "安全迁移",
  );
  pass(
    "administrator entry; safe default; real dataset estimate and exclusions",
  );
  const modeSelect = panel.getByLabel("备份模式", { exact: true });
  await modeSelect.focus();
  await page.keyboard.press("Tab");
  await expect(panel.getByLabel("独立迁移密码", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel.getByLabel("确认迁移密码", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    panel.getByLabel("当前管理员密码", { exact: true }),
  ).toBeFocused();
  assert.equal((await panel.locator('[aria-live="polite"]').count()) > 0, true);
  pass("keyboard focus order; labelled credentials; polite live estimate");
  await screenshot(page, "source-safe-desktop");
  await narrow(page, "source-safe-390");
  const packages = {};
  for (const mode of ["safe", "full"]) {
    stage = `source.${mode}.create`;
    if (mode === "full") {
      await modeSelect.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(panel.locator(".sys-backup-risk")).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "创建加密备份" }),
      ).toBeDisabled();
      await panel.getByRole("checkbox").check();
      pass(
        "full explicit keyboard selection; risk warning; required confirmation",
      );
    }
    const create = panel.getByRole("button", {
      name: mode === "safe" ? "创建安全备份" : "创建加密备份",
      exact: true,
    });
    stage = `source.${mode}.create.missing-password`;
    await panel.getByLabel("独立迁移密码", { exact: true }).fill("short");
    stage = `source.${mode}.create.fill-password`;
    await panel.getByLabel("确认迁移密码", { exact: true }).fill("short");
    await panel
      .getByLabel("当前管理员密码", { exact: true })
      .fill(loginPassword);
    await create.click();
    await expect(panel.getByRole("alert")).toContainText(/12/);
    stage = `source.${mode}.create.mismatch-password`;
    await panel
      .getByLabel("独立迁移密码", { exact: true })
      .fill(migrationPassword);
    await panel
      .getByLabel("确认迁移密码", { exact: true })
      .fill("mismatched-password");
    await create.click();
    await expect(panel.getByRole("alert")).toContainText(/一致/);
    stage = `source.${mode}.create.totp-fill`;
    await panel
      .getByLabel("确认迁移密码", { exact: true })
      .fill(migrationPassword);
    await panel
      .locator('input[autocomplete="one-time-code"]')
      .fill(totp(base32Decode(scenario.totpSecret)));
    stage = `source.${mode}.create.waiting-response`;
    const createdResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/system/backups") &&
        r.request().method() === "POST",
    );
    stage = `source.${mode}.create.click`;
    await create.click();
    stage = `source.${mode}.create.await-response`;
    const response = await createdResponse;
    const responseBody = await response.json().catch(() => null);
    const responseCode =
      responseBody && typeof responseBody.code === "string"
        ? responseBody.code
        : "none";
    console.log(`CREATE_RESPONSE status=${response.status()} code=${responseCode}`);
    assert.equal(response.status(), 201);
    const { id } = responseBody;
    await expect(panel.getByLabel("独立迁移密码", { exact: true })).toHaveValue(
      "",
    );
    await expect(panel.getByRole("status")).toContainText(/提交/);
    await worker(source, "backup");
    const row = panel.locator(".sys-backup-history-row").filter({
      has: page.getByRole("button", { name: `删除备份 ${id}`, exact: true }),
    });
    try {
      await expect(row.getByRole("button", { name: "下载备份包" })).toBeEnabled({
        timeout: 15_000,
      });
    } catch (error) {
      const state = await request(page, "/api/v1/system/backups");
      console.error(
        `BACKUP_CREATE_DIAGNOSTIC ${JSON.stringify({
          mode,
          apiStatus: state.status,
          backups: Array.isArray(state.json?.backups)
            ? state.json.backups.map((backup) => ({
                status: backup.status,
                failureCode: backup.failureCode,
                bytes: backup.bytes,
                downloadsRemaining: backup.downloadsRemaining,
              }))
            : state.json,
          rows: (await panel.locator(".sys-backup-history-row").allTextContents())
            .map((text) => text.slice(0, 500)),
          error: safeError(error),
        })}`,
      );
      throw error;
    }
    const downloading = page.waitForEvent("download");
    await row.getByRole("button", { name: "下载备份包" }).click();
    const download = await downloading;
    assert.equal(
      download.suggestedFilename(),
      `feronavi-system-backup-${id}.fnbak`,
    );
    packages[mode] = join(shared, `browser-${mode}.fnbak`);
    await download.saveAs(packages[mode]);
    await expect(
      row.locator("p").filter({ hasText: "剩余下载次数：4" }),
    ).toBeVisible();
    await screenshot(page, `source-${mode}-downloaded`);
    await row
      .getByRole("button", { name: `删除备份 ${id}`, exact: true })
      .click();
    await expect(row).toHaveCount(0);
    pass(
      `${mode}: UI password validation/create/poll/download filename/remaining count/delete; real worker`,
    );
  }

  stage = "source.member";
  const memberContext = await browser.newContext({ locale: "zh-CN" });
  const memberPage = await memberContext.newPage();
  await login(memberPage, sourceApp.baseURL, "migration_member");
  await memberPage.goto(`${sourceApp.baseURL}/system?tab=data`);
  await expect(memberPage.locator(".sys-backup-panel")).toHaveCount(0);
  assert.equal(
    (await request(memberPage, "/api/v1/system/backups")).status,
    403,
  );
  pass("ordinary member: entry hidden; server backup permission denied");
  await memberContext.close();

  for (const mode of ["safe", "full"]) {
    stage = `target.${mode}.start`;
    const target = await makeDatabase(`${mode}-target`);
    // 同HEAD客户端/服务端只构建一次，复制的是测试临时产物。
    for (const dir of ["dist", "dist-server"])
      await fs.cp(join(source.directory, dir), join(target.directory, dir), {
        recursive: true,
      });
    const app = await startIsolatedApp(target, {
      skipBuild: true,
      signal: controller.signal,
    });
    apps.push(app);
    const targetContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      colorScheme: "light",
    });
    const targetPage = await targetContext.newPage();
    await targetPage.goto(`${app.baseURL}/setup`);
    await targetPage.getByRole("radio", { name: /从系统备份恢复/ }).click();
    const restoreBounds = await targetPage
      .locator(".setup-restore-body")
      .boundingBox();
    assert.ok(restoreBounds.width > 600, "桌面恢复内容不应被向导侧栏列压缩");
    await expect(
      targetPage.getByRole("heading", { name: "从系统备份恢复" }),
    ).toBeVisible();
    assert.equal(
      (await request(targetPage, "/api/v1/system/backups", "POST", {})).status,
      403,
    );
    await targetPage.getByLabel("选择系统备份", { exact: true }).focus();
    await targetPage.keyboard.press("Tab");
    await expect(
      targetPage.getByLabel("迁移密码", { exact: true }),
    ).toBeFocused();
    assert.equal(
      await targetPage.locator('.setup-restore[aria-live="polite"]').count(),
      1,
    );
    await narrow(targetPage, `target-${mode}-upload-390`);
    const upload = async (password) => {
      await targetPage
        .getByLabel("选择系统备份", { exact: true })
        .setInputFiles(packages[mode]);
      await targetPage.getByLabel("迁移密码", { exact: true }).fill(password);
      await targetPage
        .getByRole("button", { name: "上传并检查", exact: true })
        .click();
    };
    if (mode === "safe") {
      stage = "target.safe.wrong-password";
      await upload("incorrect-migration-password");
      await expect(
        targetPage.getByRole("heading", { name: "恢复失败" }),
      ).toBeVisible();
      await expect(targetPage.getByRole("alert")).toBeVisible();
      await screenshot(targetPage, "target-safe-wrong-password");
      await targetPage.getByRole("button", { name: "重新开始" }).click();
      await expect(
        targetPage.getByLabel("迁移密码", { exact: true }),
      ).toHaveValue("");
      pass(
        "wrong password rejected; failed upload cleaned; new file/password retry",
      );
    }
    stage = `target.${mode}.preflight`;
    await upload(migrationPassword);
    await expect(
      targetPage.getByLabel("确认短语", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(targetPage.locator(".setup-restore-summary")).toContainText(
      mode === "safe" ? "安全模式" : "完整模式",
    );
    await expect(targetPage.locator(".setup-restore-summary")).toContainText(
      "0.1.0",
    );
    await expect(
      targetPage.getByRole("button", { name: "开始恢复", exact: true }),
    ).toBeDisabled();
    await screenshot(targetPage, `target-${mode}-preflight-desktop`);
    await narrow(targetPage, `target-${mode}-preflight-390`);
    await targetPage.getByLabel("确认短语", { exact: true }).fill("恢复此实例");
    await targetPage
      .getByRole("button", { name: "开始恢复", exact: true })
      .click();
    await expect(targetPage.getByRole("status")).toContainText(/恢复/);
    await screenshot(targetPage, `target-${mode}-restoring`);
    await worker(target);
    if (mode === "safe") await worker(target, "rebuild-failure");
    else await worker(target);
    await expect(
      targetPage.getByRole("heading", { name: "业务恢复成功" }),
    ).toBeVisible({ timeout: 25_000 });
    await screenshot(targetPage, `target-${mode}-success-desktop`);
    await narrow(targetPage, `target-${mode}-success-390`);
    const denied = await request(
      targetPage,
      "/api/v1/system/restores/00000000-0000-4000-8000-000000000000/rebuild/retry",
      "POST",
      {},
    );
    console.log(
      `OWNER_PERMISSION observation: status=${denied.status}; code=${denied.code}`,
    );
    assert.equal(denied.status, 403);
    pass(
      `${mode}: owner session read-only after success; no administrator write permission`,
    );
    await targetPage.getByRole("link", { name: "前往登录" }).click();
    await login(
      targetPage,
      app.baseURL,
      "migration_admin",
      mode === "full" ? scenario.totpSecret : undefined,
    );
    await targetPage.goto(`${app.baseURL}/system?tab=data`);
    if (mode === "safe") {
      await expect(
        targetPage.getByRole("button", { name: "重试索引重建" }),
      ).toBeEnabled();
      await screenshot(targetPage, "target-safe-admin-rebuild-failed");
      await targetPage.getByRole("button", { name: "重试索引重建" }).click();
      await worker(target);
      await expect(targetPage.locator(".sys-backup-rebuild")).toContainText(
        "索引重建完成",
        { timeout: 15_000 },
      );
      await screenshot(targetPage, "target-safe-admin-rebuild-retried");
      pass(
        "business login survives real rebuild failure; administrator system page retries actual worker to success",
      );
    }
    const targetSql = postgres(target.url, { max: 1 });
    try {
      for (const table of [
        "member",
        "project",
        "work_item",
        "comment",
        "page",
        "page_revision",
        "attachment",
      ]) {
        const [count] =
          await targetSql`select count(*)::int n from ${targetSql(table)}`;
        const expected =
          scenario.rows[mode][
            Object.keys(scenario.rows[mode]).find((name) =>
              name.endsWith(`.${table}`),
            )
          ];
        assert.ok(expected, `数据集存在: ${table}`);
        assert.equal(count.n, expected.length);
      }
      const [attachment] =
        await targetSql`select storage_path,storage_backend from attachment limit 1`;
      assert.equal(attachment.storage_backend, "local");
      const bytes = await fs.readFile(
        join(target.env.ATTACHMENT_DIR, attachment.storage_path),
      );
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        createHash("sha256")
          .update(Buffer.from("Synthetic cross-database attachment v1\n"))
          .digest("hex"),
      );
    } finally {
      await targetSql.end();
    }
    pass(
      `${mode}: actual source-account UI login; business row counts and restored attachment SHA256`,
    );
    // 已初始化目标的setup UI跳转，并且恢复写接口明确拒绝。
    await targetPage.goto(`${app.baseURL}/setup`);
    await expect(
      targetPage.getByRole("radio", { name: /从系统备份恢复/ }),
    ).toHaveCount(0);
    assert.equal(
      (await request(targetPage, "/api/v1/setup/restore/bootstrap", "POST", {}))
        .status,
      403,
    );
    pass(
      `${mode}: occupied target UI cannot offer restore; server rejects new restore`,
    );
    await targetContext.close();
  }
  await fs.writeFile(
    join(evidence, "browser-matrix.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        checks,
        screenshotFiles: (
          await fs.readdir(join(evidence, "screenshots"))
        ).filter((f) => f.endsWith(".png")),
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS system backup browser acceptance: ${checks.length} grouped checks; real source/safe/full target UI`,
  );
} catch (error) {
  for (const context of browser?.contexts() ?? []) {
    const page = context.pages().at(-1);
    if (page && !page.isClosed()) {
      await page
        .addStyleTag({
          content:
            "input { color: transparent !important; text-shadow:none !important; }",
        })
        .catch(() => {});
      await screenshot(page, "failure-last-observed").catch(() => {});
      const details = await page
        .locator('[role="alert"]')
        .allTextContents()
        .catch(() => []);
      console.error(
        JSON.stringify({
          stage,
          alertCodes: details.map((value) =>
            /双因素/.test(value)
              ? "TWO_FACTOR_REQUIRED"
              : /密码|账号/.test(value)
                ? "AUTH_ERROR"
                : "OTHER_ALERT",
          ),
          pathname: new URL(page.url()).pathname,
        }),
      );
    }
  }
  console.error(
    JSON.stringify({
      stage,
      category: error?.name ?? "Error",
      errorMessage: safeError(error),
      actual: typeof error?.actual === "number" ? error.actual : undefined,
      expected:
        typeof error?.expected === "number" ? error.expected : undefined,
      code: /^[A-Z0-9_]+$/.test(error?.code ?? "")
        ? error.code
        : "BROWSER_ASSERTION",
    }),
  );
  if (process.exitCode !== 130) process.exitCode = 1;
} finally {
  await browser?.close();
  for (const app of apps.reverse()) await app.stop();
  for (const database of resources.reverse()) {
    await database.cleanup();
    console.log(`CLEANED browser instance ${database.name}`);
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
