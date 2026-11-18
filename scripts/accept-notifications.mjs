import "./_env.ts";
/**
 * 通知流程 · 真实浏览器验收（前端统一化 Round 18）
 *
 * 为什么单独做：Round 14/17 改过通知铃铛与通知中心的组件与错误处理，但一直**没有交互用例**
 * （如实记录过）。本轮补齐：
 *   ① 未读徽标与 aria-label 的数量来自服务端真实数据（自己插 fixture、跑完删除）；
 *   ② 点铃铛 → 浮层列出未读 → 点「标为已读」→ **服务端** unreadCount 真的减 1（不是只看前端）；
 *   ③ 失败路径：把 `POST /api/v1/notifications/read` 拦成 500 → 出现 toast 错误提示，
 *      且**未读状态不变**（此前失败是静默的，本轮补了 onError 才可断言）；
 *   ④ 通知中心「全部标为已读」同样守一遍失败路径。
 *
 * fixture 用 postgres 直连插入/清理（标题带 `__accept_notif__` 前缀，跑完删干净）。
 */
import { chromium } from "playwright";
import postgres from "postgres";

const HOST = process.env.BASE;
const DATABASE_URL = process.env.DATABASE_URL;
const MARK = "__accept_notif__";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};

const sql = postgres(DATABASE_URL, { max: 2 });

async function seed(count) {
  const [{ id }] = await sql`select id from member where username = 'demo'`;
  for (let i = 0; i < count; i++) {
    await sql`insert into notification (recipient_id, type, category, title, body)
              values (${id}, 'ACCEPT', 'MENTION', ${MARK + " 验收通知 " + i}, '用于验收通知交互')`;
  }
}
async function cleanup() {
  await sql`delete from notification where title like ${MARK + "%"}`;
}
async function unreadFromServer(page) {
  return page.evaluate(async () => (await (await fetch("/api/v1/notifications")).json()).unreadCount);
}

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await cleanup();
  await page.goto(HOST + "/login");
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
    });
  });

  // ① 徽标数量来自真实未读数
  await seed(2);
  await page.goto(HOST + "/workbench", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  const start = await unreadFromServer(page);
  const badge = await page.evaluate(() => ({
    label: document.querySelector(".notification-trigger")?.getAttribute("aria-label"),
    text: document.querySelector(".notification-count")?.textContent?.trim(),
  }));
  check("未读数来自真实数据（≥2）", start >= 2, `server unread=${start}`);
  check("铃铛徽标与 aria-label 一致", badge.text === String(start) && (badge.label || "").includes(String(start)), JSON.stringify(badge));

  // ② 点铃铛 → 标为已读 → 服务端真减 1
  await page.locator(".notification-trigger").first().click();
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => ({
    dialog: !!document.querySelector(".notification-popover"),
    unreadRows: [...document.querySelectorAll(".notification-item[data-unread='true']")].length,
  }));
  check("点铃铛打开浮层且列出未读", before.dialog && before.unreadRows >= 2, JSON.stringify(before));
  await page.screenshot({ path: "/tmp/accept-notif-1-popover.png" });
  await page.locator(".notification-popover").getByRole("button", { name: "标为已读" }).first().click();
  await page.waitForTimeout(1200);
  const afterRead = await unreadFromServer(page);
  check("「标为已读」后服务端未读数减 1", afterRead === start - 1, `${start} → ${afterRead}`);

  // ③ 失败路径：拦 500 → toast + 未读不变
  await seed(1);
  await page.keyboard.press("Escape");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/v1/notifications/read", (route) =>
    route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ code: "INTERNAL", message: "服务端故障（验收用）", details: null }) }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  const beforeFail = await unreadFromServer(page);
  await page.locator(".notification-trigger").first().click();
  await page.waitForTimeout(600);
  await page.locator(".notification-popover").getByRole("button", { name: "标为已读" }).first().click();
  await page.waitForTimeout(1200);
  const failToast = await page.evaluate(() => [...document.querySelectorAll(".ui-toast")].map((e) => (e.textContent || "").trim()));
  const afterFail = await unreadFromServer(page);
  check("失败路径出现 toast 错误", failToast.some((t) => t.includes("服务端故障")), JSON.stringify(failToast));
  check("失败后未读数不变（没有假装成功）", afterFail === beforeFail, `${beforeFail} → ${afterFail}`);
  await page.screenshot({ path: "/tmp/accept-notif-2-failure.png" });

  // ④ 通知中心：全部标为已读失败路径
  await page.goto(HOST + "/notifications", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  const beforeAll = await unreadFromServer(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/v1/notifications/read", (route) =>
    route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ code: "INTERNAL", message: "服务端故障（验收用）", details: null }) }));
  await page.getByRole("button", { name: "全部标为已读", exact: true }).click();
  await page.waitForTimeout(1200);
  const allToast = await page.evaluate(() => [...document.querySelectorAll(".ui-toast")].map((e) => (e.textContent || "").trim()));
  const afterAll = await unreadFromServer(page);
  check("通知中心失败路径出现 toast", allToast.some((t) => t.includes("服务端故障")), JSON.stringify(allToast));
  check("通知中心失败后未读数不变", afterAll === beforeAll, `${beforeAll} → ${afterAll}`);
  await page.screenshot({ path: "/tmp/accept-notif-3-page-failure.png" });
} catch (e) {
  check("脚本完整执行", false, String(e).slice(0, 300));
  await page.screenshot({ path: "/tmp/accept-notif-error.png" }).catch(() => {});
} finally {
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
  await cleanup().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
const ok = results.filter((r) => r.pass).length;
console.log(`\n  通知流程验收 ${ok}/${results.length}`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
