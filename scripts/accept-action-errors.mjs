import "./_env.ts";
/**
 * 操作失败路径 · 真实浏览器验收（前端统一化 Round 18）
 *
 * 补两类"此前只有代码级证据"的改动（Round 14/15 把它们的失败处理改成了 toast，但一直没做过浏览器断言）：
 *   ① 里程碑「归档」失败 → 出现 toast 错误，且**数据没有被改**（服务端 archived_at 仍为空）；
 *   ② 角色权限页「保存」失败 → 出现 toast 错误，且**角色名没有被改**。
 *
 * fixture 通过 postgres 直连插入/删除（里程碑 `__accept_ms__`、自定义角色 `__accept_role__`），跑完清理。
 */
import { chromium } from "playwright";
import postgres from "postgres";

const HOST = process.env.BASE;
const DATABASE_URL = process.env.DATABASE_URL;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};

const sql = postgres(DATABASE_URL, { max: 2 });
const FAIL500 = (route) => route.fulfill({ status: 500, contentType: "application/json",
  body: JSON.stringify({ code: "INTERNAL", message: "服务端故障（验收用）", details: null }) });

async function fixture() {
  const [{ id: projectId }] = await sql`select id from project order by created_at limit 1`;
  const [{ id: milestoneId }] = await sql`
    insert into milestone (project_id, name, due_date) values (${projectId}, '__accept_ms__ 验收里程碑', '2026-12-31') returning id`;
  const [{ id: roleId }] = await sql`
    insert into role (key, name) values ('__accept_role__', '验收自定义角色') returning id`;
  return { projectId, milestoneId, roleId };
}
async function cleanup() {
  await sql`delete from milestone where name like '__accept_ms__%'`;
  await sql`delete from role where key like '__accept_role__%'`;
}

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let fx;
try {
  await cleanup();
  fx = await fixture();
  await page.goto(HOST + "/login");
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
    });
  });

  // ① 里程碑归档失败 → toast，数据不变
  await page.goto(`${HOST}/projects/${fx.projectId}/milestones`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  const rowText = await page.evaluate(() => [...document.querySelectorAll("tbody tr")].map((r) => (r.textContent || "").trim().slice(0, 20)));
  check("里程碑 fixture 渲染在表格里", rowText.some((t) => t.includes("__accept_ms__")), JSON.stringify(rowText.slice(0, 3)));
  await page.route("**/api/v1/milestones/*/archive", FAIL500);
  const row = page.locator("tbody tr").filter({ hasText: "__accept_ms__" }).first();
  await row.getByRole("button", { name: "归档", exact: true }).click();
  await page.waitForTimeout(200);
  await row.getByRole("button", { name: "确认归档？", exact: true }).click();
  await page.waitForTimeout(1300);
  const msToast = await page.evaluate(() => [...document.querySelectorAll(".ui-toast")].map((e) => (e.textContent || "").trim()));
  const [{ archived_at }] = await sql`select archived_at from milestone where id = ${fx.milestoneId}`;
  check("里程碑归档失败 → toast 错误", msToast.some((t) => t.includes("服务端故障")), JSON.stringify(msToast));
  check("里程碑归档失败后数据没被改（archived_at 仍空）", archived_at === null, `archived_at=${archived_at}`);
  await page.screenshot({ path: "/tmp/accept-action-ms-failure.png" });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await cleanup();
  fx = await fixture();

  // ② 角色保存失败 → toast，角色名不变
  await page.goto(HOST + "/admin/roles", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2800);
  const roleRow = page.locator('[role="treeitem"][aria-level="2"]').filter({ hasText: "__accept_role__" }).first();
  check("自定义角色出现在左树", (await roleRow.count()) > 0);
  await roleRow.locator(".ui-tree-row").first().click();
  await page.waitForTimeout(600);
  const nameInput = page.getByLabel("角色名称");
  await nameInput.fill("验收改过的名字");
  await page.route("**/api/v1/roles/*", FAIL500);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1300);
  const roleToast = await page.evaluate(() => [...document.querySelectorAll(".ui-toast")].map((e) => (e.textContent || "").trim()));
  const [{ name: dbName }] = await sql`select name from role where id = ${fx.roleId}`;
  check("角色保存失败 → toast 错误", roleToast.some((t) => t.includes("服务端故障")), JSON.stringify(roleToast));
  check("角色保存失败后数据库名字没被改", dbName === "验收自定义角色", `name=${dbName}`);
  await page.screenshot({ path: "/tmp/accept-action-role-failure.png" });
} catch (e) {
  check("脚本完整执行", false, String(e).slice(0, 300));
  await page.screenshot({ path: "/tmp/accept-action-error.png" }).catch(() => {});
} finally {
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
  await cleanup().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
const ok = results.filter((r) => r.pass).length;
console.log(`\n  操作失败路径验收 ${ok}/${results.length}`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
