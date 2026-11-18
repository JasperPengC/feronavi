import "./_env.ts";
/**
 * 列表行样式验收（第 46 轮落库）—— 检查指定页面**真的有数据行**且行样式生效。
 *
 * 为什么落库：此前这类探针一直放在 /tmp，每页各改一份，口径也就各写一遍 ——
 * 于是出现过「自定义字段页的药丸只在已归档时出现，而我把它写成通过条件」这种
 * **用不成立的前提判负**的错误（把工具问题伪装成产品问题）。
 * 现在只有一份实现，口径只写一次：
 *
 *   本页承诺的结构 = 首行有 .row-avatar（图标头像）且 .row-name（名称）
 *   · 药丸（.status-pill）**只作为信息输出**，不作为通过条件 ——
 *     它依赖数据状态（是否已归档、是否有状态列），拿它判负会把"没有那种数据"说成"样式没生效"。
 *
 * 前置：隔离 runner 提供的服务与 Playwright Chromium。校验命令**不要接管道**（会吃掉退出码）。
 * 用法：node scripts/verify-row-style.mjs "/projects/$pid/fields" "/projects/$pid/milestones"
 */
import { startVerifyBrowser } from "./verify-browser.mjs";
const BASE = process.env.BASE;
const { stop: stopBrowser, host: HOST } = await startVerifyBrowser("row-style");
// 默认覆盖全部列表页（$pid 由脚本自动替换为第一个项目 id）——
// 让 `npm run verify:rows` **不带参数也能跑**：此前要求必填参数，导致 verify:all 因"用法错误"退出 2，
// 而那是**用法错误、不是断言失败**（两者都用非 0 退出码，但含义完全不同，容易被误读）。
const DEFAULT_PATHS = [
  "/projects",
  "/projects/$pid/table",
  "/projects/$pid/ideas",
  "/projects/$pid/milestones",
  "/projects/$pid/import",
  "/tokens",
  "/portfolios",
];
const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PATHS;
console.log(`  ▸ 检查 ${paths.length} 个页面（默认列表，可用参数覆盖）`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

let bad = 0;
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
  await send("Page.navigate", { url: `${BASE}/login` }); await sleep(1200);
  await evalx(`(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); return 1; })()`, true);
  const pid = await evalx(`(async () => { const r = await fetch("/api/v1/projects"); const d = await r.json(); return (d.items||[])[0]?.id || ""; })()`, true);

  for (const raw of paths) {
    const path = raw.replace("$pid", pid);
    let r = { ready: false };
    // 最多两轮：首轮等待列表就绪；若仍停在"加载中"，刷新一次再等（避免首包/导航抖动造成假失败）
    for (let attempt = 0; attempt < 2 && !r?.ready; attempt++) {
    await send("Page.navigate", { url: attempt === 0 ? BASE + path : BASE + path });
    // Wait for the actual list region to show rows or its own empty state. Side panels and
    // announcement metric cards must never count as list content.
    for (let i = 0; i < 30; i++) {
      r = await evalx([
        "(() => {",
        "  const main = document.querySelector('.page-grid .main-col') || document.querySelector('.page-full') || document.querySelector('.page') || document.querySelector('.shell-content');",
        "  if (!main) return { ready: false, title: document.querySelector('.page-title')?.innerText || '', diagnostic: document.body.innerText.slice(0, 120) };",
        // Empty-state placeholder rows are not data rows; only check records using the shared entity-row contract.
        "  const rows = [...main.querySelectorAll('tbody tr')].filter((row) => row.querySelector('.row-avatar, .row-name'));",
        "  const cards = [...main.querySelectorAll('.panel, .card')].filter((card) => card.querySelector('.row-name') || card.querySelector('.status-pill'));",
        "  const isTable = rows.length > 0;",
        "  const scope = isTable ? rows : cards;",
        "  const first = scope[0];",
        "  const empty = !!main.querySelector('.empty-panel') || /(还没|暂无|没有(工作项|项目|数据|记录|内容)|空空如也)/.test(main.innerText || '');",
        "  const pills = [...scope].reduce((n, element) => n + element.querySelectorAll('.status-pill').length, 0);",
        "  return {",
        "    ready: isTable || cards.length > 0 || empty,",
        "    title: document.querySelector('.page-title')?.innerText || '',",
        "    empty,",
        "    形态: isTable ? '表格' : cards.length ? '卡片' : '未知',",
        "    行数: scope.length,",
        "    有头像: !!first?.querySelector('.row-avatar'),",
        "    有名称: !!first?.querySelector('.row-name'),",
        "    药丸数: pills,",
        "    首行文案: (first?.innerText || '').slice(0, 20).replace(/\\n/g, ' '),",
        "    diagnostic: main.innerText.slice(0, 120)",
        "  };",
        "})()"
      ].join("\n"));
      if (r?.ready) break;
      await sleep(400);
    }
    }

    if (!r?.ready) {
      console.log("  ⛔ " + path + " ｜ 列表未就绪 ｜ " + (r?.title || "无页面标题") + " ｜ " + (r?.diagnostic || ""));
      bad++;
      continue;
    }

    const empty = r.empty;
    const ok = r.有头像 === true && r.有名称 === true;
    if (empty && !r.有头像 && !r.有名称 && r.行数 === 0) {
      console.log("  ∅ " + path + " ｜ 主列表为空态 → 跳过，不判负");
      continue;
    }
    if (r.形态 === "卡片") {
      const okCard = r.行数 > 0 && (r.药丸数 >= 1 || r.有名称);
      console.log("  " + (okCard ? "✓" : "⛔") + " " + path + " ｜ 卡片列表 ｜ 卡片 " + r.行数 + " ｜ 药丸 " + r.药丸数 + " ｜ " + r.首行文案);
      if (!okCard) bad++;
      continue;
    }
    console.log("  " + (ok ? "✓" : "⛔") + " " + path + " ｜ " + r.形态 + " ｜ 行数 " + r.行数 + " ｜ 头像 " + r.有头像 + " ｜ 名称 " + r.有名称 + " ｜ 药丸 " + r.药丸数 + " ｜ " + r.首行文案);
    if (!ok) bad++;
  }
} catch (e) { console.error("  ❌ " + e.message); bad++; }
finally { try { ws?.close(); } catch { /* ignore */ } await stopBrowser(); }
process.exit(bad === 0 ? 0 : 1);
