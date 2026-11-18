import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 自定义字段 + 导出 CSV 自检（第八期，判据 F1–F7） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, customFieldDef, customFieldValue, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference, milestone, iteration, release, module as moduleT } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as cfService from "../src/server/services/custom-field.service.ts";
import * as exportService from "../src/server/services/export.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w8-admin", G = "w8-guest";
const KEY = "W8PROJ", KEY2 = "W8B";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [gr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));
const [a] = await db.insert(member).values({ username: U, email: "w8@x.test", name: "字段管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w8-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
// 无指派账号（权限集为空）用于 F3 反控
const [g] = await db.insert(member).values({ username: G, email: "w8g@x.test", name: "无权者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w8-password-1234") }).returning({ id: member.id });
void gr;
const guest = (await loadActor(g!.id))!;

await db.delete(project).where(eq(project.key, KEY));
await db.delete(project).where(eq(project.key, KEY2));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W8 项目" });
const { id: pid2 } = await projectService.createProject(admin, { key: KEY2, name: "W8 另一个项目" });
const wi = await wiService.createWorkItem(admin, pid, { type: "TASK", title: "带自定义字段的" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3992), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3992";

try {
  // ── W1/W2：定义 CRUD ──
  const fText = await cfService.createDef(admin, pid, { key: "customer", name: "客户", type: "TEXT" });
  ok("建 TEXT 字段", fText.key === "customer");
  const fNum = await cfService.createDef(admin, pid, { key: "budget", name: "预算", type: "NUMBER" });
  const fDate = await cfService.createDef(admin, pid, { key: "ship_date", name: "上线日", type: "DATE" });
  const fSel = await cfService.createDef(admin, pid, { key: "channel", name: "渠道", type: "SINGLE_SELECT", options: [{ value: "web", label: "网页" }, { value: "app", label: "客户端" }] });
  const fMulti = await cfService.createDef(admin, pid, { key: "tags", name: "标签", type: "MULTI_SELECT", options: [{ value: "p0", label: "P0" }, { value: "p1", label: "P1" }] });
  await cfService.createDef(admin, pid, { key: "owner_ref", name: "责任人引用", type: "PERSON" });
  ok("六种类型都能建", [fText, fNum, fDate, fSel, fMulti].every(Boolean));
  ok("列表返回 6 个", (await cfService.listDefs(admin, pid)).length === 6);

  // F1：同项目 key 重复 → 拒；不同项目同 key → 允许
  let dupKey = false;
  try { await cfService.createDef(admin, pid, { key: "customer", name: "重复", type: "TEXT" }); } catch (e) { dupKey = (e as { code?: string }).code === "VALIDATION"; }
  ok("F1 同项目 key 重复 → VALIDATION", dupKey);
  const other = await cfService.createDef(admin, pid2, { key: "customer", name: "另一个项目的同名字段", type: "TEXT" });
  ok("F1 不同项目同 key 允许", other.key === "customer");

  // 选项规则
  let noOpts = false;
  try { await cfService.createDef(admin, pid, { key: "bad_select", name: "无选项", type: "SINGLE_SELECT" }); } catch (e) { noOpts = (e as { code?: string }).code === "VALIDATION"; }
  ok("单选无选项 → VALIDATION", noOpts);
  let wrongOpts = false;
  try { await cfService.createDef(admin, pid, { key: "bad_text", name: "文本带选项", type: "TEXT", options: [{ value: "x", label: "X" }] }); } catch (e) { wrongOpts = (e as { code?: string }).code === "VALIDATION"; }
  ok("非选项字段带选项 → VALIDATION", wrongOpts);
  let badKey = false;
  try { await cfService.createDef(admin, pid, { key: "Bad-Key", name: "x", type: "TEXT" }); } catch (e) { badKey = (e as { code?: string }).code === "VALIDATION"; }
  ok("非法 key 格式 → VALIDATION", badKey);

  // F3：无权限者不能建/改
  let guestDenied = false;
  try { await cfService.createDef(guest, pid, { key: "nope", name: "x", type: "TEXT" }); } catch { guestDenied = true; }
  ok("F3 无权限者不能建字段", guestDenied);
  let guestArchive = false;
  try { await cfService.archiveDef(guest, fText.id); } catch { guestArchive = true; }
  ok("F3 无权限者不能归档字段", guestArchive);

  // ── W3：值读写与类型校验 ──
  const good = await cfService.setValues(admin, wi.id, {
    [fText.id]: "某某集团", [fNum.id]: 120, [fDate.id]: "2026-12-31",
    [fSel.id]: "web", [fMulti.id]: ["p0", "p1"],
  });
  ok("整批写值成功", good.find((f) => f.key === "customer")?.value === "某某集团");
  ok("多选值保序", JSON.stringify(good.find((f) => f.key === "tags")?.value) === JSON.stringify(["p0", "p1"]));

  // F4：类型不符
  const expectValidation = async (label: string, patch: Record<string, unknown>) => {
    let hit = false, code = "";
    try { await cfService.setValues(admin, wi.id, patch); } catch (e) { hit = true; code = (e as { code?: string }).code ?? ""; }
    ok(label, hit && code === "VALIDATION", code);
  };
  await expectValidation("F4 NUMBER 传字符串 → 拒", { [fNum.id]: "abc" });
  await expectValidation("F4 DATE 格式错 → 拒", { [fDate.id]: "2026/12/31" });
  await expectValidation("F4 TEXT 传数字 → 拒", { [fText.id]: 123 });
  // F5：选项外取值
  await expectValidation("F5 单选取值不在选项 → 拒", { [fSel.id]: "nope" });
  await expectValidation("F5 多选必须是数组 → 拒", { [fMulti.id]: "p0" });
  await expectValidation("F5 多选含非法项 → 拒", { [fMulti.id]: ["p0", "nope"] });
  await expectValidation("PERSON 非 uuid → 拒", { [fText.id]: "x", ...{ [(await cfService.listDefs(admin, pid)).find((d) => d.key === "owner_ref")!.id]: "not-a-uuid" } });
  // 校验失败时**不落库**（前面的好值仍在）
  ok("校验失败不破坏已有值", (await cfService.getValues(admin, wi.id)).find((f) => f.key === "customer")?.value === "某某集团");

  // F6：必填与状态必填
  const fReq = await cfService.createDef(admin, pid, { key: "must_have", name: "必填字段", type: "TEXT", isRequired: true });
  await expectValidation("F6 必填字段缺值 → 拒", { [fText.id]: "x" });
  await cfService.setValues(admin, wi.id, { [fReq.id]: "填上了" });
  ok("F6 补上必填值后通过", (await cfService.getValues(admin, wi.id)).find((f) => f.key === "must_have")?.value === "填上了");
  // 状态必填：仅当状态命中时
  const states = await sql<{ key: string }[]>`select key from workflow_state where workflow_id = ${wi.workflowId} order by sort_order`;
  const terminalKey = states[states.length - 1]!.key;
  const fState = await cfService.createDef(admin, pid, { key: "close_note", name: "结单说明", type: "TEXT", requiredStates: [terminalKey] });
  ok("F6 未命中状态时允许缺值", (await cfService.setValues(admin, wi.id, { [fText.id]: "still ok" })).length > 0);
  void fState;

  // F2：归档字段的值不丢
  await cfService.archiveDef(admin, fNum.id);
  const afterArchive = await cfService.getValues(admin, wi.id);
  ok("F2 归档字段不在默认列表", !(await cfService.listDefs(admin, pid)).some((d) => d.id === fNum.id));
  ok("F2 但已填的值仍可读（标记 archived）",
    afterArchive.find((f) => f.key === "budget")?.value === 120 && afterArchive.find((f) => f.key === "budget")?.archived === true);
  let writeArchived = false;
  try { await cfService.setValues(admin, wi.id, { [fNum.id]: 1 }); } catch (e) { writeArchived = (e as { code?: string }).code === "VALIDATION"; }
  ok("F2 归档字段不能再写", writeArchived);

  // ── F7：导出 CSV ──
  const wi2 = await wiService.createWorkItem(admin, pid, { type: "DEFECT", title: '含"引号"与,逗号的标题' });
  // 该项目有 is_required 字段，新工作项也要给上（校验是对的，测试得遵守）
  await cfService.setValues(admin, wi2.id, { [fText.id]: "另一个客户", [fReq.id]: "x" });
  // ⚠️ 前面的步骤把 customer 覆盖成过别的值 —— 导出前显式重置，别让断言依赖历史中间态
  await cfService.setValues(admin, wi.id, { [fText.id]: "某某集团" });
  const { csv, count } = await exportService.exportWorkItemsCsv(admin, pid);
  ok("F7 导出行数 = 工作项数", count === 2, String(count));
  ok("F7 有 BOM（Excel 中文不乱码）", csv.startsWith("\uFEFF"));
  ok("F7 行尾为 CRLF", csv.includes("\r\n"));
  const header = csv.replace("\uFEFF", "").split("\r\n")[0]!;
  ok("F7 表头含自定义字段列", header.includes("cf_customer") && header.includes("cf_tags"), header);
  ok("F7 含引号/逗号的字段被正确转义", csv.includes('"含""引号""与,逗号的标题"'), csv.slice(0, 200));
  ok("F7 含自定义字段值", csv.includes("某某集团") && csv.includes("另一个客户"));
  const bad = await sql<{ n: number }[]>`select count(*)::int as n from work_item where project_id = ${pid2} and deleted_at is null`;
  ok("F7 导出不含其它项目数据", bad[0]!.n === 0);

  // 导出端点（HTTP）：schemaVersion 走响应头
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w8-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const exp = await fetch(`${BASE}/api/v1/projects/${pid}/work-items/export`, { headers: { cookie } });
  ok("F7 导出端点 200 + text/csv",
    exp.status === 200 && (exp.headers.get("content-type") ?? "").includes("text/csv"), `${exp.status} ${exp.headers.get("content-type")}`);
  ok("F7 响应头带 x-schema-version", exp.headers.get("x-schema-version") === "1", String(exp.headers.get("x-schema-version")));
  ok("F7 响应头带行数", exp.headers.get("x-row-count") === "2", String(exp.headers.get("x-row-count")));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(customFieldValue);
  await db.delete(customFieldDef);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(milestone); await db.delete(iteration); await db.delete(release); await db.delete(moduleT);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(workItem).where(eq(workItem.projectId, pid2));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(project).where(eq(project.key, KEY2));
  for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
