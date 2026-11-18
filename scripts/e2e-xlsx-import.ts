/** Excel(.xlsx) 导入自检（第十四期）：自研解析器 vs **独立实现生成的样例**
 *
 * 样例由 openpyxl（Python，另一个实现）生成 —— 用自己写的 ZIP 写出去测自己写的 ZIP 读，
 * 是**循环验证**，证明不了互操作性。
 */
import "./_env.ts";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, importBatch, auditEntry, activityEntry, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as importService from "../src/server/services/import.service.ts";
import { parseXlsx, isXlsx, sheetToCsv } from "../src/server/lib/xlsx.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const PY = process.env.PYTHON_BIN ?? "python3";
const fixtureDir = mkdtempSync(join(tmpdir(), "feronavi-xlsx-"));
const XLSX = join(fixtureDir, "import.xlsx");
const EMPTY_XLSX = join(fixtureDir, "empty.xlsx");

const U = "w14g-admin", KEY = "W14GPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w14g@x.test", name: "Excel 管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w14g-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W14G Excel" });
void ensureInitialized;

try {
  // ── 用独立实现（openpyxl）生成样例 ──
  const script = `
import openpyxl
wb = openpyxl.Workbook()
ws = wb.active; ws.title = "需求"
ws.append(["标题", "类型", "优先级", "故事点"])
ws.append(["导出 Excel 也要能用", "需求", "高", 5])
ws.append(['含逗号, 与引号"的标题', "缺陷", "紧急", 2])
ws.append(["第三行", "任务", "中", 3])
ws2 = wb.create_sheet("设计")
ws2["A1"] = "模块"; ws2["C1"] = "说明"
ws2["A2"] = "看板"; ws2["C2"] = "拖拽失败要回滚"
wb.save(${JSON.stringify(XLSX)})
print("ok")
`;
  let generated = "";
  generated = execFileSync(PY, ["-c", script], { encoding: "utf8" }).trim();
  ok("独立实现（openpyxl）生成样例成功", generated === "ok", generated || "无可用解释器");

  const buf = readFileSync(XLSX);
  ok("识别为 xlsx（ZIP 魔数，而非看后缀）", isXlsx(buf) && !isXlsx(Buffer.from("a,b\n1,2")));

  // ── 解析器：与独立实现的结果对齐 ──
  const sheets = parseXlsx(buf);
  ok("读出全部工作表（含中文表名）", sheets.length === 2 && sheets[0]!.name === "需求" && sheets[1]!.name === "设计",
    sheets.map((s) => s.name).join(","));
  ok("表头与行数正确", JSON.stringify(sheets[0]!.rows[0]) === '["标题","类型","优先级","故事点"]' && sheets[0]!.rows.length === 4,
    JSON.stringify(sheets[0]!.rows[0]));
  ok("**含逗号与引号的中文单元格原样读出**", sheets[0]!.rows[2]![0] === '含逗号, 与引号"的标题', JSON.stringify(sheets[0]!.rows[2]![0]));
  ok("数字单元格读成字符串（不做无根据的类型猜测）", sheets[0]!.rows[1]![3] === "5");
  ok("**稀疏单元格按列对齐**（B 列为空不得左移）", JSON.stringify(sheets[1]!.rows[0]) === '["模块","","说明"]', JSON.stringify(sheets[1]!.rows[0]));
  ok("CSV 转义：含逗号的单元格加引号", sheetToCsv([['a,b', "c"]]).startsWith('"a,b",c'), sheetToCsv([['a,b', "c"]]));

  // ── 走导入管线（复用同一条 createBatch）──
  const r = await importService.createBatch(admin, pid, { filename: "需求.xlsx", buffer: buf, source: "CSV" });
  ok("xlsx 走通导入管线（建批次成功）", !!r.batch.id, JSON.stringify(r.batch).slice(0, 80));
  const batch = (await db.select().from(importBatch).where(eq(importBatch.id, r.batch.id)).limit(1))[0]!;
  ok("批次记录了表头（来自 xlsx 首表）", JSON.stringify(batch).includes("标题"), JSON.stringify(batch).slice(0, 120));

  // ── 负例：不是 xlsx 的内容不得被当成 xlsx；损坏的 zip 要明确报错 ──
  let notXlsx = true;
  try { const c = await importService.createBatch(admin, pid, { filename: "普通.csv", buffer: Buffer.from("标题,类型\n甲,需求\n"), source: "CSV" }); notXlsx = !!c.batch.id; }
  catch { notXlsx = false; }
  ok("普通 CSV 仍走原路径（不被误判为 xlsx）", notXlsx);
  let corrupt = false;
  try { await importService.createBatch(admin, pid, { filename: "坏.xlsx", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]), source: "CSV" }); }
  catch (e) { corrupt = true; void e; }
  ok("**损坏的 xlsx 明确报错**（不静默给空数据）", corrupt);

  // ── 空表 / 无数据行 ──
  const emptyScript = `
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active
ws.append(["标题", "类型"])
wb.save(${JSON.stringify(EMPTY_XLSX)}); print("ok")
`;
  execFileSync(PY, ["-c", emptyScript]);
  let noRows = false;
  try { await importService.createBatch(admin, pid, { filename: "空.xlsx", buffer: readFileSync(EMPTY_XLSX), source: "CSV" }); }
  catch (e) { noRows = (e as { code?: string }).code === "VALIDATION"; }
  ok("只有表头没有数据行 → VALIDATION（与 CSV 同一口径）", noRows);
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`);
  console.log(String((e as Error).stack).split("\n").slice(1, 4).join("\n"));
} finally {
  await db.delete(importBatch).where(eq(importBatch.projectId, pid)).catch(() => {});
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
  rmSync(fixtureDir, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
