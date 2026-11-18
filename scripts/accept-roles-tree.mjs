import "./_env.ts";
/**
 * 角色与权限页 · 左树右内容真实验收（Round 12）
 *
 * 断言的是**页面真实行为**，不是代码：
 *   ① 角色树真的渲染（role=tree/treeitem、aria-level、初始展开）；
 *   ② 点选「只读访客」→ 右侧角色名与权限数跟着变（不是只有左边高亮）；
 *   ③ 键盘 ↓ 能移动选中项（a11y 承诺要能兑现）；
 *   ④ 折叠「内置角色」→ 子项真的消失、aria-expanded 变 false；
 *   ⑤ 每一步截图存档，失败也截图。
 */
import { chromium } from "playwright";

const HOST = process.env.BASE;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};

async function state(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="treeitem"]')].map((el) => ({
      level: el.getAttribute("aria-level"),
      expanded: el.getAttribute("aria-expanded"),
      selected: el.getAttribute("aria-selected"),
      text: (el.querySelector(".ui-tree-label")?.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    const selectedLabel = document.querySelector('.ui-tree-item[data-selected="true"] .ui-tree-label');
    const nameInput = document.querySelector(".ui-tree-layout-main input.input");
    const matrixCount = [...document.querySelectorAll(".ui-tree-layout-main .muted")]
      .map((el) => el.textContent || "").find((t) => /^\d+$/.test(t.trim()));
    return {
      tree: !!document.querySelector('.ui-tree [role="tree"]'),
      items, selectedText: selectedLabel ? selectedLabel.textContent.replace(/\s+/g, " ").trim() : null,
      nameValue: nameInput ? nameInput.value : null,
      nameDisabled: nameInput ? nameInput.disabled : null,
      matrixCount: matrixCount ? matrixCount.trim() : null,
    };
  });
}

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(HOST + "/login");
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
    });
  });
  await page.goto(HOST + "/admin/roles", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2800);

  // ① 树真的渲染了
  const s0 = await state(page);
  check("角色树渲染", s0.tree && s0.items.length >= 6, `treeitems=${s0.items.length}`);
  check("分组是 level 1", s0.items.filter((i) => i.level === "1").length === 2,
    `level1=${s0.items.filter((i) => i.level === "1").map((i) => i.text).join("/")}`);
  check("内置角色初始展开", s0.items.find((i) => i.text.startsWith("内置角色"))?.expanded === "true");
  check("默认选中管理员", s0.selectedText?.startsWith("管理员") === true, `选中=${s0.selectedText}`);
  await page.screenshot({ path: "/tmp/accept-roles-1-default.png" });

  // ② 点选「只读访客」——右侧必须跟着变
  //    注意：getByRole 的 name 是**子串**匹配，分组节点的可访问名包含所有子项文本，
  //    上一版就误点到了「内置角色」分组（真实验收又抓到一次）。这里按 aria-level 限定叶子。
  await page.locator('[role="treeitem"][aria-level="2"]').filter({ hasText: "只读访客" }).first().click();
  await page.waitForTimeout(700);
  const s1 = await state(page);
  check("点选后树内选中=只读访客", s1.selectedText?.startsWith("只读访客") === true, `选中=${s1.selectedText}`);
  check("右侧角色名跟随", s1.nameValue === "只读访客", `name=${s1.nameValue}`);
  check("权限数与角色一致(5)", s1.matrixCount === "5", `矩阵计数=${s1.matrixCount}`);
  check("内置角色名称只读", s1.nameDisabled === true);
  await page.screenshot({ path: "/tmp/accept-roles-2-guest.png" });

  // ③ 键盘 ↓ 移动选中项
  await page.locator('[role="treeitem"][aria-level="2"][aria-selected="true"]').first().focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(500);
  const s2 = await state(page);
  check("键盘 ↓ 移动选中", s2.selectedText !== s1.selectedText, `${s1.selectedText} → ${s2.selectedText}`);

  // ④ 点分组行 = 折叠（不是选中分组）→ 子项消失、且不出现「所选角色已不存在」
  const builtin = page.locator('[role="treeitem"][aria-level="1"]').filter({ hasText: "内置角色" }).first();
  await builtin.locator(".ui-tree-row").first().click();
  await page.waitForTimeout(500);
  const s3 = await state(page);
  const builtinNow = s3.items.find((i) => i.text.startsWith("内置角色"));
  const alert = await page.locator(".alert.alert-error").count();
  check("折叠后 aria-expanded=false", builtinNow?.expanded === "false");
  check("点分组不报「角色不存在」", alert === 0, `页面alert=${alert}`);
  check("折叠后子项隐藏", s3.items.length === s0.items.length - 4, `items=${s3.items.length}（原 ${s0.items.length}）`);
  await page.screenshot({ path: "/tmp/accept-roles-3-collapsed.png" });
} catch (e) {
  check("脚本完整执行", false, String(e).slice(0, 300));
  await page.screenshot({ path: "/tmp/accept-roles-error.png" }).catch(() => {});
}
const ok = results.filter((r) => r.pass).length;
console.log(`\n  角色树验收 ${ok}/${results.length}`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
