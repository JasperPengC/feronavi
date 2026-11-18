import "./_env.ts";
/**
 * 结构验收——窄屏无横向溢出、项目卡片可用、表面层级与跨页页头一致。
 * 外壳依据 docs/design/product-ui/DESIGN.md 的 2026-11-07 用户确认约束。
 *
 * 为什么落库而不是放 /tmp：这是**可重复的验收证据**，不是一次性探针。
 * 用退出码表达结论（0 通过 / 1 未通过），便于在流程里当闸门用：
 *     node scripts/verify-structure.mjs || echo "未通过，不提交"
 *
 * ⚠️ 注意：校验类命令**不要接管道**（`cmd | tail` 会把退出码换成 tail 的），
 *    本会话已因此提交过一次校验失败的文档。
 */
import { startVerifyBrowser } from "./verify-browser.mjs";
const BASE = process.env.BASE;
const { stop: stopBrowser, host: HOST } = await startVerifyBrowser("structure");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 回归闸门总超时：浏览器/CDP 整体无响应时强制失败退出（不无限挂住 npm run verify:all）
setTimeout(() => { console.error("[verify] 总超时（浏览器/CDP 无响应）"); process.exit(2); }, 300_000);
let ws, id = 0; const pending = new Map();
// CDP 命令的**超时 + 一次重试**：浏览器 renderer 偶发卡顿会让单条命令不返回（实测 Runtime.evaluate /
// Page.navigate 都会偶然出现）；重试一次能把"偶发"与"真挂死"区分开，仍不返回则失败退出。
function send(m, p = {}, attempt = 0) {
  return new Promise((res, rej) => {
    const x = { id: ++id, method: m, params: p };
    const fail = (err) => {
      clearTimeout(timer);
      if (attempt === 0) { res(send(m, p, 1)); return; }
      rej(err);
    };
    const timer = setTimeout(() => { if (pending.delete(x.id)) fail(new Error(`CDP 超时: ${m}`)); }, 20_000);
    pending.set(x.id, {
      res: (v) => { clearTimeout(timer); res(v); },
      rej: (e) => fail(e),
    });
    try { ws.send(JSON.stringify(x)); } catch (e) { pending.delete(x.id); fail(e); }
  });
}
const evalx = async (e, aw = false) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: aw })).result?.value;
let code = 1;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${HOST}/json/version`)).ok) break; } catch { /* 等待浏览器就绪 */ } await sleep(250); }
  const list = await (await fetch(`${HOST}/json/list`)).json();
  ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); } };
  // 布局/结构闸门是**整页反复导航**的探针；SSE 长连接在快速整页导航下会让 Chrome 的
  // Page.navigate 偶发不返回（实测第 2 次进入审计页时卡住，CDP 超时）。探针不依赖实时事件，
  // 这里直接屏蔽 /api/v1/events，避免验证环境自造连接风暴（真实 SPA 路由切换不重载页面，不受影响）。
  try { await send("Network.enable"); await send("Network.setBlockedURLs", { urls: ["*api/v1/events*"] }); } catch { /* 旧内核不支持则忽略 */ }
  // 凭据支持环境变量覆盖（本地切库/演示库时不必改脚本）；值在 Node 侧插值，浏览器里没有 process
  const vUser = JSON.stringify(process.env.VERIFY_USER ?? "demo");
  const vPass = JSON.stringify(process.env.VERIFY_PASS ?? "demo-password-12345");
  await send("Page.navigate", { url: `${BASE}/login` }); await sleep(1200);
  const loginStatus = await evalx(`(async () => { let r; try { r = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ${vUser}, password: ${vPass} }) }); } catch (e) { return "FETCH_ERR: " + (e instanceof Error ? e.message : String(e)); } console.error("[verify] login:", r.status); return r.status; })()`, true);
  console.error("[verify] login:", loginStatus);

  // 本轮新增页面也纳入结构闸门：先取一个真实项目 id 以覆盖「项目活动」页
  const firstProject = await evalx(`(async () => {
    try { const r = await fetch("/api/v1/projects"); const j = await r.json(); return j.items?.[0]?.id ?? null; }
    catch { return null; }
  })()`, true);
  const activityPath = firstProject ? `/projects/${firstProject}/activity` : null;
  const widePaths = ["/projects", "/tokens", "/announcements", "/admin/audit", activityPath].filter(Boolean);

  // ① 窄屏：480 / 768 两档，三页，断言无横向溢出
  const overflow = [];
  for (const w of [480, 768]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const path of widePaths) {
      await send("Page.navigate", { url: BASE + path }); await sleep(2000);
      const r = await evalx(`(() => ({ 页: location.pathname, 视口: window.innerWidth,
        文档宽: document.documentElement.scrollWidth,
        溢出: document.documentElement.scrollWidth > window.innerWidth + 1 }))()`);
      overflow.push(r);
    }
  }
  console.log("  ▸ 窄屏读数:"); for (const r of overflow) console.log("   ", JSON.stringify(r));

  // ② 当前项目页为自适应卡片列表：检查真实内容区域、列宽、字段与无重叠。
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/projects` }); await sleep(2400);
  const projectTable = await evalx(`(() => {
    const table = document.querySelector(".projects-table"), viewport = document.querySelector(".project-list-page .table-scroll"), content = document.querySelector(".shell-content");
    if (!table || !viewport || !content) return { ok: false };
    const tb = table.getBoundingClientRect(), vb = viewport.getBoundingClientRect(), cb = content.getBoundingClientRect(), cs = getComputedStyle(content);
    const rows = [...table.querySelectorAll("tbody tr")];
    return { ok: rows.length > 0, width: tb.width, available: cb.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      fits: tb.left >= vb.left - 1 && tb.right <= vb.right + 1 && viewport.scrollWidth <= viewport.clientWidth + 1,
      rowsUsable: rows.every((row) => row.querySelectorAll("td").length >= 5 && !!row.querySelector("a.table-project")?.textContent.trim()) };
  })()`);
  console.log("  ▸ 项目表格布局:", JSON.stringify(projectTable));
  const tableOk = projectTable.ok && projectTable.fits && projectTable.rowsUsable && Math.abs(projectTable.width - projectTable.available) <= 2;
  // 默认是表格视图；通过真实视图控件切到卡片，不能因card selector不存在而跳过。
  const switched = await evalx(`(() => { const button = document.querySelector('.project-view-controls button[aria-label="卡片视图"]'); button?.click(); return !!button; })()`);
  if (!switched) throw new Error("缺少项目卡片视图切换入口");
  await sleep(500);
  const grid = await evalx(`(() => {
    const g = document.querySelector(".project-card-grid"), content = document.querySelector(".shell-content");
    if (!g || !content) return { ok: false, why: "缺少真实项目卡片区域" };
    const bounds = g.getBoundingClientRect(), cb = content.getBoundingClientRect(), cs = getComputedStyle(content);
    const availableLeft = cb.left + parseFloat(cs.paddingLeft), availableRight = cb.right - parseFloat(cs.paddingRight);
    const cards = [...g.querySelectorAll(":scope > .project-card")];
    const boxes = cards.map((card) => card.getBoundingClientRect());
    const overlap = boxes.some((a, i) => boxes.slice(i + 1).some((b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
    return { ok: cards.length > 0, count: cards.length, available: availableRight - availableLeft, width: bounds.width,
      fillsContent: Math.abs(bounds.left - availableLeft) <= 1 && Math.abs(bounds.right - availableRight) <= 1,
      columns: getComputedStyle(g).gridTemplateColumns.split(" ").map(Number.parseFloat),
      cards: cards.map((card, i) => ({ width: boxes[i].width, height: boxes[i].height,
        inside: boxes[i].left >= bounds.left - 1 && boxes[i].right <= bounds.right + 1,
        title: !!card.querySelector(".project-card-name")?.textContent.trim(),
        metadata: !!card.querySelector(".project-card-meta")?.textContent.trim(),
        navigable: card.tagName === "A" && card.getAttribute("href")?.startsWith("/projects/") })), overlap };
  })()`);
  console.log("  ▸ 项目卡片布局:", JSON.stringify(grid));
  const gridOk = tableOk && grid.ok && grid.fillsContent && !grid.overlap && grid.columns.length > 0
    && grid.columns.every((width) => width >= 300) && Math.max(...grid.columns) - Math.min(...grid.columns) <= 1
    && grid.cards.every((card) => card.width >= 300 && card.height > 0 && card.inside && card.title && card.metadata && card.navigable);
  if (!gridOk) console.log("  ⛔ 项目卡片未填满可用内容区域、列宽不足或字段/导航不可用");

  // ③ 表面层级：统计**大面积**元素的背景色种类（面积 > 10000px²），应 ≤ 4（Chrome/Workbench/Panel/Raised）。
  // 控件背景不属于页面表面层级；例如公告页的 315×50 Select 会超过 10000px²，
  // 但把它算成第五层会把控件样式误报为页面层级漂移。
  const surfaces = [];
  for (const path of widePaths) {
    await send("Page.navigate", { url: BASE + path }); await sleep(2400);
    surfaces.push(await evalx(`(() => {
      const counts = new Map();
      for (const e of document.querySelectorAll("div, main, aside, header, footer, section, table")) {
        const b = e.getBoundingClientRect();
        if (b.width * b.height < 10000) continue;
        if (e.matches("button, input, select, textarea, [role='button'], [role='combobox'], .btn, .input, .select, .textarea")) continue;
        const bg = getComputedStyle(e).backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)") continue;
        // Transparent shell/workbench wrappers can resolve to a color-mix/composited value
        // in light mode. They are still the same workbench surface as the content shell.
        if (e.matches(".shell, .shell-main-col, .shell-workbench")) continue;
        counts.set(bg, (counts.get(bg) ?? 0) + 1);
      }
      return { 页: location.pathname, 层级数: counts.size, 分层: [...counts.keys()] };
    })()`));
  }
  console.log("  ▸ 表面层级:"); for (const r of surfaces) console.log("   ", JSON.stringify(r));

  // ④ 卡片内部空洞：口径 = (卡片底 - 最后一个可见后代底) > 48px 视为空洞
  const voids = [];
  for (const path of ["/projects", "/tokens", "/admin/audit", ...(activityPath ? [activityPath] : [])]) {
    await send("Page.navigate", { url: BASE + path }); await sleep(2400);
    voids.push(await evalx(`(() => {
      const bad = [];
      for (const card of document.querySelectorAll(".panel, .card")) {
        const kids = [...card.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().height > 0);
        if (!kids.length) continue;
        const bottom = Math.max(...kids.map((e) => e.getBoundingClientRect().bottom));
        const gap = Math.round(card.getBoundingClientRect().bottom - bottom);
        if (gap > 48) bad.push({ 空隙: gap, 卡片高: Math.round(card.getBoundingClientRect().height) });
      }
      return { 页: location.pathname, 空洞卡片数: bad.length, 明细: bad.slice(0, 3) };
    })()`));
  }
  console.log("  ▸ 卡片空洞:"); for (const r of voids) console.log("   ", JSON.stringify(r));

  // ⑤ 当前弧形骨架：侧栏/顶栏/底栏为框架，工作区表面独立，底栏不能遮住内容。
  //    留白测量工作区到视口的框架高度，不能误要求底栏外再多一条空白。
  await send("Page.navigate", { url: `${BASE}/projects` }); await sleep(2400);
  const shell = await evalx(`(() => {
    const eff = (el) => { let e = el; while (e) { const bg = getComputedStyle(e).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)") return bg; e = e.parentElement; } return null; };
    const side = document.querySelector(".shell-sidebar"), head = document.querySelector(".shell-header"),
          foot = document.querySelector(".shell-footer"), shell = document.querySelector(".shell"),
          main = document.querySelector(".shell-main-col.app-main"),
          content = document.querySelector(".shell-workbench");
    if (!side || !head || !foot || !shell || !main) return { ok: false, why: "缺元素" };
    const fb = foot.getBoundingClientRect(), wb = content.getBoundingClientRect(), pos = getComputedStyle(foot).position;
    return { ok: true,
      侧栏有效背景: eff(side), Header背景: getComputedStyle(head).backgroundColor,
      Footer有效背景: eff(foot), 内容背景: eff(content),
      // Round 1 v2 参考 YouQu：侧栏/顶栏/页脚共用浅色框架；灰色圆角内容面板独立；
      // 顶栏透明（透出框架白），Footer 也不与内容面板同色。
      外壳同色: eff(side) === eff(head) && eff(side) === eff(foot),
      内容区独立: eff(content) !== eff(side),
      Header可透明: getComputedStyle(head).backgroundColor === "rgba(0, 0, 0, 0)" || eff(head) === eff(side),
      Footer定位: pos, 非浮动: pos === "static" || pos === "relative",
      底部框架: Math.round(window.innerHeight - wb.bottom),
      底栏高度: fb.height, 工作区高度: wb.height, 视口高度: innerHeight,
      右侧框架: Math.round(window.innerWidth - wb.right),
      工作区圆角: parseFloat(getComputedStyle(content).borderTopRightRadius),
      底栏不遮内容: wb.bottom <= fb.top + 1, 底栏在视口内: fb.bottom <= window.innerHeight + 1 && fb.height > 0,
      Footer父元素: foot.parentElement?.className };
  })()`);
  console.log("  ▸ 外壳一致性:", JSON.stringify(shell));

  // ⑦ 跨页一致性（规范第 3 节末条）：页头行位置与内容列宽一致；文本在有无操作按钮时可按行内垂直居中
  //    口径：规范要的是「**内容列宽**」一致，**不是**"首卡宽度"一致 ——
  //    首卡宽度本就随页面布局而异（工作台首卡 1/3 指标卡、项目页 2/3 主列、令牌页整宽）；
  //    我第一版把"首卡右边缘"也列入，把正确的布局差异当成了违规（本会话第 8 次"断言写错"）。
  const consistPaths = ["/workbench", "/projects", "/tokens", "/announcements", "/portfolios", "/admin/audit"];
  if (activityPath) consistPaths.push(activityPath);

  const consistRows = [];
  for (const consistPath of consistPaths) {
    await send("Page.navigate", { url: BASE + consistPath }); await sleep(1500);
    /**
     * 稳定性判据（修复假失败）：此前只等「进入动画结束」就测量，偶发读到动画中的 140（其余页 136）
     * → 跨页一致性误报。现在要求**连续两次采样完全一致**（top/left/width）+ 字体就绪 + 无运行中动画，
     * 才记录该页读数。这是一条真实的验收脚本缺陷，修在脚本侧而不是放宽断言。
     */
    let prev = null, settledRow = null;
    for (let i = 0; i < 40; i++) {
      const r = await evalx(`(async () => {
        await document.fonts.ready;
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const tt = document.querySelector(".page-header"), cc = document.querySelector(".shell-content");
        const title = tt?.querySelector(".page-title"), actions = tt?.querySelector(".page-actions");
        const tb = title?.getBoundingClientRect(), ab = actions?.getBoundingClientRect(), hb = tt?.getBoundingClientRect();
        const titleVisible = tb && hb && tb.width > 0 && tb.height > 0 && tb.top >= hb.top - 1 && tb.bottom <= hb.bottom + 1;
        const overlap = tb && ab && tb.left < ab.right - 1 && tb.right > ab.left + 1 && tb.top < ab.bottom - 1 && tb.bottom > ab.top + 1;
        const card = document.querySelector(".shell-content .panel, .shell-content .card");
        const anim = cc ? cc.getAnimations().some((a) => a.playState === "running") : false;
        return { top: tt ? Math.round(tt.getBoundingClientRect().top) : null,
                 left: cc ? Math.round(cc.getBoundingClientRect().left) : null,
                 width: cc ? Math.round(cc.getBoundingClientRect().width) : null,
                 cardLeft: card ? Math.round(card.getBoundingClientRect().left) : null,
                 titleVisible: !!titleVisible, overlap: !!overlap, anim };
      })()`, true);
      if (r && r.top !== null && r.left !== null && !r.anim) {
        if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width) { settledRow = r; break; }
        prev = r;
      } else { prev = null; }
      await sleep(100);
    }
    const row = settledRow ?? prev;
    if (!row || !row.titleVisible || row.overlap) throw new Error(`页头未稳定、标题不可见或与操作重叠：${consistPath}`);
    consistRows.push({ path: consistPath, 标题上边: row.top, 内容左: row.left, 内容宽: row.width, 首卡左: row.cardLeft });
  }
  const consistUniq = (k) => [...new Set(consistRows.map((r) => r[k]).filter((v) => v !== null))];
  // 只保留**定义上就与页面无关**的三项：页头行上边、内容区左边缘、内容区宽度。
  // ⚠️ "首卡左/右边缘"不是有效判据 —— 它随布局（整宽/双栏）与 DOM 顺序变化：
  //    独立跑时读到 [284]，并入脚本后读到 [284, 1033]（前面多了别的导航、页面状态不同）。
  //    **不是不变量，就不该写进断言**（本会话第 9 次因判据选错而得到假失败）。
  const consist = { 标题上边: consistUniq("标题上边"), 内容左: consistUniq("内容左"), 内容宽: consistUniq("内容宽") };
  console.log("  ▸ 跨页一致性:", JSON.stringify(consist));
  for (const r of consistRows) console.log("    ", r.path, JSON.stringify({ 标题上边: r.标题上边, 内容左: r.内容左, 内容宽: r.内容宽 }));
  const consistOk = consist.标题上边.length === 1 && consist.内容左.length === 1 && consist.内容宽.length === 1;
  if (!consistOk) console.log("  ⛔ 跨页不一致（规范第 3 节：减少页面之间的视觉跳变）→ 不提交");

  const noOverflow = overflow.every((r) => !r.溢出);
  const shellOk = shell.ok && shell.外壳同色 && shell.内容区独立 && shell.Header可透明 && shell.非浮动
    && shell.底部框架 >= 12 && Math.abs(shell.底部框架 - shell.底栏高度) <= 1 && shell.工作区高度 >= shell.视口高度 * .65 && shell.右侧框架 === 16
    && shell.工作区圆角 === 20 && shell.底栏不遮内容 && shell.底栏在视口内;
  if (!shellOk) console.log("  ⛔ 外壳一致性未达（侧栏/Header/Footer 同框架色、内容面板独立、Header 可透明、工作区圆弧/右框与底部框架、底栏不遮内容）→ 不提交");
  const surfacesOk = surfaces.every((r) => r.层级数 <= 4);
  const voidsOk = voids.every((r) => r.空洞卡片数 === 0);
  if (!surfacesOk) console.log("  ⛔ 表面积层超过 4 个（规范第 4 节）→ 不提交");
  if (!voidsOk) console.log("  ⛔ 存在卡片内部空洞 > 48px（规范第 7 节「无大块无意义空白」）→ 不提交");
  if (!noOverflow) console.log("  ⛔ 存在横向溢出（规范第 7 节：窄屏不产生横向溢出）→ 不提交");
  code = noOverflow && surfacesOk && voidsOk && shellOk && gridOk && consistOk ? 0 : 1;
} catch (e) { console.error("  ❌ " + e.message); } finally { try { ws?.close(); } catch { /* ignore */ } await stopBrowser(); }
process.exit(code);
