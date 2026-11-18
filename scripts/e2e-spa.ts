import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * SPA 托管与前端链路自检（R8）
 *
 * 验证的是**服务端是否正确托管前端**，以及前端依赖的契约是否齐备：
 *   1 页面路径回落 index.html（前端路由自己处理）
 *   2 API 路径仍返回 JSON 404（不被 SPA 吞掉）
 *   3 构建产物可访问（JS/CSS）
 *   4 index.html 含防 FOUC 的内联主题脚本
 *   5 未初始化时页面请求 302 → /setup（前端要能拿到跳转）
 */
import { buildApp } from "../src/server/app.ts";
import { db, sql } from "../src/db/index.ts";
import { setupState, organization, roleAssignment } from "../src/db/schema.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

import { eq } from "drizzle-orm";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE ?? "http://127.0.0.1:3995";

// 先测「未初始化」路径：页面应 302 到 /setup
/**
 * 模拟"未初始化"。
 * ⚠️ 现在"是否已初始化"的判据是**数据事实**（存在 ORG 级 ADMIN 指派），
 * 只删 setup_state / organization 已经不够 —— 必须**临时移除 ORG 级 ADMIN 指派**。
 * 因此这里**先快照、finally 恢复**：破坏性测试必须可恢复，
 * 否则跑一次回归就把本地实例的初始化状态弄丢（这个坑已经踩过一次）。
 */
/**
 * 中断自愈：上一次运行若被强杀（来不及 finally），会留下快照文件。
 * 下次启动先把快照恢复，避免把本地实例的初始化状态永久弄丢（真实踩过）。
 */
const SNAPSHOT = "/tmp/feronavi-spa-snapshot.json";
if (existsSync(SNAPSHOT)) {
  try {
    const prev = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
      assignments: typeof roleAssignment.$inferSelect[];
      orgRows: typeof organization.$inferSelect[];
      setupRows: typeof setupState.$inferSelect[];
    };
    if (prev.assignments?.length) await db.insert(roleAssignment).values(prev.assignments).onConflictDoNothing();
    if (prev.orgRows?.length) await db.insert(organization).values(prev.orgRows).onConflictDoNothing();
    if (prev.setupRows?.length) await db.insert(setupState).values(prev.setupRows).onConflictDoNothing();
    unlinkSync(SNAPSHOT);
    console.log("  🔧 已从上次中断的快照恢复初始化数据");
  } catch { /* 快照损坏则忽略 */ }
}
const adminAssignments = await db.select().from(roleAssignment).where(eq(roleAssignment.scopeType, "ORG"));
const orgRows = await db.select().from(organization);
const setupRows = await db.select().from(setupState);
try { writeFileSync(SNAPSHOT, JSON.stringify({ assignments: adminAssignments, orgRows, setupRows }), "utf8"); } catch { /* 无写权限时退化为无自愈 */ }
/** 恢复快照（幂等）：必须在关闭 app 之前做 —— app.close 实测可能挂住，外部 timeout 会把恢复一起杀掉 */
async function restoreSnapshot(): Promise<void> {
  try {
    if (adminAssignments.length) await db.insert(roleAssignment).values(adminAssignments).onConflictDoNothing();
    if (orgRows.length) await db.insert(organization).values(orgRows).onConflictDoNothing();
    if (setupRows.length) await db.insert(setupState).values(setupRows).onConflictDoNothing();
    try { unlinkSync(SNAPSHOT); } catch { /* 已删除 */ }
    console.log("  ✅ 已恢复初始化的数据快照");
  } catch (e) { console.error("  ⚠️ 恢复快照失败:", (e as Error).message); }
}
await db.delete(roleAssignment).where(eq(roleAssignment.scopeType, "ORG"));
await db.delete(setupState);
await db.delete(organization);
let app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3995), host: "127.0.0.1" });
try {
  const r = await fetch(`${BASE}/projects`, { redirect: "manual" });
  ok("未初始化：页面路径 302 → /setup", r.status === 302 && r.headers.get("location") === "/setup",
    `${r.status} ${r.headers.get("location")}`);
  const api = await fetch(`${BASE}/api/v1/projects`);
  ok("未初始化：API 返回 JSON 而非重定向",
    api.status === 403 && (api.headers.get("content-type") ?? "").includes("application/json"),
    `${api.status} ${api.headers.get("content-type")}`);
} finally { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {}); }

// 再测「已初始化」路径：页面应拿到 SPA，API 404 仍是 JSON
await db.insert(setupState).values({ initializedAt: new Date(), currentStep: 6 });
await db.insert(organization).values({ name: "SPA 测试", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" });
app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3995), host: "127.0.0.1" });
try {
  // 已初始化后关闭向导页面入口并转到登录；向导 API 仍由下面的检查确认被拦截。
  for (const p of ["/", "/login", "/projects", "/projects/abc/board"]) {
    const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
    const html = res.headers.get("content-type")?.includes("text/html") ?? false;
    ok(`页面 ${p} → index.html`, html && res.status === 200, `${res.status} ${res.headers.get("content-type")}`);
  }
  const setupRes = await fetch(`${BASE}/setup`, { redirect: "manual" });
  ok("已初始化后 /setup → 302 /login（向导页面关闭）",
    setupRes.status === 302 && setupRes.headers.get("location") === "/login",
    `${setupRes.status} ${setupRes.headers.get("location")}`);
  const notFoundApi = await fetch(`${BASE}/api/v1/nope`);
  ok("API 未知路径仍是 JSON 404（不被 SPA 吞）",
    notFoundApi.status === 404 && (notFoundApi.headers.get("content-type") ?? "").includes("application/json"),
    `${notFoundApi.status}`);

  const htmlRes = await fetch(`${BASE}/login`);
  const html = await htmlRes.text();


  // ══ 黑屏根因回归 ══════════════════════════════════════════
  // 实测踩到的阻断级缺陷：不存在的 JS 被 SPA 回落成 index.html（200 text/html），
  // 浏览器按 nosniff 拒绝把它当模块执行 → React 永不挂载 → **纯黑屏**。
  // 触发条件极常见：重新构建后 hash 变了，而浏览器缓存里还是指向旧 hash 的 HTML。
  const staleJs = await fetch(`${BASE}/assets/index-DOESNOTEXIST.js`);
  const staleCt = staleJs.headers.get("content-type") ?? "";
  ok("不存在的 JS 资源 → 404（绝不回落成 HTML）",
    staleJs.status === 404 && !staleCt.includes("text/html"), `${staleJs.status} ${staleCt}`);

  const staleMap = await fetch(`${BASE}/assets/index-DOESNOTEXIST.js.map`);
  ok("不存在的 .map → 404", staleMap.status === 404, String(staleMap.status));

  // 哈希资源可永久缓存；index.html 必须每次校验
  const jsPath2 = html.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/)?.[1];
  if (jsPath2) {
    const r = await fetch(`${BASE}${jsPath2}`);
    ok("哈希资源 → immutable 长缓存",
      (r.headers.get("cache-control") ?? "").includes("immutable"), r.headers.get("cache-control") ?? "-");
  }
  const htmlCache = await fetch(`${BASE}/login`);
  ok("index.html → no-cache（否则重新部署后必然黑屏）",
    (htmlCache.headers.get("cache-control") ?? "").includes("no-cache"), htmlCache.headers.get("cache-control") ?? "-");

  // 状态查询必须永远可访问（前端靠它决定跳向导还是跳登录）
  const stateAlways = await fetch(`${BASE}/api/v1/setup/state`);
  ok("已初始化时 /setup/state 仍可访问（前端路由依据）", stateAlways.status === 200, String(stateAlways.status));
  const rerunBlocked = await fetch(`${BASE}/api/v1/setup/complete`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  ok("但 /setup/complete 仍被拦（403）", rerunBlocked.status === 403, String(rerunBlocked.status));

  ok("index.html 含防 FOUC 内联脚本", html.includes("feronavi_theme") && html.includes("theme-dark"));
  ok("index.html 引用构建产物", /assets\/index-[A-Za-z0-9_-]+\.js/.test(html));

  const m = html.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/);
  if (m) {
    const js = await fetch(`${BASE}${m[1]}`);
    ok("JS 产物可访问", js.status === 200 && (js.headers.get("content-type") ?? "").includes("javascript"),
      `${js.status}`);
  }
  const cssMatch = html.match(/href="(\/assets\/index-[A-Za-z0-9_-]+\.css)"/);
  if (cssMatch) {
    const css = await fetch(`${BASE}${cssMatch[1]}`);
    ok("CSS 产物可访问", css.status === 200, `${css.status}`);
  }
} finally {
  // ⚠️ 先恢复数据再关 app：app.close 曾挂住并被 timeout 杀死，导致恢复没执行（真实踩到）
  await db.delete(setupState);
  await db.delete(organization);
  await restoreSnapshot();
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
  await sql.end().catch(() => {});
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
