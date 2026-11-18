import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 导入自检（第九期，判据 I1–I7 / I9）：四项硬能力逐项验 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, importBatch, importMapping, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference, customFieldDef, customFieldValue, milestone, iteration, release, module as moduleT } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as importService from "../src/server/services/import.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, and, isNull } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w9-admin", G = "w9-outsider";
const KEY = "W9PROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w9@x.test", name: "导入管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w9-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [g] = await db.insert(member).values({ username: G, email: "w9g@x.test", name: "无权者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w9-password-1234") }).returning({ id: member.id });
const outsider = (await loadActor(g!.id))!;
// 一个普通成员用于用户映射
const [m2] = await db.insert(member).values({ username: "w9-dev", email: "w9d@x.test", name: "开发者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w9-password-1234") }).returning({ id: member.id });
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W9 导入项目" });
await db.insert(roleAssignment).values({ memberId: m2!.id, roleId: ar!.id, scopeType: "PROJECT", scopeId: pid });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3991), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3991";

// 修正：第 2 行含未闭合引号会吞掉后续行，这里改成规范的转义写法
const CSV = [
  "外部ID,标题,描述,类型,优先级,指派人,截止日期,故事点",
  'ZT-1,"登录按钮,点击无反应",用户反馈的缺陷,DEFECT,高,开发者,2026-12-01,3',
  'ZT-2,"需求：支持导出,\n含引号""测试""与换行",需求描述,REQUIREMENT,中,,2026-12-05,8',
  "ZT-3,普通任务,,TASK,中,,2026-12-10,5",
  "ZT-4,,缺少标题的行,TASK,低,,,",
].join("\r\n");

async function countItems() {
  // ⚠️ 这里的 sql 是 postgres.js 客户端：**不能**把它当 drizzle 字段传进 select({...})
  //    （会触发 orderSelectedFields 无限递归 —— 本项目第五次踩两套 sql 混用）
  const r = await sql<{ n: number }[]>`
    select count(*)::int as n from work_item where project_id = ${pid} and deleted_at is null
  `;
  return r[0]!.n;
}
void and; void isNull;

try {
  // ── I2：CSV 解析（引号内逗号/换行、"" 转义、CRLF）──
  const parsed = importService.parseCsv(CSV);
  ok("I2 解析出 4 条数据行", parsed.rows.length === 4, String(parsed.rows.length));
  ok("I2 引号内的逗号被保留", parsed.rows[0]!["标题"] === "登录按钮,点击无反应", parsed.rows[0]!["标题"]);
  ok("I2 引号内的换行被保留", (parsed.rows[1]!["标题"] ?? "").includes("\n"), JSON.stringify(parsed.rows[1]!["标题"]));
  ok("I2 双引号转义被还原", (parsed.rows[1]!["标题"] ?? "").includes('"测试"'), JSON.stringify(parsed.rows[1]!["标题"]));

  // ── I1：编码识别（GBK）──
  const gbkBuf = Buffer.from(new TextEncoder().encode("x")); // 占位，下面用真 GBK 字节
  void gbkBuf;
  // "标题" 与 "缺陷" 的 GBK 字节（用 iconv 不引入依赖：手工构造已知字节）
  const gbkHeader = Buffer.from([0xb1, 0xea, 0xcc, 0xe2]);            // 标题
  const gbkCell = Buffer.from([0xc8, 0xb1, 0xcf, 0xdd]);              // 缺陷
  const gbk = Buffer.concat([gbkHeader, Buffer.from(","), Buffer.from("x\n"), gbkCell, Buffer.from(",y\n")]);
  const dec = importService.decodeBuffer(gbk);
  ok("I1 GBK 自动识别", dec.encoding === "gbk", dec.encoding);
  ok("I1 GBK 中文正确还原", dec.text.includes("标题") && dec.text.includes("缺陷"), JSON.stringify(dec.text));
  const forced = importService.decodeBuffer(gbk, "gbk");
  ok("I1 显式指定编码可覆盖", forced.encoding === "gbk" && forced.text.includes("标题"));
  const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("标题,值\n甲,1\n", "utf8")]);
  const dec2 = importService.decodeBuffer(utf8Bom);
  ok("I1 UTF-8 BOM 识别且不残留 BOM 字符", dec2.encoding === "utf-8" && dec2.hadBom && dec2.text.startsWith("标题"), JSON.stringify(dec2.text.slice(0, 4)));

  // ── 建批次（上传）──
  const batchRes = await importService.createBatch(admin, pid, { filename: "z.test.csv", buffer: Buffer.from(CSV, "utf8") });
  const bid = batchRes.batch.id;
  ok("建批次成功（DRY_RUN）", batchRes.batch.status === "DRY_RUN" && batchRes.batch.totalRows === 4, batchRes.batch.status);
  ok("表头被识别", batchRes.header.includes("外部ID") && batchRes.header.includes("标题"), batchRes.header.join(","));

  // ── I9：越权 ──
  let outsiderDenied = false;
  try { await importService.getBatch(outsider, bid); } catch { outsiderDenied = true; }
  ok("I9 无权限者看不到批次", outsiderDenied);

  // ── I3：映射 ──
  let noTitle = false;
  try {
    await importService.setMapping(admin, bid, { fieldMap: { 描述: "description" } });
  } catch (e) { noTitle = (e as { code?: string }).code === "VALIDATION"; }
  ok("I3 缺 title 映射 → VALIDATION", noTitle);
  let dupTarget = false;
  try {
    await importService.setMapping(admin, bid, { fieldMap: { 标题: "title", 描述: "title" } });
  } catch (e) { dupTarget = (e as { code?: string }).code === "VALIDATION"; }
  ok("I3 目标字段重复映射 → VALIDATION", dupTarget);
  let badCol = false;
  try {
    await importService.setMapping(admin, bid, { fieldMap: { 标题: "title", 不存在的列: "description" } });
  } catch (e) { badCol = (e as { code?: string }).code === "VALIDATION"; }
  ok("I3 源列不在表头 → VALIDATION", badCol);
  let badUser = false;
  try {
    await importService.setMapping(admin, bid, { fieldMap: { 标题: "title" }, userMap: { 开发者: "00000000-0000-0000-0000-000000000000" } });
  } catch (e) { badUser = (e as { code?: string }).code === "VALIDATION"; }
  ok("I3 用户映射指向非项目成员 → VALIDATION", badUser);

  // 正式映射（枚举值映射 + 用户映射人工确认）
  await importService.setMapping(admin, bid, {
    fieldMap: { 标题: "title", 描述: "description", 类型: "type", 优先级: "priority", 指派人: "assignee", 截止日期: "due_date", 故事点: "estimate_points" },
    valueMaps: {
      type: { "缺陷": "DEFECT", "需求：支持导出": "REQUIREMENT", "TASK": "TASK" },
      priority: { "高": "HIGH", "中": "MEDIUM", "低": "LOW" },
    },
    userMap: { 开发者: m2!.id },
    externalIdColumn: "外部ID",
  });
  ok("I3 映射保存成功", true);

  // ── I4：试运行不写业务表 ──
  const before = await countItems();
  const dry = await importService.dryRun(admin, bid);
  const afterDry = await countItems();
  ok("I4 试运行统计正确（3 可建 / 1 失败）", dry.willCreate === 3 && dry.failed === 1, JSON.stringify(dry).slice(0, 120));
  ok("I4 试运行**没有写业务表**（行数不变）", before === afterDry, `${before} → ${afterDry}`);
  ok("I4 逐行错误报告含行号与原因", dry.errorReport.length === 1 && dry.errorReport[0]!.index === 5 && /标题/.test(dry.errorReport[0]!.reason ?? ""), JSON.stringify(dry.errorReport[0]));

  // ── I5/I6：确认写入（部分成功）──
  const c1 = await importService.confirm(admin, bid);
  ok("I6 写入 3 条、失败 1 条、状态 PARTIAL", c1.created === 3 && c1.failed === 1 && c1.status === "PARTIAL", JSON.stringify(c1).slice(0, 120));
  ok("I6 PARTIAL 保留错误报告", ((await importService.getBatch(admin, bid)).errorReport as unknown[]).length === 1);
  ok("实际入库 3 条", (await countItems()) === before + 3, String(await countItems()));

  // ── 活动与审计：批量导入必须可追责 ──
  const acts1 = await db.select().from(activityEntry).where(eq(activityEntry.projectId, pid));
  ok("导入批次创建写项目活动", acts1.some((x) => x.action === "import.batch_created" && x.summary.includes("待确认")),
    JSON.stringify(acts1.map((x) => x.action)));
  const confirmAct = acts1.find((x) => x.action === "import.confirmed");
  ok("确认导入写活动（摘要含真实数量 3 行）",
    !!confirmAct && confirmAct.summary.includes("确认导入了 3 行") && confirmAct.summary.includes("失败 1"),
    confirmAct?.summary);
  const confirmAudit = (await db.select().from(auditEntry)).filter((x) => x.action === "import.confirmed");
  ok("确认导入写审计", confirmAudit.length >= 1, String(confirmAudit.length));

  // ── I5：幂等（同文件再导一次）──
  const batch2 = await importService.createBatch(admin, pid, { filename: "z.test.csv", buffer: Buffer.from(CSV, "utf8") });
  await importService.setMapping(admin, batch2.batch.id, {
    fieldMap: { 标题: "title", 描述: "description", 类型: "type", 优先级: "priority", 指派人: "assignee", 截止日期: "due_date", 故事点: "estimate_points" },
    valueMaps: { type: { "缺陷": "DEFECT", "需求：支持导出": "REQUIREMENT", "TASK": "TASK" }, priority: { "高": "HIGH", "中": "MEDIUM", "低": "LOW" } },
    userMap: { 开发者: m2!.id }, externalIdColumn: "外部ID",
  });
  const dry2 = await importService.dryRun(admin, batch2.batch.id);
  ok("I5 第二次试运行：3 条全部「将跳过」", dry2.willCreate === 0 && dry2.willSkip === 3, JSON.stringify(dry2).slice(0, 100));
  const c2 = await importService.confirm(admin, batch2.batch.id);
  ok("I5 第二次确认不新建（幂等）", c2.created === 0 && c2.skipped === 3, JSON.stringify(c2).slice(0, 100));
  ok("I5 工作项总数未翻倍", (await countItems()) === before + 3, String(await countItems()));

  // ── I7：回滚 + 原地复活 ──
  const rb = await importService.rollback(admin, bid);
  ok("I7 回滚删除了本批次 3 条", rb.removed === 3, JSON.stringify(rb));
  ok("I7 回滚后活跃工作项归零", (await countItems()) === before, String(await countItems()));
  const mapsAfter = await db.select().from(importMapping).where(eq(importMapping.batchId, bid));
  ok("I7 映射行**保留**但置 is_active=false", mapsAfter.length === 3 && mapsAfter.every((m) => !m.isActive), `${mapsAfter.length} 行`);

  const rbAct = (await db.select().from(activityEntry)).find((x) => x.action === "import.rolled_back");
  ok("回滚写活动（摘要含软删数量）", !!rbAct && rbAct.summary.includes("回滚了导入批次") && rbAct.summary.includes("软删 3 个工作项"), rbAct?.summary);
  const rbAudit = (await db.select().from(auditEntry)).filter((x) => x.action === "import.rolled_back");
  ok("回滚写 SECURITY 审计", rbAudit.length === 1 && rbAudit[0]!.severity === "SECURITY", JSON.stringify(rbAudit.map((x) => x.severity)));
  // 再次导入同一文件：应复用映射行原地复活，而不是新建映射行
  const batch3 = await importService.createBatch(admin, pid, { filename: "z.test.csv", buffer: Buffer.from(CSV, "utf8") });
  await importService.setMapping(admin, batch3.batch.id, {
    fieldMap: { 标题: "title", 描述: "description", 类型: "type", 优先级: "priority", 指派人: "assignee", 截止日期: "due_date", 故事点: "estimate_points" },
    valueMaps: { type: { "缺陷": "DEFECT", "需求：支持导出": "REQUIREMENT", "TASK": "TASK" }, priority: { "高": "HIGH", "中": "MEDIUM", "低": "LOW" } },
    userMap: { 开发者: m2!.id }, externalIdColumn: "外部ID",
  });
  const c3 = await importService.confirm(admin, batch3.batch.id);
  ok("I7 回滚后再导入 → 重新创建 3 条", c3.created === 3, JSON.stringify(c3).slice(0, 100));
  const totalMaps = await db.select().from(importMapping).where(eq(importMapping.projectId, pid));
  ok("I7 **没有新建映射行**（原地复活，UNIQUE 保证）", totalMaps.length === 3, `${totalMaps.length} 行`);

  // ── I6b：retry-failed 只补失败行 ──
  // ⚠️ 必须用处于 PARTIAL 的批次：已回滚的批次调 confirm 会被正确拒绝（另一条断言）
  let rolledBackRejected = false;
  try { await importService.confirm(admin, bid); } catch (e) { rolledBackRejected = (e as { code?: string }).code === "CONFLICT"; }
  ok("已回滚批次不允许再确认（CONFLICT）", rolledBackRejected);
  const retry = await importService.confirm(admin, batch2.batch.id, { retryFailedOnly: true });
  ok("I6 retry-failed 只处理失败行（标题仍缺失 → 仍失败）", retry.created === 0 && retry.failed === 1, JSON.stringify(retry).slice(0, 100));

  // ── HTTP 上传路径（锁住 multipart 注册这类缺陷）──
  // ⚠️ 此前 @fastify/multipart 只做了类型导入、**从未注册**，导致所有 multipart 端点
  //    （含第一阶段就有的 /api/v1/uploads）对任何客户端都返回 415 —— 七个阶段的 e2e
  //    都在测服务层，没有一条走 HTTP 上传。这里补上，防止同类缺陷再溜过去。
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w9-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const fd = new FormData();
  fd.append("file", new Blob([CSV], { type: "text/csv" }), "http.csv");
  const up = await fetch(`${BASE}/api/v1/projects/${pid}/imports`, {
    method: "POST", headers: { cookie, "x-csrf-token": csrf }, body: fd,
  });
  const upBody = (await up.json()) as { batchId?: string; encoding?: string; totalRows?: number; code?: string };
  ok("HTTP multipart 上传建批次（不再是 415）", up.status === 201 && !!upBody.batchId,
    `${up.status} ${JSON.stringify(upBody).slice(0, 90)}`);
  ok("HTTP 上传返回表头与编码", upBody.totalRows === 4 && !!upBody.encoding, JSON.stringify(upBody).slice(0, 90));

  const createdActs = (await db.select().from(activityEntry)).filter((x) => x.action === "import.batch_created");
  ok("每个成功批次都有创建活动（≥4）", createdActs.length >= 4, String(createdActs.length));

  // ── 权限：dry-run 与 confirm 同权限 ──
  let dryDenied = false;
  try { await importService.dryRun(outsider, bid); } catch { dryDenied = true; }
  ok("I9 无 work_item:create 者试运行也被拒（同权限）", dryDenied);
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`); console.log((e as Error).stack?.split("\n").slice(0,6).join("\n"));
} finally {
  await app.close();
  await db.delete(importMapping);
  await db.delete(importBatch);
  await db.delete(customFieldValue);
  await db.delete(customFieldDef);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(milestone); await db.delete(iteration); await db.delete(release); await db.delete(moduleT);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, G, "w9-dev"]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
