import "./_env.ts";
/** 原生个人/跨项目业务MCP：真实HTTP、隔离数据库和真实服务。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, mcpClient, dashboardWidget, dashboard, savedView } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as workbench from "../src/server/services/workbench.service.ts";
import * as focus from "../src/server/services/focus.service.ts";
import * as insight from "../src/server/services/insight.service.ts";
import * as intake from "../src/server/services/intake.service.ts";
import * as workitems from "../src/server/services/work-item.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const groups = {
  portfolio: ["list", "get", "summary", "create", "update", "delete", "addProject", "removeProject"],
  intake: ["listForms", "createForm", "updateForm", "rotateToken", "deleteForm", "listSubmissions", "convertSubmission", "rejectSubmission"],
  todo: ["list", "create", "update", "delete"],
  focus: ["listBlocks", "createBlock", "updateBlock", "deleteBlock", "today", "listSessions", "recordSession", "updateSession"],
  savedView: ["list", "get", "create", "update", "delete", "reorder"],
  dashboard: ["list", "get", "create", "update", "delete", "listWidgets", "addWidget", "updateWidget", "deleteWidget", "widgetData"],
  insight: ["burndown", "cumulativeFlow", "activitySeries"],
};
const required = Object.entries(groups).flatMap(([domain, names]) => names.map(name => `${domain}.${name}`));
const marker = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
let checks = 0, rpcId = 0;
const exercised = new Set<string>();
const successfulArgs = new Map<string, Record<string, unknown>>();
const writeCases: [string, Record<string, unknown>][] = [];
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`OK ${name}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  assert.notEqual(response.status, 429, "MCP限流，停止本轮不重试");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return body.result;
}
async function call(token: string, name: string, args: Record<string, unknown>, error?: string) {
  const result = await rpc(token, "tools/call", { name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (error) { assert.equal(result.isError, true, name); assert.equal(data.code, error, `${name}: ${JSON.stringify(data)}`); }
  else { assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(result.structuredContent, data); exercised.add(name); successfulArgs.set(name, args); }
  return data;
}
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const roles = await db.select().from(role);
  const adminRole = roles.find(row => row.key === "ADMIN")!;
  const [adminRow, otherRow] = await db.insert(member).values([
    { username: `ws-admin-${marker}`, name: "工作空间管理员", status: "ACTIVE", passwordHash: "isolated-fixture" },
    { username: `ws-other-${marker}`, name: "独立个人账号", status: "ACTIVE", passwordHash: "isolated-fixture" },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const global = await tokens.createToken(admin, { name: "原生业务全账号", tier: "READ_WRITE", projectWhitelist: [] });
  const read = await tokens.createToken(admin, { name: "原生业务只读", tier: "READ_ONLY", projectWhitelist: [] });
  const listed = await rpc(global.token, "tools/list");
  check("47项原生业务工具公开严格输入输出契约", required.every(name => listed.tools.some((tool: { name: string; inputSchema: { additionalProperties?: boolean }; outputSchema?: { additionalProperties?: boolean } }) => tool.name === name && tool.inputSchema.additionalProperties === false && tool.outputSchema?.additionalProperties === false)));
  const project = await projects.createProject(admin, { key: `WS${marker}`, name: "工作空间验收项目" });
  const outside = await projects.createProject(admin, { key: `WO${marker}`, name: "隔离项目" });
  await db.insert(roleAssignment).values({ memberId: otherRow!.id, roleId: roles.find(row => row.key === "MEMBER")!.id, scopeType: "PROJECT", scopeId: outside.id });
  const other = (await loadActor(otherRow!.id))!;
  const scoped = await tokens.createToken(admin, { name: "原生业务项目限定", tier: "READ_WRITE", projectWhitelist: [project.id] });
  const otherToken = await tokens.createToken(other, { name: "独立账号读写", tier: "READ_WRITE", projectWhitelist: [] });
  const confirm = { userConfirmed: true };
  const scope = { projectId: project.id };
  const projectConfirm = { ...scope, ...confirm };
  const write = async (name: string, args: Record<string, unknown>) => {
    writeCases.push([name, args]); return call(global.token, name, args);
  };
  const todo = await write("todo.create", { ...confirm, title: "待办闭环", dueDate: "2026-11-20" });
  await write("todo.update", { ...confirm, todoId: todo.id, title: "已处理待办", dueDate: null, done: true });
  check("待办写入完成时间且按done过滤回读", (await call(read.token, "todo.list", { done: true })).todos.some((row: { id: string; doneAt: string; title: string }) => row.id === todo.id && row.doneAt && row.title === "已处理待办"));
  const foreignTodo = await workbench.createTodo(other, { title: "他人待办" });
  await call(global.token, "todo.update", { ...confirm, todoId: foreignTodo!.id, done: true }, "FORBIDDEN");
  await call(global.token, "todo.delete", { ...confirm, todoId: foreignTodo!.id }, "FORBIDDEN");
  check("个人待办拒绝他人所有权", !(await call(read.token, "todo.list", {})).todos.some((row: { id: string }) => row.id === foreignTodo!.id));

  const blockArgs = { ...confirm, title: "聚焦闭环", startAt: "2026-11-20T09:00:00+08:00", endAt: "2026-11-20T10:00:00+08:00", projectId: project.id };
  const block = await write("focus.createBlock", blockArgs);
  await write("focus.updateBlock", { ...confirm, timeBlockId: block.id, title: "更新聚焦", color: "#123456" });
  check("时间块写后回读", (await call(read.token, "focus.listBlocks", { from: "2026-11-20T00:00:00+08:00", to: "2026-11-20T23:59:59+08:00" })).blocks.some((row: { id: string; title: string }) => row.id === block.id && row.title === "更新聚焦"));
  check("时间块颜色更新真实持久化", (await focus.listBlocks(admin)).find(row => row.id === block.id)?.color === "#123456");
  await call(global.token, "focus.createBlock", blockArgs, "CONFLICT");
  await call(global.token, "focus.updateBlock", { ...confirm, timeBlockId: block.id, startAt: "not-a-date" }, "VALIDATION");
  const sessionArgs = { ...confirm, timeBlockId: block.id, startedAt: "2026-11-20T09:00:00+08:00", endedAt: "2026-11-20T09:25:00+08:00", actualMinutes: 25, note: "完成一轮" };
  const session = await write("focus.recordSession", sessionArgs);
  check("相同开始时刻聚焦记录幂等", (await call(global.token, "focus.recordSession", sessionArgs)).id === session.id);
  await write("focus.updateSession", { ...confirm, sessionId: session.id, actualMinutes: 20, note: "扣除休息" });
  check("聚焦会话回读实际分钟数", (await call(read.token, "focus.listSessions", { day: "2026-11-20" })).sessions.some((row: { id: string; actualMinutes: number }) => row.id === session.id && row.actualMinutes === 20));
  const today = await call(read.token, "focus.today", { day: "2026-11-20" });
  check("今日聚焦聚合使用真实计划与实际分钟", today.plannedMinutes === 60 && today.focusedMinutes === 20 && today.sessionCount === 1);
  const otherBlock = await focus.createBlock(other, { title: "他人聚焦", startAt: blockArgs.startAt, endAt: blockArgs.endAt });
  await call(global.token, "focus.updateBlock", { ...confirm, timeBlockId: otherBlock!.id, title: "越权" }, "FORBIDDEN");
  await call(global.token, "focus.recordSession", { ...sessionArgs, timeBlockId: otherBlock!.id }, "FORBIDDEN");
  await call(otherToken.token, "focus.createBlock", { ...blockArgs, startAt: "2026-11-20T11:00:00+08:00", endAt: "2026-11-20T12:00:00+08:00" }, "FORBIDDEN");
  const ownWorkItem = (await workitems.createWorkItem(admin, project.id, { type: "TASK", title: "聚焦关联工作项" }))!;
  const foreignWorkItem = (await workitems.createWorkItem(admin, outside.id, { type: "TASK", title: "其他项目关联" }))!;
  await call(global.token, "focus.createBlock", { ...blockArgs, startAt: "2026-11-20T11:00:00+08:00", endAt: "2026-11-20T12:00:00+08:00", workItemId: foreignWorkItem.id }, "NOT_FOUND");
  await call(global.token, "focus.updateBlock", { ...confirm, timeBlockId: block.id, workItemId: ownWorkItem.id });
  await call(global.token, "focus.updateBlock", { ...confirm, timeBlockId: block.id, projectId: outside.id }, "NOT_FOUND");
  await call(otherToken.token, "focus.updateSession", { ...confirm, sessionId: session.id, actualMinutes: 999 }, "FORBIDDEN");
  check("聚焦本人所有权和项目可见性受到保护", true);

  const portfolio = await write("portfolio.create", { ...confirm, name: "产品组合" });
  await write("portfolio.update", { ...confirm, portfolioId: portfolio.id, name: "产品组合更新" });
  await write("portfolio.addProject", { ...projectConfirm, portfolioId: portfolio.id });
  check("项目集成员可回读", (await call(read.token, "portfolio.get", { portfolioId: portfolio.id })).projects.some((row: { id: string }) => row.id === project.id));
  check("项目集列表统计来自关联项目", (await call(read.token, "portfolio.list", {})).portfolios.some((row: { id: string; projectCount: number }) => row.id === portfolio.id && row.projectCount === 1));
  check("项目集汇总口径真实", (await call(read.token, "portfolio.summary", { portfolioId: portfolio.id })).totals.projectCount === 1);
  await call(otherToken.token, "portfolio.create", { ...confirm, name: "不能管理" }, "FORBIDDEN");

  const personal = await write("savedView.create", { ...confirm, name: "个人列表", viewType: "LIST", scope: "PERSONAL" });
  const shared = await write("savedView.create", { ...projectConfirm, name: "共享看板", viewType: "BOARD", scope: "PROJECT_SHARED", filters: { priority: "HIGH" }, sorts: [{ field: "createdAt", direction: "desc" }] });
  await write("savedView.update", { ...projectConfirm, savedViewId: shared.id, name: "共享看板更新", isPinned: true });
  check("共享视图写后限定项目回读", (await call(scoped.token, "savedView.get", { ...scope, savedViewId: shared.id })).isPinned === true);
  await write("savedView.reorder", { ...confirm, ids: [shared.id, personal.id] });
  const views = (await call(read.token, "savedView.list", {})).views;
  check("个人保存视图批量排序持久化", views[0].id === shared.id && views[1].id === personal.id);
  const foreignView = await plans.createSavedView(admin, { name: "另一项目视图", viewType: "LIST", scope: "PROJECT_SHARED", projectId: outside.id });
  await call(scoped.token, "savedView.get", { ...scope, savedViewId: foreignView!.id }, "NOT_FOUND");
  await call(global.token, "savedView.update", { ...projectConfirm, savedViewId: foreignView!.id, name: "伪造父项目" }, "NOT_FOUND");
  await call(scoped.token, "savedView.reorder", { ...projectConfirm, ids: [shared.id, foreignView!.id] }, "NOT_FOUND");
  await call(scoped.token, "savedView.get", { savedViewId: personal.id }, "FORBIDDEN");
  await call(scoped.token, "savedView.list", {}, "FORBIDDEN");
  await call(scoped.token, "savedView.create", { ...confirm, name: "不能新增个人", viewType: "LIST" }, "FORBIDDEN");
  await call(otherToken.token, "savedView.get", { savedViewId: personal.id }, "FORBIDDEN");
  await call(global.token, "savedView.create", { ...projectConfirm, name: "越界筛选", viewType: "TABLE", scope: "PROJECT_SHARED", filters: { projectId: outside.id } }, "NOT_FOUND");
  await call(global.token, "savedView.update", { ...projectConfirm, savedViewId: shared.id, filters: { workItemId: foreignWorkItem.id } }, "NOT_FOUND");
  const otherView = await plans.createSavedView(other, { name: "他人视图", viewType: "LIST" });
  await call(global.token, "savedView.update", { ...confirm, savedViewId: otherView!.id, name: "越权" }, "FORBIDDEN");
  await call(global.token, "savedView.reorder", { ...confirm, ids: [personal.id, otherView!.id] }, "FORBIDDEN");
  await call(global.token, "savedView.reorder", { ...confirm, ids: [personal.id, personal.id] }, "VALIDATION");
  check("保存视图按真实归属与批量逐项检查隔离", true);

  const iteration = (await plans.createPlan(admin, project.id, "iteration", { name: "洞察迭代", startDate: "2026-11-20", endDate: "2026-11-26" }))!;
  const foreignIteration = (await plans.createPlan(admin, outside.id, "iteration", { name: "越界迭代", startDate: "2026-11-20", endDate: "2026-11-26" }))!;
  const dash = await write("dashboard.create", { ...projectConfirm, name: "项目仪表盘" });
  const globalDash = await write("dashboard.create", { ...confirm, name: "全局仪表盘" });
  const foreignDash = await insight.createDashboard(admin, { name: "其他项目仪表盘", projectId: outside.id });
  await write("dashboard.update", { ...projectConfirm, dashboardId: dash.id, name: "项目仪表盘更新", isDefault: true });
  const dashboards = (await call(scoped.token, "dashboard.list", scope)).dashboards;
  check("项目仪表盘列表不混入全局或其他项目", dashboards.length === 1 && dashboards[0].id === dash.id);
  const widget = await write("dashboard.addWidget", { ...projectConfirm, dashboardId: dash.id, type: "BURNDOWN", config: { iterationId: iteration.id } });
  await write("dashboard.updateWidget", { ...projectConfirm, dashboardId: dash.id, widgetId: widget.id, type: "CUMULATIVE_FLOW", sortOrder: 2 });
  check("仪表盘详情回读挂件配置", (await call(scoped.token, "dashboard.get", { ...scope, dashboardId: dash.id })).widgets[0].config.iterationId === iteration.id);
  check("挂件列表顺序与类型持久化", (await call(scoped.token, "dashboard.listWidgets", { ...scope, dashboardId: dash.id })).widgets[0].sortOrder === 2);
  check("累积流挂件计算当前迭代数据", (await call(scoped.token, "dashboard.widgetData", { ...scope, dashboardId: dash.id, widgetId: widget.id })).data.iteration.id === iteration.id);
  check("燃尽数据有真实日期序列", (await call(scoped.token, "insight.burndown", { ...scope, iterationId: iteration.id })).points.length === 7);
  check("累积流数据有真实日期序列", (await call(scoped.token, "insight.cumulativeFlow", { ...scope, iterationId: iteration.id })).series.length === 7);
  check("项目活动趋势读取真实七天数据", (await call(scoped.token, "insight.activitySeries", { ...scope, days: 7 })).points.length === 7);
  await call(scoped.token, "dashboard.get", { ...scope, dashboardId: foreignDash!.id }, "NOT_FOUND");
  await call(global.token, "dashboard.update", { ...projectConfirm, dashboardId: foreignDash!.id, name: "伪造项目" }, "NOT_FOUND");
  await call(scoped.token, "dashboard.get", { dashboardId: globalDash.id }, "FORBIDDEN");
  await call(scoped.token, "dashboard.list", {}, "FORBIDDEN");
  await call(scoped.token, "dashboard.addWidget", { ...projectConfirm, dashboardId: dash.id, type: "BURNDOWN", config: { iterationId: foreignIteration.id } }, "NOT_FOUND");
  await call(global.token, "dashboard.updateWidget", { ...projectConfirm, dashboardId: dash.id, widgetId: widget.id, config: { iterationId: foreignIteration.id } }, "NOT_FOUND");
  await call(global.token, "dashboard.addWidget", { ...projectConfirm, dashboardId: dash.id, type: "CUMULATIVE_FLOW", config: {} }, "VALIDATION");
  await call(scoped.token, "insight.burndown", { ...scope, iterationId: foreignIteration.id }, "NOT_FOUND");
  await call(global.token, "insight.cumulativeFlow", { ...scope, iterationId: foreignIteration.id }, "NOT_FOUND");
  const malicious = (await db.insert(dashboardWidget).values({ dashboardId: dash.id, type: "BURNDOWN", config: { iterationId: foreignIteration.id } }).returning())[0]!;
  await call(scoped.token, "dashboard.get", { ...scope, dashboardId: dash.id }, "NOT_FOUND");
  await call(scoped.token, "dashboard.listWidgets", { ...scope, dashboardId: dash.id }, "NOT_FOUND");
  await call(scoped.token, "dashboard.widgetData", { ...scope, dashboardId: dash.id, widgetId: malicious.id }, "NOT_FOUND");
  await db.delete(dashboardWidget).where(eq(dashboardWidget.id, malicious.id));
  const otherWidget = await insight.addWidget(admin, foreignDash!.id, { type: "COUNT" });
  await call(global.token, "dashboard.deleteWidget", { ...projectConfirm, dashboardId: dash.id, widgetId: otherWidget!.id }, "NOT_FOUND");
  check("挂件拒绝嵌套越界配置及伪造父子关系，包括历史数据", true);
  const legacyCount = await insight.addWidget(admin, dash.id, { type: "COUNT", config: { iterationId: "" } });
  check("现有UI无迭代普通挂件可被MCP读取", (await call(scoped.token, "dashboard.widgetData", { ...scope, dashboardId: dash.id, widgetId: legacyCount!.id })).data.data.total === 1);
  await call(scoped.token, "dashboard.get", { ...scope, dashboardId: dash.id });
  await call(scoped.token, "dashboard.listWidgets", { ...scope, dashboardId: dash.id });
  await call(scoped.token, "dashboard.deleteWidget", { ...projectConfirm, dashboardId: dash.id, widgetId: legacyCount!.id });
  for (const type of ["BURNDOWN", "PIE", "LIST", "ACTIVITY_HEATMAP"] as const) {
    const created = await call(scoped.token, "dashboard.addWidget", { ...projectConfirm, dashboardId: dash.id, type, config: type === "BURNDOWN" ? { iterationId: iteration.id } : {} });
    const data = (await call(scoped.token, "dashboard.widgetData", { ...scope, dashboardId: dash.id, widgetId: created.id })).data;
    check(`${type}挂件通过真实输出契约`, type === "BURNDOWN" ? data.points.length === 7 : type === "PIE" ? data.data.slices.reduce((n: number, row: { value: number }) => n + row.value, 0) === 1 : type === "LIST" ? data.data.rows[0].key === ownWorkItem.key : data.data.cells.length === 1);
    await call(scoped.token, "dashboard.deleteWidget", { ...projectConfirm, dashboardId: dash.id, widgetId: created.id });
  }
  const globalWidget = await call(global.token, "dashboard.addWidget", { ...confirm, dashboardId: globalDash.id, type: "COUNT" });
  check("全局无项目聚合返回明确空数据", (await call(read.token, "dashboard.widgetData", { dashboardId: globalDash.id, widgetId: globalWidget.id })).data.data === null);
  await call(scoped.token, "dashboard.create", { ...confirm, name: "不能创建全局" }, "FORBIDDEN");
  await call(otherToken.token, "dashboard.create", { ...confirm, projectId: outside.id, name: "成员无管理权限" }, "FORBIDDEN");

  const formSchema = [{ key: "title", label: "需求标题", type: "TEXT", required: true }];
  const form = await write("intake.createForm", { ...projectConfirm, name: "原生需求入口", schema: formSchema });
  await write("intake.updateForm", { ...projectConfirm, formId: form.form.id, name: "原生需求入口更新" });
  const forms = await call(scoped.token, "intake.listForms", scope);
  check("表单列表回读且不泄露明文或哈希", forms.forms.some((row: { id: string; name: string }) => row.id === form.form.id && row.name === "原生需求入口更新") && !JSON.stringify(forms).includes("submitToken"));
  const rotated = await write("intake.rotateToken", { ...projectConfirm, formId: form.form.id });
  check("轮换产生新令牌", rotated.submitToken !== form.submitToken);
  const oldTokenResponse = await fetch(`${process.env.BASE}/api/v1/intake/${form.submitToken}`);
  check("旧匿名入口令牌失效", oldTokenResponse.status === 403 && (await oldTokenResponse.json()).code === "NOT_FOUND");
  const submit = async (title: string) => {
    const response = await fetch(`${process.env.BASE}/api/v1/intake/${rotated.submitToken}/submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    assert.equal(response.status, 201); return response.json();
  };
  const submission = await submit("实际外部需求");
  const rejected = await submit("拒绝示例");
  check("匿名提交经MCP可发现", (await call(scoped.token, "intake.listSubmissions", { ...scope, status: "PENDING" })).items.some((row: { id: string }) => row.id === submission.id));
  const converted = await write("intake.convertSubmission", { ...projectConfirm, submissionId: submission.id });
  check("提交转化真实想法并回读", converted.idea.title === "实际外部需求" && (await call(scoped.token, "idea.get", { ideaId: converted.idea.id })).id === converted.idea.id);
  const convertedAgain = await call(scoped.token, "intake.convertSubmission", { ...projectConfirm, submissionId: submission.id });
  check("提交转化幂等", convertedAgain.alreadyConverted && convertedAgain.idea.id === converted.idea.id);
  await write("intake.rejectSubmission", { ...projectConfirm, submissionId: rejected.id });
  check("拒绝状态持久化", (await call(scoped.token, "intake.listSubmissions", { ...scope, status: "REJECTED" })).items.some((row: { id: string }) => row.id === rejected.id));
  const foreignForm = await intake.createForm(admin, outside.id, { name: "越界入口", schema: formSchema });
  const foreignSubmission = await intake.publicSubmit(foreignForm.submitToken, { title: "隔离需求" });
  await call(global.token, "intake.updateForm", { ...projectConfirm, formId: foreignForm.form.id, name: "越界修改" }, "NOT_FOUND");
  await call(scoped.token, "intake.rotateToken", { ...projectConfirm, formId: foreignForm.form.id }, "NOT_FOUND");
  await call(scoped.token, "intake.convertSubmission", { ...projectConfirm, submissionId: foreignSubmission.id }, "NOT_FOUND");
  await call(global.token, "intake.rejectSubmission", { ...projectConfirm, submissionId: foreignSubmission.id }, "NOT_FOUND");
  await call(global.token, "intake.deleteForm", { ...projectConfirm, formId: form.form.id }, "CONFLICT");
  await call(otherToken.token, "intake.listForms", { projectId: outside.id }, "FORBIDDEN");
  await call(otherToken.token, "intake.createForm", { ...confirm, projectId: outside.id, name: "无管理权限", schema: formSchema }, "FORBIDDEN");
  await call(global.token, "intake.createForm", { ...projectConfirm, name: "错误类型", schema: [{ key: "title", label: "标题", type: "UNSUPPORTED" }] }, "VALIDATION");
  await call(global.token, "intake.createForm", { ...projectConfirm, name: "重复字段", schema: [formSchema[0], formSchema[0]] }, "VALIDATION");
  await call(global.token, "dashboard.addWidget", { ...projectConfirm, dashboardId: dash.id, type: "COUNT", config: { projectId: outside.id } }, "VALIDATION");
  check("收集表单和提交按实际项目隔离并保护历史", true);

  // 删除也进入统一反控矩阵，先验证无副作用，再执行并回读。
  const emptyForm = await call(global.token, "intake.createForm", { ...projectConfirm, name: "可删除入口", schema: formSchema });
  writeCases.push(
    ["todo.delete", { ...confirm, todoId: todo.id }],
    ["focus.deleteBlock", { ...confirm, timeBlockId: block.id }],
    ["portfolio.removeProject", { ...projectConfirm, portfolioId: portfolio.id }],
    ["portfolio.delete", { ...confirm, portfolioId: portfolio.id }],
    ["savedView.delete", { ...projectConfirm, savedViewId: shared.id }],
    ["dashboard.deleteWidget", { ...projectConfirm, dashboardId: dash.id, widgetId: widget.id }],
    ["dashboard.delete", { ...projectConfirm, dashboardId: dash.id }],
    ["intake.deleteForm", { ...projectConfirm, formId: emptyForm.form.id }],
  );
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, global.row.id));
  for (const [name, args] of writeCases.filter(([name]) => ["todo.update", "focus.updateBlock", "focus.updateSession", "intake.updateForm", "savedView.update", "dashboard.update", "dashboard.updateWidget"].includes(name))) {
    const empty = Object.fromEntries(Object.entries(args).filter(([key]) => key.endsWith("Id") || key === "userConfirmed"));
    await call(global.token, name, empty, "VALIDATION");
  }
  check("空修改不能产生无效SQL或虚假成功", true);
  for (const [name, args] of writeCases) {
    await call(global.token, name, { ...args, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    const { userConfirmed: _confirm, ...missing } = args;
    await call(global.token, name, missing, "VALIDATION");
    await call(read.token, name, args, "FORBIDDEN");
    await policies.replaceClientPolicies(admin, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(global.token, name, args, "FORBIDDEN");
    await policies.replaceClientPolicies(admin, client!.id, []);
  }
  await policies.replaceClientPolicies(admin, client!.id, []);
  const expectedWrites = listed.tools.filter((tool: { name: string; annotations?: { readOnlyHint?: boolean } }) => required.includes(tool.name) && !tool.annotations?.readOnlyHint).map((tool: { name: string }) => tool.name);
  check("全部新增写工具逐项验证确认缺失、取消、只读与DENY", expectedWrites.length > 25 && expectedWrites.every((name: string) => writeCases.some(([actual]) => actual === name)));
  for (const [name, args] of writeCases.filter(([name]) => /^(portfolio|todo|focus)\./.test(name))) {
    await call(scoped.token, name, args, "FORBIDDEN");
  }
  for (const [name, args] of writeCases.filter(([name, args]) => !/^(portfolio|todo|focus)\./.test(name) && args.projectId)) {
    await call(scoped.token, name, { ...args, projectId: outside.id }, "NOT_FOUND");
  }
  for (const name of ["portfolio.list", "portfolio.get", "portfolio.summary", "todo.list", "focus.listBlocks", "focus.today", "focus.listSessions"]) {
    await call(scoped.token, name, name.startsWith("portfolio.") && name !== "portfolio.list" ? { portfolioId: portfolio.id } : {}, "FORBIDDEN");
  }
  check("账号个人与跨项目聚合拒绝受限token，无隐式扩大范围", true);
  for (const [name, args] of writeCases.slice(-8)) await call(global.token, name, args);
  check("删除待办和聚焦块同步清除会话", (await call(read.token, "todo.list", {})).todos.length === 0 && (await call(read.token, "focus.listBlocks", {})).blocks.length === 0 && (await call(read.token, "focus.listSessions", { day: "2026-11-20" })).sessions.length === 0);
  check("项目集删除后不可见", !(await call(read.token, "portfolio.list", {})).portfolios.some((row: { id: string }) => row.id === portfolio.id));
  check("删除保存视图与仪表盘后列表消失", !(await call(scoped.token, "savedView.list", scope)).views.some((row: { id: string }) => row.id === shared.id) && !(await call(scoped.token, "dashboard.list", scope)).dashboards.some((row: { id: string }) => row.id === dash.id));
  check("空表单删除后列表消失", !(await call(scoped.token, "intake.listForms", scope)).forms.some((row: { id: string }) => row.id === emptyForm.form.id));
  check("47项工具均成功走过真实HTTP业务处理器", required.every(name => exercised.has(name)));
  for (const name of required) await call(global.token, name, { ...successfulArgs.get(name), unsupportedField: true }, "VALIDATION");
  check("47项工具逐项拒绝未知顶层参数", true);
  for (const name of required.filter(name => !expectedWrites.includes(name))) {
    await policies.replaceClientPolicies(admin, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(global.token, name, successfulArgs.get(name)!, "FORBIDDEN");
  }
  await policies.replaceClientPolicies(admin, client!.id, []);
  check("18项只读工具也逐项执行工具级DENY", true);
  // 模拟离开项目后仍保留owner的旧记录：账号令牌也不能重新暴露已失去权限的项目。
  const hiddenView = await plans.createSavedView(admin, { name: "不可见项目保存视图", viewType: "TABLE", scope: "PROJECT_SHARED", projectId: project.id });
  const hiddenDashboard = await insight.createDashboard(admin, { name: "不可见项目仪表盘", projectId: project.id });
  await db.update(savedView).set({ ownerId: other.memberId }).where(eq(savedView.id, hiddenView!.id));
  await db.update(dashboard).set({ ownerId: other.memberId }).where(eq(dashboard.id, hiddenDashboard!.id));
  check("账号保存视图列表过滤失去可见性的项目", !(await call(otherToken.token, "savedView.list", {})).views.some((row: { id: string }) => row.id === hiddenView!.id));
  check("账号仪表盘列表过滤失去可见性的项目", !(await call(otherToken.token, "dashboard.list", {})).dashboards.some((row: { id: string }) => row.id === hiddenDashboard!.id));
  await call(otherToken.token, "savedView.get", { savedViewId: hiddenView!.id }, "FORBIDDEN");
  await call(otherToken.token, "dashboard.get", { dashboardId: hiddenDashboard!.id }, "FORBIDDEN");
  console.log(`MCP工作空间闭环 ${checks}/${checks}；${required.length}工具；${new Set(writeCases.map(([name]) => name)).size}写工具反控`);
} finally { await app.close(); await sql.end({ timeout: 5 }); }
