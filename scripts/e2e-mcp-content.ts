import "./_env.ts";
/** 文档维护、文件导入与导出的真实 HTTP MCP 闭环，独立数据库。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, mcpClient } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import * as imports from "../src/server/services/import.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const app = await buildApp({ logger: false });
const marker = randomUUID().replaceAll("-", "").slice(0, 10);
let id = 0, checks = 0;
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.error, undefined); return body.result;
}
async function call(token: string, name: string, args: object, error?: string) {
  const response = await rpc(token, "tools/call", { name, arguments: args });
  const data = JSON.parse(response.content[0].text);
  if (error) { assert.equal(response.isError, true); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(response.structuredContent, data); }
  return data;
}
const check = (name: string, ok: unknown) => { assert.ok(ok, name); checks++; console.log(`OK ${name}`); };
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: `content-${marker}`, name: "内容验收", email: `${marker}@content.test`, status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(person!.id))!;
  const inside = await projects.createProject(actor, { key: `CI${marker}`, name: "内容闭环" });
  const outside = await projects.createProject(actor, { key: `CO${marker}`, name: "范围外" });
  const rw = await tokens.createToken(actor, { name: "内容读写", tier: "READ_WRITE", projectWhitelist: [inside.id] });
  const ro = await tokens.createToken(actor, { name: "内容只读", tier: "READ_ONLY", projectWhitelist: [inside.id] });
  const required = ["page.revisions", "page.getRevision", "page.restoreRevision", "page.updateMetadata", "page.getPermissions", "page.setPermissions", "page.delete", "import.create", "import.list", "import.get", "import.suggestions", "import.setMapping", "import.dryRun", "import.confirm", "import.retryFailed", "import.rollback", "export.workItems", "export.projectReport"];
  const names = (await rpc(rw.token, "tools/list")).tools.map((t: { name: string }) => t.name);
  check("目录声明文档导入导出全部工具", required.every(name => names.includes(name)));
  const current = await wiki.createPage(actor, inside.id, { title: "历史文档", content: "第一版内容" });
  const first = await wiki.getPage(actor, current.id);
  await wiki.updatePage(actor, current.id, { content: "第二版内容", expectedRevisionId: first.currentRevisionId! });
  const second = await wiki.getPage(actor, current.id);
  const scoped = { projectId: inside.id, pageId: current.id };
  const revisions = await call(ro.token, "page.revisions", scoped);
  check("版本历史可发现并读取正文", revisions.revisions.length === 2 && (await call(ro.token, "page.getRevision", { ...scoped, revisionId: first.currentRevisionId })).content === first.content);
  await call(rw.token, "page.restoreRevision", { ...scoped, revisionId: first.currentRevisionId, expectedRevisionId: first.currentRevisionId, userConfirmed: true }, "VERSION_CONFLICT");
  await call(rw.token, "page.restoreRevision", { ...scoped, revisionId: first.currentRevisionId, expectedRevisionId: second.currentRevisionId, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  const restored = await call(rw.token, "page.restoreRevision", { ...scoped, revisionId: first.currentRevisionId, expectedRevisionId: second.currentRevisionId, userConfirmed: true });
  check("恢复追加新版本且正文正确", restored.id !== first.currentRevisionId && (await wiki.getPage(actor, current.id)).content === first.content);
  const parent = await wiki.createPage(actor, inside.id, { title: "父文档" });
  const foreign = await wiki.createPage(actor, outside.id, { title: "范围外文档" });
  const fresh = await wiki.getPage(actor, current.id);
  await call(rw.token, "page.updateMetadata", { ...scoped, expectedRevisionId: fresh.currentRevisionId, parentId: foreign.id, userConfirmed: true }, "NOT_FOUND");
  const moved = await call(rw.token, "page.updateMetadata", { ...scoped, expectedRevisionId: fresh.currentRevisionId, parentId: parent.id, sortOrder: 5, visibility: "RESTRICTED", userConfirmed: true });
  check("移动排序可见性真实保存", moved.parentId === parent.id && moved.sortOrder === 5 && moved.visibility === "RESTRICTED");
  const permissions = [{ principalType: "MEMBER", principalId: person!.id, canRead: true, canWrite: true }];
  await call(rw.token, "page.setPermissions", { ...scoped, permissions, userConfirmed: true });
  check("受限文档ACL写后复读", (await call(ro.token, "page.getPermissions", scoped)).permissions.some((p: { principalId: string }) => p.principalId === person!.id));
  await call(ro.token, "page.delete", { ...scoped, userConfirmed: true }, "FORBIDDEN");
  await call(rw.token, "page.getPermissions", { projectId: inside.id, pageId: foreign.id }, "NOT_FOUND");
  await call(rw.token, "page.delete", { ...scoped, userConfirmed: true });
  check("删除后列表不再展示文档", !(await wiki.listPages(actor, inside.id)).some(p => p.id === current.id));
  const csv = "编号,标题,类型\n1,交付验收任务,TASK\n2,交付验收缺陷,DEFECT\n";
  const upload = { projectId: inside.id, filename: "真实业务.csv", contentBase64: Buffer.from(csv).toString("base64"), userConfirmed: true };
  await call(ro.token, "import.create", upload, "FORBIDDEN");
  await call(rw.token, "import.create", { ...upload, contentBase64: "%%%" }, "VALIDATION");
  const created = await call(rw.token, "import.create", upload);
  const batch = { projectId: inside.id, batchId: created.batchId };
  check("文件上传后可从批次列表发现", (await call(ro.token, "import.list", { projectId: inside.id })).batches.some((b: { id: string }) => b.id === batch.batchId));
  const suggested = await call(ro.token, "import.suggestions", batch);
  check("映射建议可读取", typeof suggested.fieldMap === "object");
  await call(rw.token, "import.setMapping", { ...batch, fieldMap: { 标题: "title", 类型: "type" }, externalIdColumn: "编号", userConfirmed: true });
  const preview = await call(rw.token, "import.dryRun", { ...batch, userConfirmed: true });
  check("预览准确且未创建业务工作项", preview.willCreate === 2 && (await call(ro.token, "workitem.list", { projectId: inside.id })).total === 0);
  const imported = await call(rw.token, "import.confirm", { ...batch, userConfirmed: true });
  check("确认后持久化两条工作项", imported.created === 2 && (await call(ro.token, "import.get", batch)).status === "SUCCEEDED");
  const replay = await call(rw.token, "import.confirm", { ...batch, userConfirmed: true });
  check("重复确认没有重复创建", replay.created === 0 && replay.skipped === 2);
  const exported = await call(ro.token, "export.workItems", { projectId: inside.id });
  const exportedCsv = Buffer.from(exported.contentBase64, "base64").toString("utf8");
  check("CSV包含中文标题且数量一致", exported.count === 2 && exportedCsv.includes("交付验收任务") && exportedCsv.includes("交付验收缺陷"));
  const pdf = await call(ro.token, "export.projectReport", { projectId: inside.id });
  const pdfText = Buffer.from(pdf.contentBase64, "base64").toString("latin1");
  const expectedText = [..."工作项合计 2 项"].map(c => c.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase();
  check("PDF实际统计当前工作项数量", pdfText.startsWith("%PDF-") && pdfText.includes(expectedText));
  const otherBatch = await imports.createBatch(actor, outside.id, { filename: "other.csv", buffer: Buffer.from(csv) });
  await call(rw.token, "import.get", { projectId: inside.id, batchId: otherBatch.batch.id }, "NOT_FOUND");
  await call(rw.token, "import.confirm", { ...batch, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, rw.row.id));
  await policies.replaceClientPolicies(actor, client!.id, [{ toolName: "import.rollback", effect: "DENY" }]);
  await call(rw.token, "import.rollback", { ...batch, userConfirmed: true }, "FORBIDDEN");
  await policies.replaceClientPolicies(actor, client!.id, []);
  await call(rw.token, "import.rollback", { ...batch, userConfirmed: true });
  check("回滚状态和工作项列表一致", (await call(ro.token, "import.get", batch)).status === "ROLLED_BACK" && (await call(ro.token, "workitem.list", { projectId: inside.id })).total === 0);

  const workbook = execFileSync(process.env.PYTHON_BIN ?? "python3", ["-c", "import openpyxl,io,sys\nw=openpyxl.Workbook();s=w.active\ns.append(['编号','标题','类型']);s.append(['xlsx-1','多人协同验收','TASK']);s.append(['xlsx-2','知识库检索验收','未知类型'])\nb=io.BytesIO();w.save(b);sys.stdout.buffer.write(b.getvalue())"]);
  const excel = await call(rw.token, "import.create", { ...upload, filename: "验收工作项.xlsx", contentBase64: workbook.toString("base64") });
  const excelBatch = { projectId: inside.id, batchId: excel.batchId };
  const mapping = { ...excelBatch, userConfirmed: true, fieldMap: { 标题: "title", 类型: "type" }, externalIdColumn: "编号" };
  await call(rw.token, "import.setMapping", mapping);
  const excelPreview = await call(rw.token, "import.dryRun", { ...excelBatch, userConfirmed: true });
  check("独立生成XLSX预览正确识别合法和失败行", excelPreview.willCreate === 1 && excelPreview.failed === 1);
  const partial = await call(rw.token, "import.confirm", { ...excelBatch, userConfirmed: true });
  check("XLSX部分成功保留失败行及已建工作项", partial.created === 1 && partial.failed === 1 && partial.status === "PARTIAL");
  await call(rw.token, "import.setMapping", { ...mapping, valueMaps: { type: { 未知类型: "REQUIREMENT" } } });
  await call(rw.token, "import.retryFailed", { ...excelBatch, userConfirmed: true }, "CONFLICT");
  const retryPreview = await call(rw.token, "import.dryRun", { ...excelBatch, userConfirmed: true });
  check("修正映射需重新预览且已成功行保持跳过", retryPreview.willCreate === 1 && retryPreview.willSkip === 1 && retryPreview.failed === 0);
  const retried = await call(rw.token, "import.retryFailed", { ...excelBatch, userConfirmed: true });
  const savedExcel = await call(ro.token, "import.get", excelBatch);
  check("修正映射后只重试失败行且统计累计正确", retried.created === 1 && retried.failed === 0 && savedExcel.createdCount === 2 && savedExcel.status === "SUCCEEDED" && (await call(ro.token, "workitem.list", { projectId: inside.id })).total === 2);
  await call(rw.token, "import.rollback", { ...excelBatch, userConfirmed: true });
  check("XLSX重试后可完整回滚且重复回滚幂等", (await call(rw.token, "import.rollback", { ...excelBatch, userConfirmed: true })).alreadyRolledBack && (await call(ro.token, "workitem.list", { projectId: inside.id })).total === 0);

  const permissionArgs: Record<string, Record<string, unknown>> = {
    "page.restoreRevision": { projectId: inside.id, pageId: parent.id, revisionId: parent.currentRevisionId, expectedRevisionId: parent.currentRevisionId },
    "page.updateMetadata": { projectId: inside.id, pageId: parent.id, title: "禁止写入", expectedRevisionId: parent.currentRevisionId },
    "page.setPermissions": { projectId: inside.id, pageId: parent.id, permissions },
    "page.delete": { projectId: inside.id, pageId: parent.id },
    "import.create": upload, "import.setMapping": mapping, "import.dryRun": excelBatch,
    "import.confirm": excelBatch, "import.retryFailed": excelBatch, "import.rollback": excelBatch,
  };
  for (const [name, args] of Object.entries(permissionArgs)) {
    const { userConfirmed: _confirmation, ...input } = args;
    await call(ro.token, name, { ...input, userConfirmed: true }, "FORBIDDEN");
    await call(rw.token, name, { ...input, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    await call(rw.token, name, input, "VALIDATION");
    await policies.replaceClientPolicies(actor, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(rw.token, name, { ...input, userConfirmed: true }, "FORBIDDEN");
    await policies.replaceClientPolicies(actor, client!.id, []);
    await call(rw.token, name, { ...input, projectId: outside.id, userConfirmed: true }, "NOT_FOUND");
  }
  check("全部10个新增写工具拒绝只读、未确认、缺确认、DENY及范围外项目", true);
  const boundary = await call(rw.token, "workitem.create", { projectId: inside.id, type: "TASK", title: "导出边界", userConfirmed: true });
  // 大导出数据只用于限长验证，不经过循环创建数千工作项。
  await sql`update work_item set title = ${"导".repeat(180_000)} where id = ${boundary.result.id}`;
  const oversized = await call(ro.token, "export.workItems", { projectId: inside.id }, "VALIDATION");
  check("超限导出不向MCP注入整块文件并提供鉴权下载路径", oversized.details?.downloadPath === `/api/v1/projects/${inside.id}/work-items/export` && oversized.details?.maxBytes === 512 * 1024);
  console.log(`内容闭环 ${checks}/${checks}`);
} finally { await app.close(); await sql.end(); }
