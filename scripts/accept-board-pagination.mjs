import "./_env.ts";
/** 看板列分页：独立项目同列 55 条，首屏 25 条，每次只追加下一批。 */
import { chromium } from "playwright";
import postgres from "postgres";
const HOST = process.env.BASE;
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
const checks = [];
const check = (name, ok, detail = "") => { checks.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`); };
let projectId;
try {
  await p.goto(`${HOST}/login`); await p.waitForTimeout(300);
  await p.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const fixture = await p.evaluate(async () => {
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const create = async (path, body) => {
      const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify(body) });
      const result = await response.json();
      if (response.status !== 201 || !result.id) throw new Error(`分页 fixture 创建失败：${response.status} ${JSON.stringify(result)}`);
      return result;
    };
    const project = await create("/api/v1/projects", { key: `BP${Date.now().toString(36).slice(-6).toUpperCase()}`, name: "看板分页验收" });
    const items = [];
    for (let i = 0; i < 55; i++) items.push(await create(`/api/v1/projects/${project.id}/work-items`, { title: `看板分页 ${i + 1}`, type: "TASK" }));
    return { projectId: project.id, count: items.length, states: [...new Set(items.map((item) => item.statusId))] };
  });
  projectId = fixture.projectId;
  check("自建 55 条同列工作项", fixture.count === 55 && fixture.states.length === 1);
  await p.goto(`${HOST}/projects/${projectId}/board`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(900);
  const counts = await p.locator(".board-column").evaluateAll((cols) => cols.map((c) => c.querySelectorAll(".card").length));
  check("首屏只渲染目标列的前 25 张卡", counts.filter((n) => n > 0).length === 1 && counts.some((n) => n === 25) && counts.every((n) => n <= 25), JSON.stringify(counts));
  const more = p.getByRole("button", { name: /加载更多/ }).first();
  check("大列出现加载更多", await more.count() > 0);
  if (await more.count()) {
    const columnKey = await p.locator(".board-column").filter({ has: more }).first().getAttribute("data-state-key");
    const col = p.locator(`.board-column[data-state-key="${columnKey}"]`).first();
    const before = await col.locator(".card").count();
    await more.click(); await p.waitForTimeout(800);
    const after = await col.locator(".card").count();
    check("加载更多只追加下一批 25 条", before === 25 && after === 50, `${before} → ${after}`);
    check("加载后仍保留剩余数据入口", await more.isVisible());
    await more.click(); await p.waitForTimeout(800);
    check("末页只追加剩余 5 条并移除加载入口", await col.locator(".card").count() === 55 && await col.getByRole("button", { name: /加载更多/ }).count() === 0);
  }
} catch (e) {
  console.error("  ❌", e); checks.push(false);
} finally {
  await b.close();
  if (projectId) {
    await sql`delete from audit_entry where target_id = ${projectId}`.catch(() => {});
    await sql`delete from project where id = ${projectId}`.catch(() => {});
  }
  await sql.end();
}
const passed = checks.filter(Boolean).length;
console.log(`\n  看板列分页验收 ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
