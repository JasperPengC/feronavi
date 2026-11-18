/** PDF 报告自检（第十四期）：产物用**独立解析器**（pypdf）校验，不靠"生成成功"自证 */
import "./_env.ts";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, iteration, projectStatusDef, workflow, workflowState, auditEntry, activityEntry } from "../src/db/schema.ts";
import { writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as report from "../src/server/services/report.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, and } from "drizzle-orm";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w14d-admin", KEY = "W14DPROJ";
const OUT = join(process.env.FERONAVI_TEST_DIRECTORY!, "report.pdf");
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w14d@x.test", name: "报告管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w14d-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "PDF 报告项目" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3972), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3972";

try {
  await wiService.createWorkItem(admin, pid, { type: "TASK", title: "中文标题的任务" });
  await wiService.createWorkItem(admin, pid, { type: "DEFECT", title: "一个缺陷" });
  await db.insert(iteration).values({ projectId: pid, name: "迭代一", startDate: "2026-11-01", endDate: "2026-11-14" });

  const { buffer, filename } = await report.projectReport(admin, pid);
  writeFileSync(OUT, buffer);
  ok("生成了 PDF（非空且以 %PDF 开头）", buffer.length > 800 && buffer.subarray(0, 5).toString() === "%PDF-", `${buffer.length}B`);
  ok("文件名带项目标识", filename.includes(KEY), filename);
  ok("产物体积合理（非内嵌字体 → 不含几十 MB 的字体数据）", buffer.length < 200_000, `${Math.round(statSync(OUT).size / 1024)}KB`);

  // ── 独立解析器校验（pypdf）：结构可读 + 中文文本可提取 ──
  const py = `
import pypdf, sys
r = pypdf.PdfReader(${JSON.stringify(OUT)})
text = "\\n".join((p.extract_text() or "") for p in r.pages)
print("PAGES", len(r.pages))
print("HAS_NAME", "PDF 报告项目" in text)
print("HAS_SECTION", "一、状态分布" in text and "四、逾期工作项" in text)
print("HAS_COUNT", "3" in text)
print("HAS_TYPE", "任务" in text and "缺陷" in text)
print("HAS_ITER", "迭代一" in text)
print("HAS_NOTE", "不含模型生成" in text)
`;
  let out = "";
  try { out = execFileSync(process.env.PYTHON_BIN ?? "python3", ["-c", py], { encoding: "utf8" }); }
  catch (e) { out = `ERROR ${(e as Error).message}`; }
  const has = (k: string) => new RegExp(`^${k} (.*)$`, "m").exec(out)?.[1]?.trim();
  ok("**pypdf 能打开且读出页数**（独立解析器，非自证）", has("PAGES") === "1", `PAGES=${has("PAGES")}`);
  ok("**中文项目名可被提取**（CID 字体编码正确）", has("HAS_NAME") === "True", out.slice(0, 160));
  ok("章节标题可提取", has("HAS_SECTION") === "True");
  ok("类型分布中文可提取（任务/缺陷）", has("HAS_TYPE") === "True");
  ok("迭代名可提取", has("HAS_ITER") === "True");
  ok("写明口径说明（报告不含模型摘要）", has("HAS_NOTE") === "True");

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w14d-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/v1/projects/${pid}/report.pdf`, { headers: { cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  ok("HTTP 报告 200 且 content-type=application/pdf", res.status === 200 && res.headers.get("content-type") === "application/pdf", String(res.status));
  ok("HTTP 响应体是有效 PDF（同样以 %PDF 开头）", buf.subarray(0, 5).toString() === "%PDF-", buf.subarray(0, 8).toString());
  const anon = await fetch(`${BASE}/api/v1/projects/${pid}/report.pdf`);
  ok("匿名访问被拒", anon.status === 403, String(anon.status));
  const other = (await db.select().from(project).limit(50)).find((p) => p.id !== pid)!;
  void other;
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`);
  console.log(String((e as Error).stack).split("\n").slice(1, 4).join("\n"));
} finally {
  await app.close();
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(iteration).where(eq(iteration.projectId, pid));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
void projectStatusDef; void workflow; void workflowState; void and;
