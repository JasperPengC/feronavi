/** 工作流、导入和本人效率工具。所有操作复用现有领域服务。 */
import { z } from "zod";
import { businessTool as tool, id, text, date, ok } from "./business-tool.ts";
import type { ToolCtx, ToolDef } from "../tools.ts";
import * as workflow from "../../../services/workflow-config.service.ts";
import * as imports from "../../../services/import.service.ts";
import * as focus from "../../../services/focus.service.ts";
import * as workbench from "../../../services/workbench.service.ts";
import * as project from "../../../services/project.service.ts";
import { projectForMcpResource } from "../../../services/mcp-resource.service.ts";
import { DomainError } from "../../../../shared/errors.ts";

const personal = { scope: "personal" } as const;
const destructive = { destructive: true };
const types = z.enum(["TASK", "REQUIREMENT", "DEFECT", "SUBTASK"]);
const workflowId = { workflowId: id };
const iso = z.string().datetime({ offset: true });
async function visibleWorkflow(ctx: ToolCtx, workflowId: string) {
  const projectId = await projectForMcpResource("workflow", workflowId);
  if (!projectId) throw new DomainError("NOT_FOUND", "项目工作流不存在", null);
  await project.getProjectDetail(ctx.actor, projectId);
}
function wf<S extends z.ZodRawShape>(name: string, description: string, kind: "read" | "write", shape: S,
  handler: (ctx: ToolCtx, args: z.infer<z.ZodObject<S>>) => Promise<unknown>) {
  return tool(name, description, kind, shape, async (ctx, args) => {
    const values = args as Record<string, unknown>;
    if (typeof values.workflowId === "string") await visibleWorkflow(ctx, values.workflowId);
    if (typeof values.projectId === "string") await project.getProjectDetail(ctx.actor, values.projectId);
    return handler(ctx, args);
  }, kind === "write" ? destructive : {});
}

export const OPERATIONS_TOOLS: ToolDef[] = [
  wf("workflow.list", "读取项目工作流及 ID；先读此项再配置状态和迁移。", "read", { projectId: id }, (c, a) => workflow.listWorkflows(c.actor, a.projectId)),
  wf("workflow.create", "创建项目工作流；新增状态和迁移后才能设为默认，需用户确认。", "write", { projectId: id, name: text, appliesToType: types }, (c, a) => workflow.createWorkflow(c.actor, a)),
  wf("workflow.update", "修改项目工作流名称或默认设置；先读取配置并确认影响。", "write", { ...workflowId, name: text.optional(), isDefault: z.boolean().optional() }, (c, { workflowId, ...a }) => workflow.updateWorkflow(c.actor, workflowId, a)),
  wf("workflow.states", "读取工作流状态及真实 ID。", "read", workflowId, (c, a) => workflow.listStates(c.actor, a.workflowId)),
  wf("workflow.addState", "添加状态；key 为稳定标识，需先确认。", "write", { ...workflowId, key: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), name: z.string().min(1).max(60), category: z.enum(["NOT_STARTED", "IN_PROGRESS", "TERMINAL"]), sortOrder: z.number().int().min(0).optional(), wipLimit: z.number().int().min(1).max(999).nullable().optional() }, (c, { workflowId, ...a }) => workflow.addState(c.actor, workflowId, a)),
  wf("workflow.updateState", "调整状态名称、顺序或 WIP 限制；需确认。", "write", { ...workflowId, stateId: id, name: z.string().min(1).max(60).optional(), sortOrder: z.number().int().min(0).optional(), wipLimit: z.number().int().min(1).max(999).nullable().optional() }, (c, { workflowId, stateId, ...a }) => workflow.updateState(c.actor, workflowId, stateId, a)),
  wf("workflow.archiveState", "归档未使用状态；有工作项引用则拒绝，需确认。", "write", { ...workflowId, stateId: id }, (c, a) => ok(workflow.archiveState(c.actor, a.workflowId, a.stateId))),
  wf("workflow.transitions", "读取迁移边、审批设置和 ID。", "read", workflowId, (c, a) => workflow.listTransitions(c.actor, a.workflowId)),
  wf("workflow.addTransition", "在同一工作流建立迁移边；先读取状态并确认。", "write", { ...workflowId, fromStateId: id, toStateId: id }, (c, { workflowId, ...a }) => workflow.addTransition(c.actor, workflowId, a)),
  wf("workflow.updateTransition", "设置迁移是否需要审批及审批角色；需确认。", "write", { ...workflowId, transitionId: id, requiresApproval: z.boolean().optional(), approverRoleKeys: z.array(z.string().min(1).max(80)).max(20).optional() }, (c, { workflowId, transitionId, ...a }) => workflow.updateTransition(c.actor, workflowId, transitionId, a)),
  wf("workflow.removeTransition", "删除迁移边；先读取并确认。", "write", { ...workflowId, transitionId: id }, (c, a) => ok(workflow.removeTransition(c.actor, a.workflowId, a.transitionId))),

  tool("import.create", "上传 CSV/XLSX（base64，最大 8 MiB）创建待映射批次；不自动导入。", "write", { projectId: id, filename: z.string().max(200), contentBase64: z.string().min(4).max(11184812), source: z.enum(["CSV", "ZENTAO_API", "JIRA_API"]).optional(), encoding: z.string().max(40).optional() }, async (c, { projectId, filename, contentBase64, ...a }) => {
    const buffer = Buffer.from(contentBase64, "base64");
    if (buffer.byteLength > 8 * 1024 * 1024 || buffer.toString("base64").replace(/=+$/u, "") !== contentBase64.replace(/=+$/u, "")) throw new DomainError("VALIDATION", "文件必须是有效 base64 且不超过 8 MiB", null);
    const result = await imports.createBatch(c.actor, projectId, { ...a, filename, buffer });
    return { batchId: result.batch.id, status: result.batch.status, totalRows: result.batch.totalRows, header: result.header, sampleRows: result.sampleRows, encoding: result.encoding };
  }),
  tool("import.list", "列出项目导入批次执行摘要及失败报告数量；完整报告用 get 分页读取。", "read", { projectId: id }, async (c, a) => {
    const batches = await imports.listBatches(c.actor, a.projectId);
    return batches.map(({ errorReport, mappingConfig: _mappingConfig, ...summary }) => ({
      ...summary, errorCount: Array.isArray(errorReport) ? errorReport.length : 0,
    }));
  }),
  tool("import.get", "读取批次、映射、有界行预览和失败报告；行与错误报告分别使用 offset/limit 和 errorOffset/errorLimit 翻页。", "read", {
    batchId: id,
    offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(),
    errorOffset: z.number().int().min(0).optional(), errorLimit: z.number().int().min(1).max(100).optional(),
  }, async (c, a) => {
    const result = await imports.getBatch(c.actor, a.batchId);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const errors = Array.isArray(result.errorReport) ? result.errorReport : [];
    const offset = a.offset ?? 0, limit = a.limit ?? 20;
    const errorOffset = a.errorOffset ?? 0, errorLimit = a.errorLimit ?? 20;
    return {
      ...result, rows: rows.slice(offset, offset + limit), offset, limit, hasMore: offset + limit < rows.length,
      errorReport: errors.slice(errorOffset, errorOffset + errorLimit), errorOffset, errorLimit,
      errorCount: errors.length, errorHasMore: errorOffset + errorLimit < errors.length,
    };
  }),
  tool("import.suggestions", "获取字段映射建议；建议须经用户确认后用 setMapping 保存。", "read", { batchId: id }, (c, a) => imports.suggestForBatch(c.actor, a.batchId)),
  tool("import.setMapping", "保存已确认的字段/枚举/成员映射；随后 dryRun 再 confirm。", "write", { batchId: id, fieldMap: z.record(z.string(), z.string()), valueMaps: z.record(z.string(), z.record(z.string(), z.string())).optional(), userMap: z.record(z.string(), id).optional(), externalIdColumn: z.string().nullable().optional(), defaultType: types.optional() }, (c, { batchId, ...a }) => imports.setMapping(c.actor, batchId, a)),
  tool("import.dryRun", "试运行批次并保存逐行校验报告，不创建工作项。", "write", { batchId: id }, (c, a) => imports.dryRun(c.actor, a.batchId)),
  tool("import.confirm", "执行已映射且预演通过的导入；必须用户确认。完成后 get/list 复读。", "write", { batchId: id, retryFailedOnly: z.boolean().optional() }, (c, a) => imports.confirm(c.actor, a.batchId, { retryFailedOnly: a.retryFailedOnly }), destructive),
  tool("import.rollback", "回滚本批次导入项；已修改的记录按服务策略保留，需确认并复读报告。", "write", { batchId: id }, (c, a) => imports.rollback(c.actor, a.batchId), destructive),

  tool("workbench.get", "读取本人工作台；聚合跨项目，需未限制项目令牌。", "read", {}, (c) => workbench.workbench(c.actor), personal),
  tool("todo.list", "列出本人待办，可按完成状态过滤。", "read", { done: z.boolean().optional() }, (c, a) => workbench.listTodos(c.actor, a), personal),
  tool("todo.create", "创建本人待办。", "write", { title: text, dueDate: date.nullable().optional() }, (c, a) => workbench.createTodo(c.actor, a), personal),
  tool("todo.update", "修改本人待办或标记完成；再 list 复读。", "write", { todoId: id, title: text.optional(), dueDate: date.nullable().optional(), done: z.boolean().optional() }, (c, { todoId, ...a }) => workbench.updateTodo(c.actor, todoId, a), personal),
  tool("todo.delete", "删除本人待办，需确认。", "write", { todoId: id }, (c, a) => ok(workbench.deleteTodo(c.actor, a.todoId)), { ...personal, ...destructive }),
  tool("focus.blocks", "读取本人的时间块。", "read", { from: iso.optional(), to: iso.optional() }, (c, a) => focus.listBlocks(c.actor, a), personal),
  tool("focus.getBlock", "精确读取本人时间块；不受日期筛选和集合数量限制。", "read", { timeBlockId: id }, (c, a) => focus.getBlock(c.actor, a.timeBlockId), personal),
  tool("focus.getSession", "精确读取本人已结束的专注记录；可读取历史日期。", "read", { focusSessionId: id }, (c, a) => focus.getSession(c.actor, a.focusSessionId), personal),
  tool("focus.createBlock", "创建本人时间块；重叠会返回 CONFLICT。", "write", { title: text, startAt: iso, endAt: iso, projectId: id.nullable().optional(), workItemId: id.nullable().optional(), color: z.string().max(32).nullable().optional() }, async (c, a) => {
    if (a.projectId) await project.getProjectDetail(c.actor, a.projectId);
    if (a.workItemId) { const p = await projectForMcpResource("workItem", a.workItemId); if (!p || (a.projectId && p !== a.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null); await project.getProjectDetail(c.actor, p); }
    return focus.createBlock(c.actor, a);
  }, personal),
  tool("focus.updateBlock", "修改本人时间块的内容与时间；重叠须调整时间重试。", "write", { timeBlockId: id, title: text.optional(), startAt: iso.optional(), endAt: iso.optional(), color: z.string().max(32).nullable().optional() }, (c, { timeBlockId, ...a }) => focus.updateBlock(c.actor, timeBlockId, a), personal),
  tool("focus.deleteBlock", "删除本人时间块，需确认。", "write", { timeBlockId: id }, (c, a) => ok(focus.deleteBlock(c.actor, a.timeBlockId)), { ...personal, ...destructive }),
  tool("focus.sessions", "读取本人某日已结束的专注会话。", "read", { day: date.optional() }, (c, a) => focus.listFocusSessions(c.actor, a), personal),
  tool("focus.recordSession", "记录本人已结束的专注会话，随后 sessions 复读。", "write", { timeBlockId: id, startedAt: iso, endedAt: iso, note: z.string().max(2000).nullable().optional(), actualMinutes: z.number().int().min(0).max(1440).optional() }, (c, a) => focus.recordFocusSession(c.actor, a), personal),
  tool("focus.updateSession", "修正本人专注会话备注或时长。", "write", { focusSessionId: id, note: z.string().max(2000).nullable().optional(), actualMinutes: z.number().int().min(0).max(1440).optional() }, (c, { focusSessionId, ...a }) => focus.updateFocusSession(c.actor, focusSessionId, a), personal),
  tool("focus.today", "读取本人今日或指定日期的聚焦摘要。", "read", { day: date.optional() }, (c, a) => focus.todayFocus(c.actor, a.day), personal),
];
