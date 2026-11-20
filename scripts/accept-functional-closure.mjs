import "./_env.ts";
/**
 * 功能闭环验收（2026-10-30）
 * 覆盖本轮补的真实断点：工作项新建/编辑、附件、评论、全局搜索、项目设置、计划实体、
 * 自定义字段编辑、需求收集公开表单、表格批量、日历新建。
 * 只读 demo 数据；新建的临时实体尽量归档/删除，不写死时间。
 */
import { chromium } from "playwright";

const HOST = process.env.BASE;
const STAMP = Date.now();
const checks = [];
const check = (name, ok, detail = "") => { checks.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`); };
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
try {
  await p.goto(`${HOST}/login`); await p.waitForTimeout(300);
  await p.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await p.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  const csrf = () => p.evaluate(() => decodeURIComponent(document.cookie.match(/csrf_token=([^;]+)/)?.[1] ?? ""));

  // 1) 工作项：表格新建 → 详情 → 编辑
  const title = `闭环验收-${STAMP}`;
  await p.goto(`${HOST}/projects/${pid}/table`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(700);
  await p.getByRole("button", { name: "新建工作项" }).click();
  await p.getByLabel("标题").fill(title);
  await p.getByRole("button", { name: "创建", exact: true }).click(); await p.waitForTimeout(900);
  check("工作项从表格新建并打开详情", await p.locator(".ui-drawer").count() === 1);
  const found = await p.evaluate(async (t) => (await (await fetch(`/api/v1/search?q=${encodeURIComponent(t)}`)).json()).items.find((x) => x.type === "work-item" && x.title === t), title);
  check("新建工作项可由全局搜索命中", !!found, found?.key ?? "");
  await p.getByRole("button", { name: "编辑工作项" }).click(); await p.waitForTimeout(250);
  await p.getByLabel("标题").fill(`${title}-已改`);
  await p.getByRole("button", { name: "保存", exact: true }).click(); await p.waitForTimeout(700);
  const edited = await p.evaluate(async (t) => (await (await fetch(`/api/v1/search?q=${encodeURIComponent(t)}`)).json()).items.some((x) => x.type === "work-item" && x.title === t), `${title}-已改`);
  check("工作项编辑写回", edited);

  // 2) 附件上传/下载
  await p.locator("input[type=file]").setInputFiles({ name: `closure-${STAMP}.txt`, mimeType: "text/plain", buffer: Buffer.from("closure attachment") });
  await p.waitForTimeout(900);
  check("附件上传后出现在详情", await p.getByText(`closure-${STAMP}.txt`).count() === 1);
  const att = await p.evaluate(async (id) => (await (await fetch(`/api/v1/attachments?targetType=WORK_ITEM&targetId=${id}`)).json())[0], found.id);
  const dl = att ? await p.evaluate(async (aid) => (await fetch(`/api/v1/attachments/${aid}`)).status, att.id) : 0;
  check("附件下载端点可读", dl === 200, String(dl));

  // 3) 工作项评论
  const box = p.getByRole("textbox", { name: /写评论/ }).first();
  await box.fill(`评论-${STAMP}`); await p.getByRole("button", { name: "发送", exact: true }).click(); await p.waitForTimeout(700);
  check("工作项评论提交", await p.getByText(`评论-${STAMP}`).count() >= 1);

  // 4) 里程碑评论（多态评论）
  const ms = await p.evaluate(async (id) => (await (await fetch(`/api/v1/projects/${id}/milestones`)).json()), pid);
  const mid = ms[0]?.id;
  if (mid) {
    const cr = await p.evaluate(async ({ mid, token }) => { const r = await fetch("/api/v1/comments", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": token }, body: JSON.stringify({ targetType: "MILESTONE", targetId: mid, body: "里程碑闭环评论" }) }); return r.status; }, { mid, token: await csrf() });
    check("里程碑评论可创建", cr === 201, String(cr));
  }

  // 5) 全局搜索多类型
  const types = await p.evaluate(async ({token, stamp}) => {
    const title = `搜索闭环${stamp}`;
    const headers = { "content-type": "application/json", "x-csrf-token": token };
    const project = await fetch("/api/v1/projects", { method: "POST", headers, body: JSON.stringify({ key: `S${String(stamp).slice(-7)}`, name: title }) }).then(r => r.json());
    if (!project.id) throw new Error(`搜索夹具项目创建失败 ${JSON.stringify(project)}`);
    const page = await fetch(`/api/v1/projects/${project.id}/pages`, { method: "POST", headers, body: JSON.stringify({ title, content: "搜索验收文档" }) });
    if (!page.ok) throw new Error(`搜索夹具文档创建失败 ${page.status}`);
    return (await fetch(`/api/v1/search?q=${encodeURIComponent(title)}`).then(r => r.json())).items.map(x => x.type);
  }, {token: await csrf(), stamp: STAMP});
  check("全局搜索覆盖项目/文档", types.includes("project") && types.includes("page"), JSON.stringify([...new Set(types)]));

  // 6) 项目设置抽屉
  await p.goto(`${HOST}/projects/${pid}`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(700);
  await p.getByRole("main").getByRole("button", { name: "项目设置", exact: true }).click(); await p.waitForTimeout(250);
  check("项目设置可打开", await p.getByLabel("名称").count() >= 1);
  await p.keyboard.press("Escape");

  // 7) 计划实体面板
  await p.goto(`${HOST}/projects/${pid}/milestones`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(700);
  check("迭代/发布/模块管理入口存在", await p.getByRole("tab", { name: "迭代" }).count() === 1 && await p.getByRole("tab", { name: "版本" }).count() === 1);

  // 8) 表格批量操作条
  await p.goto(`${HOST}/projects/${pid}/table`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(700);
  const cb = p.locator("tbody").getByRole("checkbox").first();
  if (await cb.count()) { await cb.check(); await p.waitForTimeout(150); check("表格批量操作条出现", await p.locator(".table-batch-bar").count() === 1); }
  else check("表格批量操作条出现", false, "无行");

  // 9) 日历点击新建
  await p.goto(`${HOST}/projects/${pid}/calendar`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(700);
  const cell = p.locator(".calendar-cell.is-today .calendar-date-action");
  await cell.click(); await p.waitForTimeout(300);
  check("日历单元格可打开新建工作项", await p.locator(".ui-drawer").count() === 1);
  await p.keyboard.press("Escape");

  // 10) 需求收集：建表单 → 公开页提交
  const intake = await p.evaluate(async ({ pid, token, stamp }) => { const r = await fetch(`/api/v1/projects/${pid}/intake-forms`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": token }, body: JSON.stringify({ name: `闭环收集-${stamp}`, schema: [{ key: "title", label: "标题", type: "TEXT", required: true }] }) }); return { status: r.status, body: await r.json() }; }, { pid, token: await csrf(), stamp: STAMP });
  check("需求表单可创建并拿到 token", intake.status === 201 && !!intake.body.submitToken);
  if (intake.body.submitToken) {
    const anon = await b.newContext({ viewport: { width: 900, height: 900 } });
    const ap = await anon.newPage();
    await ap.goto(`${HOST}/intake/${intake.body.submitToken}`, { waitUntil: "domcontentloaded" }); await ap.waitForTimeout(600);
    await ap.getByLabel("标题").fill(`公开提交-${STAMP}`);
    await ap.getByRole("button", { name: "提交" }).click(); await ap.waitForTimeout(600);
    check("匿名公开表单可提交", await ap.getByText("已提交").count() === 1);
    await anon.close();
  }
  // 清理：删掉本次创建的临时工作项，避免影响后续视觉/计数用例
  if (found?.id) {
    await p.evaluate(async ({ id, token }) => {
      await fetch(`/api/v1/work-items/${id}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": token } });
    }, { id: found.id, token: await csrf() }).catch(() => {});
  }
} catch (e) {
  console.error("  ❌", e);
  checks.push(false);
} finally {
  await b.close();
}
const passed = checks.filter(Boolean).length;
console.log(`\n  功能闭环验收 ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
