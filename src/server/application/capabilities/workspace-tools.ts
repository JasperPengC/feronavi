/** 原生工作空间业务：复用REST服务，按实际资源归属保护个人与项目范围。 */
import { z } from "zod";
import { DomainError } from "../../../shared/errors.ts";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { projectAllowed } from "../../services/token.service.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import { projectForMcpResource, mcpIntakeFormProject, mcpIntakeSubmissionProject, mcpSavedView, mcpDashboard, mcpDashboardWidget, mcpTimeBlock, type McpResourceKind } from "../../services/mcp-resource.service.ts";
import * as projectRepo from "../../repos/project.repo.ts";
import * as portfolios from "../../services/portfolio.service.ts";
import * as intake from "../../services/intake.service.ts";
import * as workbench from "../../services/workbench.service.ts";
import * as focus from "../../services/focus.service.ts";
import * as plans from "../../services/planning.service.ts";
import * as insight from "../../services/insight.service.ts";

const uuid = z.string().uuid();
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const integer = z.number().int();
const record = z.record(z.string(), z.unknown());
const scope = { projectId: uuid };
const optionalScope = { projectId: uuid.nullable().optional() };
const confirmed = { userConfirmed: z.boolean().describe("用户已明确确认本次业务写入") };
const ok = z.object({ ok: z.boolean() });
const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: "draft-7" }) as NonNullable<ToolDef["outputSchema"]>;
const missing = () => new DomainError("NOT_FOUND", "资源不存在或不属于指定项目", null);
const invalid = (message: string) => new DomainError("VALIDATION", message, null);
function accountScope(ctx: ToolCtx) {
  if (!projectAllowed(ctx.token, null)) throw new DomainError("FORBIDDEN", "个人和跨项目业务需要未限制项目的令牌", null);
}
async function canSeeProject(ctx: ToolCtx, projectId: string) {
  return !!await projectRepo.findById(projectId) && await projectRepo.isVisibleTo(ctx.actor.memberId, projectId, ctx.actor.grants.some(grant => grant.scopeType === "ORG"));
}
async function visibleRows<T extends { projectId: string | null }>(ctx: ToolCtx, rows: T[]) {
  const visible = new Map<string, boolean>();
  for (const row of rows) if (row.projectId && !visible.has(row.projectId)) visible.set(row.projectId, await canSeeProject(ctx, row.projectId));
  return rows.filter(row => !row.projectId || visible.get(row.projectId));
}
async function projectScope(ctx: ToolCtx, projectId: string | null, expected?: unknown) {
  if (expected !== undefined && expected !== projectId) throw missing();
  if (!projectId) { accountScope(ctx); return; }
  if (!projectAllowed(ctx.token, projectId)) throw missing();
  if (!await canSeeProject(ctx, projectId)) {
    throw new DomainError("FORBIDDEN", "无权访问项目", null);
  }
}
async function resourceScope(ctx: ToolCtx, kind: McpResourceKind, id: string, expected?: unknown) {
  const projectId = await projectForMcpResource(kind, id);
  if (!projectId) throw missing();
  await projectScope(ctx, projectId, expected);
  return projectId;
}
async function formFor(ctx: ToolCtx, args: Record<string, unknown>) {
  const projectId = await mcpIntakeFormProject(String(args.formId));
  if (!projectId) throw missing();
  await projectScope(ctx, projectId, args.projectId);
}
async function viewFor(ctx: ToolCtx, args: Record<string, unknown>, id = String(args.savedViewId)) {
  const row = await mcpSavedView(id);
  if (!row) throw missing();
  await projectScope(ctx, row.projectId, args.projectId);
  return row;
}
async function dashboardFor(ctx: ToolCtx, args: Record<string, unknown>) {
  const row = await mcpDashboard(String(args.dashboardId));
  if (!row) throw missing();
  await projectScope(ctx, row.projectId, args.projectId);
  return row;
}
/** 中央guard仍负责schema、档位；本模块精确处理无法由顶层projectId表达的资源。 */
async function assertWorkspaceScope(ctx: ToolCtx, name: string, args: Record<string, unknown>) {
  if (/^(portfolio|todo|focus)\./.test(name)) { accountScope(ctx); return; }
  if (name.startsWith("intake.")) {
    await projectScope(ctx, String(args.projectId));
    if (args.formId) await formFor(ctx, args);
    if (args.submissionId) {
      const projectId = await mcpIntakeSubmissionProject(String(args.submissionId));
      if (!projectId) throw missing();
      await projectScope(ctx, projectId, args.projectId);
    }
    return;
  }
  if (name.startsWith("savedView.")) {
    if (args.savedViewId) await viewFor(ctx, args);
    else if (name === "savedView.reorder") {
      // 无projectId的排序是账号操作；提供projectId时全部ID仍逐项核对。
      await projectScope(ctx, args.projectId as string | null | undefined ?? null);
      for (const id of args.ids as string[]) await viewFor(ctx, args, id);
    } else await projectScope(ctx, args.projectId as string | null | undefined ?? null);
    return;
  }
  if (name.startsWith("dashboard.")) {
    if (args.dashboardId) await dashboardFor(ctx, args);
    else await projectScope(ctx, args.projectId as string | null | undefined ?? null);
    return;
  }
  if (name.startsWith("insight.")) {
    if (args.iterationId) await resourceScope(ctx, "iteration", String(args.iterationId), args.projectId);
    else await projectScope(ctx, String(args.projectId));
    return;
  }
  throw new DomainError("FORBIDDEN", "工具未声明资源范围", null);
}
function tool(name: string, kind: ToolDef["kind"], description: string, input: z.ZodType, output: z.ZodType, handler: ToolDef["handler"]): ToolDef {
  return {
    name, kind, description, inputSchema: schema(input), outputSchema: schema(output),
    handler: async (ctx, raw) => {
      const parsed = input.safeParse(raw);
      if (!parsed.success) throw invalid("工具参数不合法");
      const args = parsed.data as Record<string, unknown>;
      if (kind === "write") requireUserConfirmation(args.userConfirmed === true);
      await assertWorkspaceScope(ctx, name, args);
      const result = await handler(ctx, args);
      // 日期与REST保持JSON表示；输出白名单同时排除内部hash等敏感字段。
      return output.parse(JSON.parse(JSON.stringify(result)));
    },
  };
}
function patch(args: Record<string, unknown>, keys: string[]) {
  const result = Object.fromEntries(keys.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
  if (!Object.keys(result).length) throw invalid("至少提供一个可修改字段");
  return result;
}
async function focusReferences(ctx: ToolCtx, refs: { projectId?: string | null; workItemId?: string | null }) {
  if (refs.projectId) await projectScope(ctx, refs.projectId);
  if (refs.workItemId) await resourceScope(ctx, "workItem", refs.workItemId, refs.projectId || undefined);
}
const referenceKinds: Record<string, McpResourceKind> = { workItemId: "workItem", iterationId: "iteration", milestoneId: "milestone", releaseId: "release", moduleId: "module", pageId: "page", ideaId: "idea" };
async function viewReferences(ctx: ToolCtx, projectId: string | null, value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "projectId" && typeof child === "string") await projectScope(ctx, child, projectId ?? undefined);
    else if (key === "projectIds" && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string") await projectScope(ctx, id, projectId ?? undefined);
    } else if (referenceKinds[key] && typeof child === "string") await resourceScope(ctx, referenceKinds[key]!, child, projectId ?? undefined);
    else if (key.endsWith("Ids") && referenceKinds[key.slice(0, -1)] && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string") await resourceScope(ctx, referenceKinds[key.slice(0, -1)]!, id, projectId ?? undefined);
    } else await viewReferences(ctx, projectId, child);
  }
}
const widgetType = z.enum(["BURNDOWN", "CUMULATIVE_FLOW", "ACTIVITY_HEATMAP", "PIE", "LIST", "COUNT"]);
// 现有UI为无迭代的普通挂件保存空字符串；它不代表资源引用。
const widgetConfig = z.object({ iterationId: z.union([uuid, z.literal("")]).optional() }).strict();
async function widgetReferences(ctx: ToolCtx, projectId: string | null, type: string, config: unknown) {
  const parsed = widgetConfig.safeParse(config ?? {});
  if (!parsed.success) throw invalid("挂件配置只支持iterationId，非空时必须为UUID");
  if ((type === "BURNDOWN" || type === "CUMULATIVE_FLOW") && !parsed.data.iterationId) throw invalid("燃尽和累积流挂件必须指定iterationId");
  if (parsed.data.iterationId) await resourceScope(ctx, "iteration", parsed.data.iterationId, projectId ?? undefined);
}
async function widgetFor(ctx: ToolCtx, args: Record<string, unknown>) {
  const parent = await dashboardFor(ctx, args);
  const row = await mcpDashboardWidget(String(args.widgetId));
  if (!row || row.dashboardId !== parent.id) throw missing();
  return { parent, row };
}

const portfolioRow = z.object({ id: uuid, name: z.string(), ownerId: uuid, createdAt: instant });
const portfolioCounts = { projectCount: integer, workItemCount: integer };
const projectBrief = z.object({ id: uuid, key: z.string(), name: z.string() });
const portfolioSummary = z.object({
  portfolio: z.object({ id: uuid, name: z.string(), createdAt: instant }),
  projects: z.array(projectBrief.extend({
    status: z.object({ key: z.string(), name: z.string(), category: z.string() }).nullable(),
    total: integer, done: integer, overdue: integer, progress: z.number(),
    insights: z.object({ overdueMilestones: integer, overdueWorkItems: integer, urgentDefects: integer, lastActivityAt: z.string().nullable(), memberCount: integer }).nullable(),
  })),
  totals: z.object({ ...portfolioCounts, doneCount: integer, overdueCount: integer, completionPercent: z.number() }),
  risks: z.array(z.object({ projectId: uuid, projectName: z.string(), type: z.string(), count: integer })),
  milestones: z.array(z.object({ id: uuid, projectId: uuid, name: z.string(), dueDate: date.nullable(), completedAt: instant.nullable(), archivedAt: instant.nullable(), projectName: z.string() })),
  activity: z.array(z.object({ id: uuid, projectId: uuid.nullable(), summary: z.string().nullable(), createdAt: instant, projectName: z.string() })),
});
const intakeField = z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), label: text(200), type: z.enum(["TEXT", "TEXTAREA", "SELECT"]).optional(), required: z.boolean().optional(), options: z.array(text(500)).max(100).optional() }).strict();
const intakeSchema = z.array(intakeField).min(1).max(30);
const formRow = z.object({ id: uuid, projectId: uuid, name: z.string(), schema: z.array(intakeField), isActive: z.boolean(), createdAt: instant });
const submissionRow = z.object({ id: uuid, formId: uuid, payload: record, status: z.enum(["PENDING", "CONVERTED", "REJECTED"]), convertedIdeaId: uuid.nullable(), createdAt: instant, formName: z.string() });
const ideaRow = z.object({ id: uuid, projectId: uuid, title: z.string(), description: z.string().nullable(), status: z.string(), submittedByMemberId: uuid.nullable(), submitterDisplay: z.string().nullable(), promotedWorkItemId: uuid.nullable(), score: z.string(), deletedAt: instant.nullable(), createdAt: instant, updatedAt: instant });
const todoRow = z.object({ id: uuid, memberId: uuid, title: z.string(), dueDate: date.nullable(), done: z.boolean(), doneAt: instant.nullable(), createdAt: instant });
const blockRow = z.object({ id: uuid, memberId: uuid, title: z.string(), startAt: instant, endAt: instant, projectId: uuid.nullable(), workItemId: uuid.nullable(), color: z.string().nullable(), createdAt: instant, updatedAt: instant });
const sessionRow = z.object({ id: uuid, memberId: uuid, timeBlockId: uuid, startedAt: instant, endedAt: instant, actualMinutes: integer.nonnegative(), note: z.string().nullable() });
const viewType = z.enum(["LIST", "BOARD", "TABLE", "CALENDAR", "TIMELINE"]);
const scalar = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
const filters = z.record(z.string().max(100), z.union([scalar, z.array(scalar).max(100)]));
const sorts = z.array(z.object({ field: text(100), direction: z.enum(["asc", "desc"]) }).strict()).max(20);
const viewRow = z.object({ id: uuid, ownerId: uuid, scope: z.enum(["PERSONAL", "PROJECT_SHARED"]), projectId: uuid.nullable(), viewType, name: z.string(), filters: record, sorts: z.array(z.unknown()), isPinned: z.boolean(), sortOrder: integer, createdAt: instant, updatedAt: instant });
const dashboardRow = z.object({ id: uuid, projectId: uuid.nullable(), ownerId: uuid, name: z.string(), isDefault: z.boolean(), createdAt: instant });
const widgetRow = z.object({ id: uuid, dashboardId: uuid, type: widgetType, config: widgetConfig, sortOrder: integer, createdAt: instant });
const iterationBrief = z.object({ id: uuid, name: z.string(), startDate: date, endDate: date });
const burndown = z.object({ iteration: iterationBrief, metric: z.string(), points: z.array(z.object({ date, scope: z.number(), done: z.number(), remaining: z.number(), ideal: z.number(), source: z.string() })) });
const cumulative = z.object({ iteration: iterationBrief, metric: z.string(), categories: z.array(z.string()), series: z.array(z.object({ date, NOT_STARTED: integer, IN_PROGRESS: integer, TERMINAL: integer, total: integer })) });
const seriesPoint = z.object({ d: date, n: z.number() });
const widgetData = z.union([burndown, cumulative, z.object({ type: widgetType, metric: z.string(), data: z.union([
  z.object({ total: integer }), z.object({ slices: z.array(z.object({ label: z.string(), value: integer })) }),
  z.object({ rows: z.array(z.object({ key: z.string(), title: z.string(), priority: z.string().nullable() })) }),
  z.object({ cells: z.array(z.object({ date, value: integer })) }), z.null(),
]) }), z.null()]);
const formRef = { ...scope, formId: uuid };
const submissionRef = { ...scope, submissionId: uuid };
const viewRef = { ...optionalScope, savedViewId: uuid };
const dashboardRef = { ...optionalScope, dashboardId: uuid };
const widgetRef = { ...dashboardRef, widgetId: uuid };
const blockInput = { title: text(200), startAt: instant, endAt: instant, projectId: uuid.nullable().optional(), workItemId: uuid.nullable().optional(), color: z.string().max(32).nullable().optional() };

export const WORKSPACE_TOOLS: ToolDef[] = [
  tool("portfolio.list", "read", "列出账号可见项目集及真实项目/工作项计数；需要未限制项目的令牌。", z.object({}).strict(), z.object({ portfolios: z.array(portfolioRow.extend(portfolioCounts)) }), async ctx => ({ portfolios: await portfolios.listPortfolios(ctx.actor) })),
  tool("portfolio.get", "read", "读取项目集及账号可见的关联项目。", z.object({ portfolioId: uuid }).strict(), portfolioRow.extend({ ...portfolioCounts, projects: z.array(projectBrief) }), async (ctx, args) => portfolios.getPortfolio(ctx.actor, String(args.portfolioId))),
  tool("portfolio.summary", "read", "读取项目集进度、风险、里程碑和活动，汇总受账号可见性保护。", z.object({ portfolioId: uuid }).strict(), portfolioSummary, async (ctx, args) => portfolios.getSummary(ctx.actor, String(args.portfolioId))),
  tool("portfolio.create", "write", "用户确认后创建项目集；要求组织项目创建权限。", z.object({ ...confirmed, name: text(120) }).strict(), portfolioRow.extend(portfolioCounts), async (ctx, args) => portfolios.createPortfolio(ctx.actor, { name: String(args.name) })),
  tool("portfolio.update", "write", "确认后重命名项目集。", z.object({ ...confirmed, portfolioId: uuid, name: text(120) }).strict(), portfolioRow, async (ctx, args) => portfolios.updatePortfolio(ctx.actor, String(args.portfolioId), { name: String(args.name) })),
  tool("portfolio.delete", "write", "确认后删除项目集及分组关联；项目本身保留。", z.object({ ...confirmed, portfolioId: uuid }).strict(), ok, async (ctx, args) => { await portfolios.deletePortfolio(ctx.actor, String(args.portfolioId)); return { ok: true }; }),
  ...(["addProject", "removeProject"] as const).map(action => tool(`portfolio.${action}`, "write", action === "addProject" ? "确认后把可见项目加入项目集，重复加入幂等。" : "确认后移除项目集中的项目关联。", z.object({ ...confirmed, ...scope, portfolioId: uuid }).strict(), ok, async (ctx, args) => { await projectScope(ctx, String(args.projectId)); return portfolios[action](ctx.actor, String(args.portfolioId), String(args.projectId)); })),

  tool("intake.listForms", "read", "读取项目原生收集表单，不返回公开提交令牌或哈希。", z.object(scope).strict(), z.object({ forms: z.array(formRow) }), async (ctx, args) => ({ forms: await intake.listForms(ctx.actor, String(args.projectId)) })),
  tool("intake.createForm", "write", "确认后创建原生需求收集表单；submitToken仅在本次创建响应返回。", z.object({ ...scope, ...confirmed, name: text(80), schema: intakeSchema }).strict(), z.object({ form: formRow, submitToken: z.string() }), async (ctx, args) => intake.createForm(ctx.actor, String(args.projectId), { name: String(args.name), schema: args.schema })),
  tool("intake.updateForm", "write", "确认后修改表单名称、字段或启停；已有提交记录的表单可停用。", z.object({ ...formRef, ...confirmed, name: text(80).optional(), schema: intakeSchema.optional(), isActive: z.boolean().optional() }).strict(), formRow, async (ctx, args) => intake.updateForm(ctx.actor, String(args.formId), patch(args, ["name", "schema", "isActive"]))),
  tool("intake.rotateToken", "write", "确认后轮换公开提交令牌，旧链接立即失效；新令牌仅返回一次。", z.object({ ...formRef, ...confirmed }).strict(), z.object({ submitToken: z.string() }), async (ctx, args) => intake.rotateToken(ctx.actor, String(args.formId))),
  tool("intake.deleteForm", "write", "确认后删除无提交记录的表单；已有提交记录时服务拒绝删除。", z.object({ ...formRef, ...confirmed }).strict(), ok, async (ctx, args) => { await intake.deleteForm(ctx.actor, String(args.formId)); return { ok: true }; }),
  tool("intake.listSubmissions", "read", "读取项目最近200条原生表单提交，可按处理状态筛选。", z.object({ ...scope, status: z.enum(["PENDING", "CONVERTED", "REJECTED"]).optional() }).strict(), z.object({ items: z.array(submissionRow), total: integer }), async (ctx, args) => intake.listSubmissions(ctx.actor, String(args.projectId), { status: args.status as string | undefined })),
  tool("intake.convertSubmission", "write", "确认后把提交转为真实想法；重复转化返回已有想法。", z.object({ ...submissionRef, ...confirmed }).strict(), z.object({ idea: ideaRow.nullable(), alreadyConverted: z.boolean() }), async (ctx, args) => intake.convertSubmission(ctx.actor, String(args.submissionId))),
  tool("intake.rejectSubmission", "write", "确认后驳回原生表单提交，之后按REJECTED回读核对。", z.object({ ...submissionRef, ...confirmed }).strict(), ok, async (ctx, args) => { await intake.rejectSubmission(ctx.actor, String(args.submissionId)); return { ok: true }; }),

  tool("todo.list", "read", "列出本人待办，可按完成状态筛选；需要未限制项目的令牌。", z.object({ done: z.boolean().optional() }).strict(), z.object({ todos: z.array(todoRow) }), async (ctx, args) => ({ todos: await workbench.listTodos(ctx.actor, { done: args.done as boolean | undefined }) })),
  tool("todo.create", "write", "确认后创建个人待办。", z.object({ ...confirmed, title: text(500), dueDate: date.nullable().optional() }).strict(), todoRow, async (ctx, args) => workbench.createTodo(ctx.actor, { title: String(args.title), dueDate: args.dueDate as string | null | undefined })),
  tool("todo.update", "write", "确认后修改本人待办；完成状态同步完成时间。", z.object({ ...confirmed, todoId: uuid, title: text(500).optional(), dueDate: date.nullable().optional(), done: z.boolean().optional() }).strict(), todoRow, async (ctx, args) => workbench.updateTodo(ctx.actor, String(args.todoId), patch(args, ["title", "dueDate", "done"]))),
  tool("todo.delete", "write", "确认后删除本人待办。", z.object({ ...confirmed, todoId: uuid }).strict(), ok, async (ctx, args) => { await workbench.deleteTodo(ctx.actor, String(args.todoId)); return { ok: true }; }),

  tool("focus.listBlocks", "read", "读取本人计划时间块，最多500条，可传含时区的起止时刻。", z.object({ from: instant.optional(), to: instant.optional() }).strict(), z.object({ blocks: z.array(blockRow) }), async (ctx, args) => ({ blocks: await focus.listBlocks(ctx.actor, args as { from?: string; to?: string }) })),
  tool("focus.createBlock", "write", "确认后创建本人时间块，不允许与既有时间块重叠；关联工作项必须属于指定项目。", z.object({ ...confirmed, ...blockInput }).strict(), blockRow, async (ctx, args) => { await focusReferences(ctx, args); const { userConfirmed: _confirmed, ...input } = args; return focus.createBlock(ctx.actor, input as Parameters<typeof focus.createBlock>[1]); }),
  tool("focus.updateBlock", "write", "确认后修改本人时间块，合并原有项目/工作项后检查归属与时间重叠。", z.object({ ...confirmed, timeBlockId: uuid, ...z.object(blockInput).partial().shape }).strict(), blockRow, async (ctx, args) => {
    const row = await mcpTimeBlock(String(args.timeBlockId));
    if (!row) throw missing();
    if (row.memberId !== ctx.actor.memberId) throw new DomainError("FORBIDDEN", "只能操作自己的时间块", null);
    const changes = patch(args, Object.keys(blockInput)); await focusReferences(ctx, { ...row, ...changes });
    return focus.updateBlock(ctx.actor, row.id, changes);
  }),
  tool("focus.deleteBlock", "write", "确认后删除本人时间块与关联的实际聚焦记录。", z.object({ ...confirmed, timeBlockId: uuid }).strict(), ok, async (ctx, args) => { await focus.deleteBlock(ctx.actor, String(args.timeBlockId)); return { ok: true }; }),
  tool("focus.today", "read", "按成员时区读取指定日期的计划块、实际记录与分钟汇总；省略日期为今天。", z.object({ day: date.optional() }).strict(), z.object({ day: date, blocks: z.array(blockRow), sessions: z.array(sessionRow), plannedMinutes: integer, focusedMinutes: integer, sessionCount: integer }), async (ctx, args) => focus.todayFocus(ctx.actor, args.day as string | undefined)),
  tool("focus.listSessions", "read", "按成员时区读取某日实际聚焦记录，省略日期为今天。", z.object({ day: date.optional() }).strict(), z.object({ sessions: z.array(sessionRow) }), async (ctx, args) => ({ sessions: await focus.listFocusSessions(ctx.actor, args as { day?: string }) })),
  tool("focus.recordSession", "write", "确认后记录本人已结束的聚焦；同时间块和开始时刻重复提交更新已有记录。", z.object({ ...confirmed, timeBlockId: uuid, startedAt: instant, endedAt: instant, actualMinutes: integer.min(0).max(1440).optional(), note: z.string().max(2000).nullable().optional() }).strict(), sessionRow, async (ctx, args) => { const { userConfirmed: _confirmed, ...input } = args; return focus.recordFocusSession(ctx.actor, input as Parameters<typeof focus.recordFocusSession>[1]); }),
  tool("focus.updateSession", "write", "确认后修正本人实际聚焦分钟或备注。", z.object({ ...confirmed, sessionId: uuid, actualMinutes: integer.min(0).max(1440).optional(), note: z.string().max(2000).nullable().optional() }).strict(), sessionRow, async (ctx, args) => focus.updateFocusSession(ctx.actor, String(args.sessionId), patch(args, ["actualMinutes", "note"]))),

  tool("savedView.list", "read", "给projectId列出项目共享视图；省略则列出本人所有视图，后者需要全账号令牌。", z.object(optionalScope).strict(), z.object({ views: z.array(viewRow) }), async (ctx, args) => {
    const views = await visibleRows(ctx, await plans.listSavedViews(ctx.actor, args.projectId as string | undefined));
    for (const view of views) await viewReferences(ctx, view.projectId, view.filters);
    return { views };
  }),
  tool("savedView.get", "read", "读取本人或有权访问的项目共享视图，提供projectId时必须与实际归属一致。", z.object(viewRef).strict(), viewRow, async (ctx, args) => { const view = await plans.getSavedView(ctx.actor, String(args.savedViewId)); await viewReferences(ctx, view.projectId, view.filters); return view; }),
  tool("savedView.create", "write", "确认后保存个人或项目共享视图；个人无projectId，共享必须指定projectId。filters支持标量和标量数组；sorts为field/direction。", z.object({ ...optionalScope, ...confirmed, name: text(120), viewType, scope: z.enum(["PERSONAL", "PROJECT_SHARED"]).optional(), filters: filters.optional(), sorts: sorts.optional() }).strict(), viewRow, async (ctx, args) => {
    await viewReferences(ctx, args.projectId as string | null | undefined ?? null, args.filters);
    const { userConfirmed: _confirmed, ...input } = args; return plans.createSavedView(ctx.actor, input as Parameters<typeof plans.createSavedView>[1]);
  }),
  tool("savedView.update", "write", "确认后修改本人视图的名称、固定状态、筛选或排序。", z.object({ ...viewRef, ...confirmed, name: text(120).optional(), isPinned: z.boolean().optional(), filters: filters.optional(), sorts: sorts.optional() }).strict(), viewRow, async (ctx, args) => {
    const view = await viewFor(ctx, args); await viewReferences(ctx, view.projectId, args.filters ?? view.filters);
    return plans.updateSavedView(ctx.actor, view.id, patch(args, ["name", "isPinned", "filters", "sorts"]));
  }),
  tool("savedView.delete", "write", "确认后删除本人保存视图。", z.object({ ...viewRef, ...confirmed }).strict(), ok, async (ctx, args) => { await plans.deleteSavedView(ctx.actor, String(args.savedViewId)); return { ok: true }; }),
  tool("savedView.reorder", "write", "确认后按ids顺序排列本人视图；每个ID都检查所有权和项目范围。", z.object({ ...optionalScope, ...confirmed, ids: z.array(uuid).min(1).max(200) }).strict(), ok, async (ctx, args) => { await plans.reorderSavedViews(ctx.actor, args.ids as string[]); return { ok: true }; }),

  tool("dashboard.list", "read", "给projectId时仅列该项目仪表盘；省略时返回账号可见的全局及本人仪表盘。", z.object(optionalScope).strict(), z.object({ dashboards: z.array(dashboardRow) }), async (ctx, args) => {
    const rows = await visibleRows(ctx, await insight.listDashboards(ctx.actor, args.projectId as string | undefined));
    return { dashboards: args.projectId ? rows.filter(row => row.projectId === args.projectId) : rows };
  }),
  tool("dashboard.get", "read", "读取仪表盘与挂件，所有已存迭代引用必须符合项目范围。", z.object(dashboardRef).strict(), dashboardRow.extend({ widgets: z.array(widgetRow) }), async (ctx, args) => {
    const row = await insight.getDashboard(ctx.actor, String(args.dashboardId));
    for (const widget of row.widgets) await widgetReferences(ctx, row.projectId, widget.type, widget.config);
    return row;
  }),
  tool("dashboard.create", "write", "确认后创建项目或全局仪表盘；全局需要未限制项目的令牌。", z.object({ ...optionalScope, ...confirmed, name: text(120), isDefault: z.boolean().optional() }).strict(), dashboardRow, async (ctx, args) => insight.createDashboard(ctx.actor, { name: String(args.name), projectId: args.projectId as string | null | undefined, isDefault: args.isDefault as boolean | undefined })),
  tool("dashboard.update", "write", "确认后修改仪表盘名称或默认状态，遵循账号管理权限。", z.object({ ...dashboardRef, ...confirmed, name: text(120).optional(), isDefault: z.boolean().optional() }).strict(), dashboardRow, async (ctx, args) => insight.updateDashboard(ctx.actor, String(args.dashboardId), patch(args, ["name", "isDefault"]))),
  tool("dashboard.delete", "write", "确认后删除仪表盘及全部挂件。", z.object({ ...dashboardRef, ...confirmed }).strict(), ok, async (ctx, args) => { await insight.deleteDashboard(ctx.actor, String(args.dashboardId)); return { ok: true }; }),
  tool("dashboard.listWidgets", "read", "读取仪表盘挂件，逐项检查现有配置中的迭代归属。", z.object(dashboardRef).strict(), z.object({ widgets: z.array(widgetRow) }), async (ctx, args) => {
    const parent = await dashboardFor(ctx, args); const widgets = await insight.listWidgets(ctx.actor, parent.id);
    for (const widget of widgets) await widgetReferences(ctx, parent.projectId, widget.type, widget.config);
    return { widgets };
  }),
  tool("dashboard.addWidget", "write", "确认后新增挂件；燃尽/累积流必须指定同项目迭代。", z.object({ ...dashboardRef, ...confirmed, type: widgetType, config: widgetConfig.optional(), sortOrder: integer.optional() }).strict(), widgetRow, async (ctx, args) => {
    const parent = await dashboardFor(ctx, args); await widgetReferences(ctx, parent.projectId, String(args.type), args.config);
    return insight.addWidget(ctx.actor, parent.id, { type: String(args.type), config: args.config as Record<string, unknown> | undefined, sortOrder: args.sortOrder as number | undefined });
  }),
  tool("dashboard.updateWidget", "write", "确认后修改挂件类型、配置或顺序；合并后检查迭代实际归属。", z.object({ ...widgetRef, ...confirmed, type: widgetType.optional(), config: widgetConfig.optional(), sortOrder: integer.optional() }).strict(), widgetRow, async (ctx, args) => {
    const { parent, row } = await widgetFor(ctx, args); const changes = patch(args, ["type", "config", "sortOrder"]);
    await widgetReferences(ctx, parent.projectId, String(changes.type ?? row.type), changes.config ?? row.config);
    return insight.updateWidget(ctx.actor, row.id, changes);
  }),
  tool("dashboard.deleteWidget", "write", "确认后删除指定仪表盘的挂件，拒绝伪造父子关系。", z.object({ ...widgetRef, ...confirmed }).strict(), ok, async (ctx, args) => { const { row } = await widgetFor(ctx, args); await insight.deleteWidget(ctx.actor, row.id); return { ok: true }; }),
  tool("dashboard.widgetData", "read", "读取单个挂件实时业务数据和统计口径，检查父仪表盘及迭代范围。", z.object(widgetRef).strict(), z.object({ data: widgetData }), async (ctx, args) => {
    const { parent, row } = await widgetFor(ctx, args); await widgetReferences(ctx, parent.projectId, row.type, row.config);
    return { data: await insight.widgetData(ctx.actor, row) };
  }),
  tool("insight.burndown", "read", "读取同项目迭代的燃尽数据，保留快照/live来源及统计口径。", z.object({ ...scope, iterationId: uuid }).strict(), burndown, async (ctx, args) => insight.burnDown(ctx.actor, String(args.iterationId))),
  tool("insight.cumulativeFlow", "read", "读取同项目迭代的累积流与状态类别。", z.object({ ...scope, iterationId: uuid }).strict(), cumulative, async (ctx, args) => insight.cumulativeFlow(ctx.actor, String(args.iterationId))),
  tool("insight.activitySeries", "read", "读取项目7至180天活动和新建工作项趋势，缺少事件的日期为0。", z.object({ ...scope, days: integer.min(7).max(180).optional() }).strict(), z.object({ metric: z.string(), days: integer, points: z.array(seriesPoint), series: z.object({ activity: z.array(seriesPoint), created: z.array(seriesPoint) }) }), async (ctx, args) => insight.projectActivitySeries(ctx.actor, String(args.projectId), args.days as number | undefined)),
];

/** 精确集合供中央guard转交本模块scope检查；新增工具默认仍拒绝无范围调用。 */
export const WORKSPACE_HANDLER_SCOPE_TOOLS = new Set(WORKSPACE_TOOLS.map(definition => definition.name));
