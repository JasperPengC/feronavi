import "./_env.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import postgres from "postgres";

const database = new URL(process.env.DATABASE_URL);
if (!/^\/feronavi_test_[a-f0-9]+$/.test(database.pathname)) throw new Error("仅允许一次性隔离数据库");
const directory = resolve("docs/evidence/fullwidth-os-remediation-2026-11-17/shared-confirm");
await mkdir(directory, { recursive: true });
const sql = postgres(database.href, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const writes = [];
page.on("request", request => { if (request.method() === "DELETE" && new URL(request.url()).pathname.startsWith("/api/v1/tokens/")) writes.push(request.url()); });
const checks = [];
try {
  const [{ id }] = await sql`insert into api_token (member_id, name, token_hash, token_prefix, tier) select id, 'isolated-shared-confirm', 'isolated-confirm-unusable-token', 'confirm', 'READ_ONLY' from member where username = 'demo' returning id`;
  await page.goto(`${process.env.BASE}/login`);
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) })).status)).toBe(200);
  for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
    const locale = width === 390 ? "en-US" : "zh-CN";
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(async ({ theme, locale }) => {
      const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
      const response = await fetch("/api/v1/me/preferences", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ theme, locale }) });
      if (!response.ok) throw new Error(`偏好请求失败 ${response.status}`);
    }, { theme, locale });
    await page.goto(`${process.env.BASE}/tokens`);
    const row = page.getByRole("row").filter({ hasText: "isolated-shared-confirm" });
    const trigger = row.getByRole("button", { name: locale === "zh-CN" ? "吊销" : "Revoke", exact: true });
    await trigger.click();
    const dialog = page.locator(".modal-scrim").getByRole("dialog");
    await expect(dialog).toBeVisible(); await expect(dialog).toHaveCSS("opacity", "1");
    await expect(trigger).toHaveAttribute("aria-disabled", "true");
    const confirm = dialog.getByRole("button", { name: locale === "zh-CN" ? "确认" : "Confirm", exact: true });
    await expect(confirm).toBeFocused(); await expect(confirm).toHaveClass(/btn-danger/);
    const geometry = await dialog.boundingBox();
    expect(geometry.x).toBeGreaterThanOrEqual(0); expect(geometry.x + geometry.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: resolve(directory, `token-revoke-${width}-${theme}-${locale}.png`), fullPage: true });
    if (theme === "dark") await dialog.press("Escape");
    else await dialog.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-disabled", "false");
    expect(writes).toHaveLength(0);
    expect((await sql`select revoked_at from api_token where id = ${id}`)[0].revoked_at).toBeNull();
    checks.push({ width, theme, locale, cancelledBy: theme === "dark" ? "Escape" : "Cancel", geometry, writes: writes.length });
  }
  await writeFile(resolve(directory, "results.json"), JSON.stringify({ checks, deleteRequests: writes.length }, null, 2));
  console.log(`共享ConfirmButton真实浏览器验收通过：${checks.length}组合；取消/Escape回焦，0吊销请求；证据 ${directory}`);
} finally { await sql.end(); await context.close(); await browser.close(); }
