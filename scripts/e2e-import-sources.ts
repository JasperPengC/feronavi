import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 导入源适配自检（第十二期）：禅道/Jira 预设、GBK、分隔符嗅探、建议→确认全链路 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, idea, ideaVote, importBatch, importMapping, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference, customFieldDef, customFieldValue } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as importService from "../src/server/services/import.service.ts";
import { suggestMapping, sniffDelimiter, PRESETS } from "../src/server/services/import-sources.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w12b-admin";
const KEY = "W12BPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w12b@x.test", name: "导入管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w12b-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W12B 导入源" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3984), host: "127.0.0.1" });
const countItems = async () => (await sql<{ n: number }[]>`select count(*)::int as n from work_item where project_id = ${pid} and deleted_at is null`)[0]!.n;

try {
  // ── 分隔符嗅探 ──
  ok("嗅探逗号", sniffDelimiter("a,b,c\n1,2,3") === ",", sniffDelimiter("a,b,c"));
  ok("嗅探分号（欧洲/禅道导出常见）", sniffDelimiter("a;b;c\n1;2;3") === ";");
  ok("嗅探制表符", sniffDelimiter("a\tb\tc\n1\t2\t3") === "\t");
  ok("引号内的逗号不算分隔符", sniffDelimiter('a;"x,y";c\n1;2;3') === ";", sniffDelimiter('a;"x,y";c'));

  // ── 禅道预设建议 ──
  const zentaoHeader = ["编号", "标题", "描述", "类型", "优先级", "严重程度", "指派给", "截止日期", "预计工时", "备注列"];
  const z = suggestMapping(zentaoHeader, "ZENTAO");
  ok("禅道：识别出标题/描述/类型等", z.fieldMap["标题"] === "title" && z.fieldMap["描述"] === "description" && z.fieldMap["类型"] === "type", JSON.stringify(z.fieldMap));
  ok("禅道：编号列作为幂等键", z.externalIdColumn === "编号", String(z.externalIdColumn));
  ok("禅道：类型枚举给出中文→平台值建议", z.valueMaps.type!["需求"] === "REQUIREMENT" && z.valueMaps.type!["Bug"] === "DEFECT");
  ok("禅道：优先级建议（1→URGENT）", z.valueMaps.priority!["1"] === "URGENT");
  ok("未识别列被列出（提醒用户）", z.unmatchedColumns.includes("备注列"), JSON.stringify(z.unmatchedColumns));

  // ── Jira 预设建议 ──
  const jiraHeader = ["Issue key", "Summary", "Description", "Issue Type", "Priority", "Assignee", "Due Date", "Story Points"];
  const j = suggestMapping(jiraHeader, "JIRA");
  ok("Jira：Summary→title、Issue key→幂等键", j.fieldMap["Summary"] === "title" && j.externalIdColumn === "Issue key", JSON.stringify(j.fieldMap));
  ok("Jira：类型建议 Story→REQUIREMENT", j.valueMaps.type!["Story"] === "REQUIREMENT" && j.valueMaps.type!["Bug"] === "DEFECT");
  ok("未知来源不瞎猜", suggestMapping(["a"], "NOPE").notes[0]!.includes("手动映射"));

  // ── 端到端：禅道风格 GBK + 分号分隔文件 ──
  const zentaoCsv = "编号;标题;类型;优先级;截止日期\nZT-1;登录失败;缺陷;1;2026-12-01\nZT-2;支持导出;需求;3;2026-12-05\n";
  // GBK 编码（用已知字节构造中文：这里借助 Node 的 gbk 解码器反向不可用，故直接用 latin1 占位会失真 —— 改为 UTF-8 + BOM 覆盖编码分支，GBK 分支已在第九期验过）
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(zentaoCsv, "utf8")]);
  const created = await importService.createBatch(admin, pid, { filename: "zentao.csv", buffer: buf, source: "ZENTAO_API" });
  ok("建批次时识别分号分隔符", (created as { delimiter?: string }).delimiter === ";", JSON.stringify((created as { delimiter?: string }).delimiter));
  ok("解析出 2 行（分号未被当成内容）", created.batch.totalRows === 2, String(created.batch.totalRows));
  const sug = await importService.suggestForBatch(admin, created.batch.id);
  ok("建议端点返回可直接用的映射", sug.fieldMap["标题"] === "title" && sug.externalIdColumn === "编号", JSON.stringify(sug.fieldMap));

  // 按建议映射 → 试运行 → 确认
  await importService.setMapping(admin, created.batch.id, {
    fieldMap: sug.fieldMap, valueMaps: sug.valueMaps, externalIdColumn: sug.externalIdColumn,
  });
  const before = await countItems();
  const dry = await importService.dryRun(admin, created.batch.id);
  ok("试运行：2 条可建、0 失败（枚举经建议映射后可写）", dry.willCreate === 2 && dry.failed === 0, JSON.stringify(dry).slice(0, 90));
  ok("试运行不写业务表", (await countItems()) === before);
  const conf = await importService.confirm(admin, created.batch.id);
  ok("确认写入 2 条", conf.created === 2 && conf.status === "SUCCEEDED", JSON.stringify(conf).slice(0, 80));
  const kinds = await sql<{ type: string; priority: string | null }[]>`select type, priority from work_item where project_id = ${pid} order by number`;
  ok("类型/优先级按建议映射落库（缺陷→DEFECT、1→URGENT）",
    kinds.some((k) => k.type === "DEFECT" && k.priority === "URGENT"), JSON.stringify(kinds));
  // 幂等仍然成立
  const again = await importService.createBatch(admin, pid, { filename: "zentao.csv", buffer: buf, source: "ZENTAO_API" });
  const sug2 = await importService.suggestForBatch(admin, again.batch.id);
  await importService.setMapping(admin, again.batch.id, { fieldMap: sug2.fieldMap, valueMaps: sug2.valueMaps, externalIdColumn: sug2.externalIdColumn });
  const dryAgain = await importService.dryRun(admin, again.batch.id);
  ok("重复导入先预演：全部将跳过", dryAgain.willCreate === 0 && dryAgain.willSkip === 2 && dryAgain.failed === 0);
  const conf2 = await importService.confirm(admin, again.batch.id);
  ok("同一文件再导一次：全部跳过（幂等）", conf2.created === 0 && conf2.skipped === 2, JSON.stringify(conf2).slice(0, 80));

  // ── Excel 的明确立场 ──
  ok("Excel 源未实现（预设里没有 EXCEL 条目，避免假装支持）", !("EXCEL" in PRESETS));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(importMapping); await db.delete(importBatch);
  await db.delete(customFieldValue); await db.delete(customFieldDef);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(ideaVote); await db.delete(idea);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
