/** 文档维护、导入导出；业务逻辑与 REST 共用服务层。 */
import { z } from "zod";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { DomainError } from "../../../shared/errors.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import { projectForMcpResource } from "../../services/mcp-resource.service.ts";
import * as wiki from "../../services/wiki.service.ts";
import { organizePage } from "../../services/page-structure.service.ts";
import { organizePageSchema } from "../../../shared/schemas/page-structure.ts";
import * as imports from "../../services/import.service.ts";
import { exportWorkItemsCsv } from "../../services/export.service.ts";
import { projectReport } from "../../services/report.service.ts";

const uuid = z.string().uuid();
const project = { projectId: uuid };
const pageRef = { ...project, pageId: uuid };
const batchRef = { ...project, batchId: uuid };
const confirmed = { userConfirmed: z.boolean().describe("用户已明确确认本次业务写入") };
const record = z.record(z.string(), z.unknown());
const entity = z.object({ id: uuid }).passthrough();
const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: "draft-7" }) as NonNullable<ToolDef["outputSchema"]>;
const tool = (name: string, kind: ToolDef["kind"], description: string, input: z.ZodType, output: z.ZodType, handler: ToolDef["handler"]): ToolDef => ({ name, kind, description, inputSchema: schema(input), outputSchema: schema(output), handler });

async function pageFor(ctx: ToolCtx, args: Record<string, unknown>) {
  // ACL 管理允许管理员修复自己无权读取的受限页，不能以 getPage 代替归属校验。
  if (await projectForMcpResource("page", String(args.pageId)) !== args.projectId) throw new DomainError("NOT_FOUND", "文档不存在", null);
  if (typeof args.parentId === "string" && await projectForMcpResource("page", args.parentId) !== args.projectId) throw new DomainError("NOT_FOUND", "父文档不存在", null);
  void ctx;
}
async function batchFor(ctx: ToolCtx, args: Record<string, unknown>) {
  const batch = await imports.getBatch(ctx.actor, String(args.batchId));
  if (batch.projectId !== args.projectId) throw new DomainError("NOT_FOUND", "导入批次不存在", null);
  return batch;
}
const write = (handler: ToolDef["handler"]): ToolDef["handler"] => async (ctx, args) => {
  requireUserConfirmation(args.userConfirmed === true); return handler(ctx, args);
};
const fileOutput = z.object({ filename: z.string(), mimeType: z.string(), contentBase64: z.string(), size: z.number().int().nonnegative() });
function inlineFile(buffer: Buffer, filename: string, mimeType: string, downloadPath: string) {
  const maxBytes = 512 * 1024;
  if (buffer.length > maxBytes) throw new DomainError("VALIDATION", "文件超过MCP内联512KiB上限，请使用已鉴权的文件下载接口", { size: buffer.length, maxBytes, downloadPath });
  return { filename, mimeType, contentBase64: buffer.toString("base64"), size: buffer.length };
}
const importResult = z.object({ created: z.number(), skipped: z.number(), failed: z.number(), status: z.string(), errorReport: z.array(record) });

export const CONTENT_TOOLS: ToolDef[] = [
  tool("page.organize", "write", "整理文件夹或文档：重命名、移动、归档或恢复。先 page.get 读取 structureVersion，传 expectedStructureVersion 防止覆盖并发整理。归档/恢复须单独操作并检查整个子树权限；归档内容立即退出RAG。目录不授予子文档访问权。操作不改正文版本，完成后 page.get/list 核验。", organizePageSchema.safeExtend({ ...pageRef, ...confirmed }), entity, write(async (ctx, args) => {
    await pageFor(ctx, args);
    const { projectId: _project, pageId, userConfirmed: _confirmed, ...patch } = args;
    return organizePage(ctx.actor, String(pageId), patch as Parameters<typeof organizePage>[2]);
  })),
  tool("page.revisions", "read", "读取文档历史版本列表，用 page.getRevision 查看正文，恢复会追加新版本。", z.object(pageRef).strict(), z.object({ revisions: z.array(entity) }), async (ctx, args) => {
    await pageFor(ctx, args); return { revisions: await wiki.listRevisions(ctx.actor, String(args.pageId)) };
  }),
  tool("page.getRevision", "read", "读取指定文档历史版本正文；版本必须属于该页。", z.object({ ...pageRef, revisionId: uuid }).strict(), entity.extend({ content: z.string() }), async (ctx, args) => {
    await pageFor(ctx, args); return wiki.getRevision(ctx.actor, String(args.pageId), String(args.revisionId));
  }),
  tool("page.restoreRevision", "write", "恢复历史正文为一个新版本。必须先读 currentRevisionId，传 expectedRevisionId 防止覆盖并发修改，且用户已确认。", z.object({ ...pageRef, revisionId: uuid, expectedRevisionId: uuid, ...confirmed }).strict(), entity, write(async (ctx, args) => {
    await pageFor(ctx, args); return wiki.restoreRevision(ctx.actor, String(args.pageId), String(args.revisionId), String(args.expectedRevisionId));
  })),
  tool("page.updateMetadata", "write", "修改文档标题、树位置、顺序或可见性；使用当前 revision 比较并要求确认。正文编辑使用 page.update。", z.object({ ...pageRef, ...confirmed, expectedRevisionId: uuid, expectedStructureVersion: z.number().int().positive().optional(), title: z.string().min(1).max(300).optional(), parentId: uuid.nullable().optional(), sortOrder: z.number().int().optional(), visibility: z.enum(["PROJECT", "RESTRICTED"]).optional() }).strict(), entity, write(async (ctx, args) => {
    await pageFor(ctx, args); const { projectId: _project, pageId, userConfirmed: _confirmed, ...patch } = args;
    return wiki.updatePage(ctx.actor, String(pageId), patch as Parameters<typeof wiki.updatePage>[2]);
  })),
  tool("page.getPermissions", "read", "读取文档授权列表；要求页面权限管理能力。", z.object(pageRef).strict(), z.object({ permissions: z.array(record) }), async (ctx, args) => {
    await pageFor(ctx, args); return { permissions: await wiki.listPermissions(ctx.actor, String(args.pageId)) };
  }),
  tool("page.setPermissions", "write", "替换受限文档的授权列表；先读取现有授权，展示完整变化并取得确认。至少保留一个可读主体。", z.object({ ...pageRef, ...confirmed, permissions: z.array(z.object({ principalType: z.enum(["MEMBER", "TEAM", "ROLE"]), principalId: uuid, canRead: z.boolean(), canWrite: z.boolean() }).strict()).max(200) }).strict(), z.object({ permissions: z.array(record) }), write(async (ctx, args) => {
    await pageFor(ctx, args); return { permissions: await wiki.setPermissions(ctx.actor, String(args.pageId), args.permissions as Parameters<typeof wiki.setPermissions>[2]) };
  })),
  tool("page.delete", "write", "确认后软删除文档，清理关联；再次用 page.list 核验。", z.object({ ...pageRef, ...confirmed }).strict(), z.object({ ok: z.boolean() }), write(async (ctx, args) => {
    await pageFor(ctx, args); await wiki.deletePage(ctx.actor, String(args.pageId)); return { ok: true };
  })),
  tool("import.create", "write", "上传 CSV 或 XLSX 并创建待确认批次。内联文件上限512KiB；仅解析文件，不自动导入业务。随后建议映射、setMapping、dryRun、confirm。", z.object({ ...project, ...confirmed, filename: z.string().min(1).max(255), contentBase64: z.string().min(4).max(699052), encoding: z.enum(["utf-8", "gbk", "gb18030", "utf-16le", "utf-16be"]).optional() }).strict(), z.object({ batchId: uuid, status: z.string(), totalRows: z.number(), encoding: z.string(), header: z.array(z.string()), sampleRows: z.array(record) }), write(async (ctx, args) => {
    const encoded = String(args.contentBase64);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new DomainError("VALIDATION", "文件不是合法的 base64", null);
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length > 512 * 1024 || buffer.toString("base64") !== encoded) throw new DomainError("VALIDATION", "内联文件超过512KiB或编码不规范，请通过文件上传接口提交", null);
    const result = await imports.createBatch(ctx.actor, String(args.projectId), { filename: String(args.filename), buffer, encoding: args.encoding as string | undefined, source: "CSV" });
    return { batchId: result.batch.id, status: result.batch.status, totalRows: result.batch.totalRows, encoding: result.encoding, header: result.header, sampleRows: result.sampleRows };
  })),
  tool("import.list", "read", "列出项目最近50个导入批次和处理状态。", z.object(project).strict(), z.object({ batches: z.array(entity) }), async (ctx, args) => ({ batches: await imports.listBatches(ctx.actor, String(args.projectId)) })),
  tool("import.get", "read", "读取导入批次、映射与有界行和错误报告，使用offset/limit分别翻页。", z.object({ ...batchRef, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(), errorOffset: z.number().int().min(0).optional(), errorLimit: z.number().int().min(1).max(100).optional() }).strict(), entity, async (ctx, args) => {
    const batch = await batchFor(ctx, args);
    const rows = Array.isArray(batch.rows) ? batch.rows : [], errors = Array.isArray(batch.errorReport) ? batch.errorReport : [];
    const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20), errorOffset = Number(args.errorOffset ?? 0), errorLimit = Number(args.errorLimit ?? 20);
    return { ...batch, rows: rows.slice(offset, offset + limit), offset, limit, hasMore: offset + limit < rows.length, errorReport: errors.slice(errorOffset, errorOffset + errorLimit), errorOffset, errorLimit, errorCount: errors.length, errorHasMore: errorOffset + errorLimit < errors.length };
  }),
  tool("import.suggestions", "read", "读取按文件表头产生的映射建议；建议必须经用户确认后才应用。", z.object(batchRef).strict(), record, async (ctx, args) => { await batchFor(ctx, args); return imports.suggestForBatch(ctx.actor, String(args.batchId)); }),
  tool("import.setMapping", "write", "确认后保存字段、枚举和人员映射；不创建工作项。", z.object({ ...batchRef, ...confirmed, fieldMap: z.record(z.string(), z.string()), valueMaps: z.record(z.string(), z.record(z.string(), z.string())).optional(), userMap: z.record(z.string(), uuid).optional(), externalIdColumn: z.string().nullable().optional(), defaultType: z.enum(["TASK", "REQUIREMENT", "DEFECT", "SUBTASK"]).optional() }).strict(), entity, write(async (ctx, args) => {
    await batchFor(ctx, args); const { projectId: _project, batchId, userConfirmed: _confirmed, ...mapping } = args;
    await imports.setMapping(ctx.actor, String(batchId), mapping as unknown as imports.MappingInput);
    return imports.getBatch(ctx.actor, String(batchId));
  })),
  tool("import.dryRun", "write", "试运行已确认映射，更新预览状态并返回将创建、跳过、失败数量，不写工作项。", z.object({ ...batchRef, ...confirmed }).strict(), z.object({ totalRows: z.number(), willCreate: z.number(), willSkip: z.number(), failed: z.number(), errorReport: z.array(record) }), write(async (ctx, args) => { await batchFor(ctx, args); return imports.dryRun(ctx.actor, String(args.batchId)); })),
  ...(["confirm", "retryFailed"] as const).map(action => tool(`import.${action}`, "write", action === "confirm" ? "用户确认预览后执行导入；同项目外部ID去重。完成后读取批次与工作项核对。" : "仅重试批次中的失败行，已成功工作项不重复创建。", z.object({ ...batchRef, ...confirmed }).strict(), importResult, write(async (ctx, args) => { await batchFor(ctx, args); return imports.confirm(ctx.actor, String(args.batchId), { retryFailedOnly: action === "retryFailed" }); }))),
  tool("import.rollback", "write", "确认后回滚该批次创建的工作项，保留历史映射，重复回滚幂等。", z.object({ ...batchRef, ...confirmed }).strict(), z.object({ ok: z.boolean(), alreadyRolledBack: z.boolean(), removed: z.number(), retainedModified: z.number(), retainedUnknown: z.number(), skippedDeleted: z.number() }), write(async (ctx, args) => { await batchFor(ctx, args); return imports.rollback(ctx.actor, String(args.batchId)); })),
  tool("export.workItems", "read", "按当前项目和筛选导出工作项 CSV，返回UTF-8 BOM文件的base64和准确行数。", z.object({ ...project, q: z.string().max(300).optional(), type: z.string().max(30).optional(), priority: z.string().max(20).optional(), severity: z.string().max(20).optional(), statusCategory: z.string().max(30).optional(), assigneeId: uuid.optional(), milestoneId: uuid.optional() }).strict(), fileOutput.extend({ count: z.number() }), async (ctx, args) => {
    const { projectId, ...filters } = args; const result = await exportWorkItemsCsv(ctx.actor, String(projectId), filters);
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString();
    return { ...inlineFile(Buffer.from(result.csv), `work-items-${projectId}.csv`, "text/csv;charset=utf-8", `/api/v1/projects/${projectId}/work-items/export${query ? `?${query}` : ""}`), count: result.count };
  }),
  tool("export.projectReport", "read", "导出当前项目的PDF统计报告，返回文件base64。仅含可核对的业务数字，不含模型总结。", z.object(project).strict(), fileOutput, async (ctx, args) => {
    const result = await projectReport(ctx.actor, String(args.projectId)); return inlineFile(result.buffer, result.filename, "application/pdf", `/api/v1/projects/${args.projectId}/report.pdf`);
  }),
];
