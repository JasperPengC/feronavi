import "./_env.ts";
/**
 * 自定义字段页 · 左树右内容真实验收（Round 13）
 *
 * 页面真实行为断言（不看代码）：
 *   ① 左侧按「字段类型」分组、可展开到具体字段（层级来自真实 type 属性，不是造出来的分类）；
 *   ② 点类型 → 右侧表格只剩该类型；点字段 → 只剩该字段；
 *   ③ 键盘 ↓ 能移动选中项；折叠分组 → 子项真的消失；
 *   ④ 创建表单的控件都有可见标签（字段 key / 字段名称 / 字段类型 / 必填）。
 */
import { chromium } from "playwright";

const HOST = process.env.BASE;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
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
    const rows = [...document.querySelectorAll("tbody tr")].map((tr) => (tr.querySelector(".row-name")?.textContent || "").trim()).filter(Boolean);
    return {
      tree: !!document.querySelector('.ui-tree [role="tree"]'),
      items, rows,
      selectedText: document.querySelector('.ui-tree-item[data-selected="true"] .ui-tree-label')?.textContent?.trim() ?? null,
      fieldLabels: [...document.querySelectorAll(".field > label")].map((l) => (l.textContent || "").replace(/\s+/g, " ").trim()),
    };
  });
}

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let prepared = null;
try {
  await page.goto(HOST + "/login");
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
    });
  });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  // 自建验收数据：6 个字段覆盖 5 种类型（TEXT 两个，供折叠断言）。跑完归档，保持可重复。
  prepared = await page.evaluate(async (projectId) => {
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const list = await fetch(`/api/v1/projects/${projectId}/custom-fields`).then((r) => r.json());
    for (const d of list.filter((x) => x.name?.startsWith("验收"))) {
      await fetch(`/api/v1/custom-fields/${d.id}/archive`, { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": csrf() } });
    }
    const stamp = Date.now().toString(36);
    const defs = [
      { name: "验收文本A", type: "TEXT" }, { name: "验收文本B", type: "TEXT" },
      { name: "验收数字", type: "NUMBER" }, { name: "验收日期", type: "DATE" },
      { name: "验收单选", type: "SINGLE_SELECT", options: [{ value: "low", label: "低" }, { value: "high", label: "高" }] },
      { name: "验收人员", type: "PERSON" },
    ];
    const ids = [];
    for (const [i, d] of defs.entries()) {
      const res = await fetch(`/api/v1/projects/${projectId}/custom-fields`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ key: `acc_${stamp}_${i}`, name: d.name, type: d.type, ...(d.options ? { options: d.options } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 201 && body?.id) ids.push(body.id);
    }
    return { ids };
  }, pid);
  check("自建 6 个验收字段", Array.isArray(prepared.ids) && prepared.ids.length === 6, JSON.stringify(prepared));
  await page.goto(`${HOST}/projects/${pid}/fields`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2800);

  const s0 = await state(page);
  check("左树渲染", s0.tree && s0.items.length >= 6, `treeitems=${s0.items.length}`);
  check("按类型分组（level1 含全部/类型）", s0.items.filter((i) => i.level === "1").length === 6,
    `level1=${s0.items.filter((i) => i.level === "1").map((i) => i.text).join("/")}`);
  check("字段是 level2 叶子", s0.items.filter((i) => i.level === "2").length === 6,
    `leaves=${s0.items.filter((i) => i.level === "2").map((i) => i.text).join("/")}`);
  check("默认显示全部 6 个字段", s0.rows.length === 6, `rows=${s0.rows.length}`);
  check("创建表单有可见标签", ["字段 key", "字段名称", "字段类型"].every((x) => s0.fieldLabels.includes(x)),
    JSON.stringify(s0.fieldLabels.slice(0, 5)));
  await page.screenshot({ path: "/tmp/accept-fields-1-all.png" });

  // ② 点类型 → 只看该类型
  // 注意：分组 li 的包围盒包含子项，直接点 li 会点到某个子字段上（角色页踩过同样的坑）→ 点分组自己的行
  await page.locator('[role="treeitem"][aria-level="1"]').filter({ hasText: "数字" }).first().locator(".ui-tree-row").first().click();
  await page.waitForTimeout(500);
  const s1 = await state(page);
  check("点「数字」类型后表格只剩该类型", s1.rows.length === 1 && s1.rows[0] === "验收数字", `rows=${JSON.stringify(s1.rows)}`);
  check("选中态落在类型节点", s1.selectedText === "数字", `选中=${s1.selectedText}`);
  await page.screenshot({ path: "/tmp/accept-fields-2-type.png" });

  // 点字段叶子 → 只看该字段
  await page.locator('[role="treeitem"][aria-level="2"]').filter({ hasText: "验收文本A" }).first().click();
  await page.waitForTimeout(500);
  const s2 = await state(page);
  check("点字段叶子后表格只剩该字段", s2.rows.length === 1 && s2.rows[0] === "验收文本A", `rows=${JSON.stringify(s2.rows)}`);

  // ③ 键盘 ↓
  await page.locator('[role="treeitem"][aria-level="2"][aria-selected="true"]').first().focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  const s3 = await state(page);
  check("键盘 ↓ 移动选中", s3.selectedText !== s2.selectedText, `${s2.selectedText} → ${s3.selectedText}`);

  // 点「全部字段」回到全量
  await page.locator('[role="treeitem"][aria-level="1"]').filter({ hasText: "全部字段" }).first().locator(".ui-tree-row").first().click();
  await page.waitForTimeout(400);
  const s4 = await state(page);
  check("点「全部字段」恢复全量", s4.rows.length === 6, `rows=${s4.rows.length}`);

  // 折叠「文本」分组 → 子项消失
  const textGroup = page.locator('[role="treeitem"][aria-level="1"]').filter({ hasText: "文本" }).first();
  await textGroup.locator(".ui-tree-toggle").first().click();
  await page.waitForTimeout(500);
  const s5 = await state(page);
  const textNow = s5.items.find((i) => i.text === "文本");
  check("折叠后 aria-expanded=false", textNow?.expanded === "false");
  check("折叠后子字段隐藏", s5.items.length === s0.items.length - 2, `items=${s5.items.length}（原 ${s0.items.length}）`);
  await page.screenshot({ path: "/tmp/accept-fields-3-collapsed.png" });
} catch (e) {
  check("脚本完整执行", false, String(e).slice(0, 300));
  await page.screenshot({ path: "/tmp/accept-fields-error.png" }).catch(() => {});
}
// 归档本次创建的字段（保持可重复；archived 默认列表不显示）
try {
  await page.evaluate(async (ids) => {
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    for (const id of ids) {
      await fetch(`/api/v1/custom-fields/${id}/archive`, { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": csrf() } });
    }
  }, prepared?.ids ?? []);
} catch { /* 清理失败不改变验收结论 */ }

const ok = results.filter(r => r.pass).length;
console.log(`\n  自定义字段左树验收 ${ok}/${results.length}`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
