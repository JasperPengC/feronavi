import "./_env.ts";
/**
 * 检查「界面上是否直接显示了 i18n 词典键名」—— 第 37 轮。
 *
 * 背景：第 36 轮我把想法页状态药丸改成新组件时**丢了 t() 调用**，界面就显示成了 `ideas.stNew`。
 * 而当时所有几何断言（卡片数/药丸数/圆角）**全部通过** —— 因为它们只测存在与样式，不测文案。
 * 这类缺陷对用户是明显的错误，对结构测试却完全隐形。
 *
 * 做法（**零误报**的关键）：不是用正则猜"像不像键名"，而是**读真实词典取出全部键**，
 * 再在页面上找**与某个键完全相同**的可见文本 —— 词典键出现在界面文本里，一定是漏了翻译。
 *
 * ⚠️ 前置：隔离 runner 提供服务，已安装 Playwright Chromium。校验类命令**不要接管道**（会吃掉退出码）。
 * 用法：node scripts/verify-i18n-dom.mjs   （退出码 0 = 未发现键名泄漏）
 */
import { readFileSync } from "node:fs";
import { startVerifyBrowser } from "./verify-browser.mjs";
const BASE = process.env.BASE;

// ① 从词典文件取出全部键（zh 字典块内的 "key": 形式）
const src = readFileSync("src/client/i18n/index.ts", "utf-8");
const zhStart = src.indexOf("const zh: Dict = {");
const zhEnd = src.indexOf("const en: Dict = {");
const keys = new Set([...src.slice(zhStart, zhEnd).matchAll(/"([a-zA-Z][\w.]*\.[\w.]+)":/g)].map((m) => m[1]));
console.log(`  ▸ 词典键数: ${keys.size}`);

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/workbench", "/projects", "/tokens", "/announcements", "/portfolios", "/settings"];

const { stop: stopBrowser, host: HOST } = await startVerifyBrowser("i18n-dom");
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

let leaks = 0;
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
  const wanted = PAGES.map((p) => p.replace("$pid", pid));

  for (const path of wanted) {
    await send("Page.navigate", { url: BASE + path }); await sleep(2200);
    const found = await evalx(`(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const s = (n.textContent || "").trim();
        if (!s || s.length > 60) continue;
        const el = n.parentElement;
        if (!el || el.offsetParent === null) continue;                    // 只看可见元素
        if (["SCRIPT", "STYLE", "CODE"].includes(el.tagName)) continue;   // 代码块不算界面文案
        out.push(s);
      }
      return [...new Set(out)];
    })()`);
    // ⚠️ 前置断言：页面必须真的渲染出内容。
    // 否则"页面白屏（运行期错误）"会因为没有文本而被判为"无泄漏"—— 那是**假通过**（本轮真实发生）。
    // 用**结构性锚点**而不是字符数：这些页面的可见文本由大量短节点组成（每个几字符），
    // 字符总数本来就低（实测 100–200），用阈值判断会把**正常页面误判为损坏**（我第一版就这么错了）。
    // 轮询等待锚点：固定 sleep 会把"还没渲染完"误判成"页面损坏"（洞察页就这么被误报过一次）
    let anchor = false;
    for (let i = 0; i < 12; i++) {
      anchor = await evalx(`!!document.querySelector(".page-title") && !document.body.innerText.includes("渲染出错")`);
      if (anchor) break;
      await sleep(500);
    }
    if (!anchor) {
      console.log(`  ⛔ ${path} 缺少页面标题/疑似渲染异常 → **不得据此判为通过**`);
      leaks += 1;
      continue;
    }
    // ⚠️ 第 50 轮修正（关键）：原规则只抓「**词典里存在的**键被显示」。
    // 但实际泄漏几乎都是「**不存在的**键被显示」（写 UI 时用了没核对过的键：
    // common.status / common.workItems / common.enabled …）→ 旧规则判为无泄漏 → **假通过**。
    // 新规则同时抓两类：① 存在键被显示；② **形状像键、且首段是真实命名空间**的文本被显示。
    // 用「首段必须是词典里出现过的命名空间（common / nav / wk …）」避免误报普通含点文本
    // （如 demo@feronavi.local —— 首段 demo 不是命名空间，不会被误判）。
    const PREFIXES = new Set([...keys].map((k) => k.split(".")[0]));
    const KEY_SHAPE = /^([a-z][a-zA-Z0-9]*)(\.[a-zA-Z0-9_]+)+$/;
    const looksLikeKey = (x) => { const m = KEY_SHAPE.exec(x); return !!m && PREFIXES.has(m[1]); };
    const bad = (found || []).filter((s) => keys.has(s) || looksLikeKey(s));
    if (bad.length) { leaks += bad.length; console.log(`  ⛔ ${path} 泄漏键名:`, bad.slice(0, 6)); }
    else console.log(`  ✓ ${path}`);
  }
  console.log(leaks === 0 ? "  ✅ 未发现键名泄漏" : `  ❌ 共 ${leaks} 处键名泄漏`);
} catch (e) { console.error("  ❌ " + e.message); leaks = 1; }
finally { try { ws?.close(); } catch { /* ignore */ } await stopBrowser(); }
process.exit(leaks === 0 ? 0 : 1);
