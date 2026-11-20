/** 项目管理、洞察、组合与导出；原始定义由总注册表统一 guard。 */
import { z } from "zod";
import type { ToolCtx, ToolDef } from "../tools.ts";
import { createProjectSchema } from "../../../../shared/schemas/project.ts";
import { templatePayloadSchema } from "../../../services/project-template.service.ts";
import * as project from "../../../services/project.service.ts";
import * as projectMember from "../../../services/project-member.service.ts";
import * as service from "../../../services/mcp-project.service.ts";
import * as templates from "../../../services/project-template.service.ts";
import * as insight from "../../../services/insight.service.ts";
import * as portfolio from "../../../services/portfolio.service.ts";
import * as fields from "../../../services/custom-field.service.ts";
import * as roles from "../../../services/role.service.ts";
import * as connection from "../../../services/mcp-connection.service.ts";
import * as webhook from "../../../services/webhook.service.ts";
import { withIdempotency } from "../../../services/idempotency.service.ts";

const UUID = { type: "string", format: "uuid" };
const text = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const bool = { type: "boolean" };
const integer = (minimum: number, maximum: number) => ({
  type: "integer",
  minimum,
  maximum,
});
const nullableUuid = { ...UUID, type: ["string", "null"] };
const pagination = { page: integer(1, 100000), pageSize: integer(1, 100) };
const projectRef = { projectId: UUID };
const dashboardRef = { ...projectRef, dashboardId: UUID };
const widgetRef = { ...dashboardRef, widgetId: UUID };
const widgetType = {
  type: "string",
  enum: [
    "BURNDOWN",
    "CUMULATIVE_FLOW",
    "ACTIVITY_HEATMAP",
    "PIE",
    "LIST",
    "COUNT",
  ],
};
const widgetConfig = {
  type: "object",
  properties: { iterationId: UUID },
  additionalProperties: false,
};
const integrationRef = { ...projectRef, integrationId: UUID };
const endpointRef = { ...projectRef, endpointId: UUID };
const credential = {
  ...text(2000),
  writeOnly: true,
  description: "仅写入并加密保存；从受控凭据渠道配置，不在对话中索取或回显",
};
const integrationConfig = {
  type: "object",
  properties: {
    repo: {
      type: "string",
      pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
      maxLength: 240,
    },
    userMap: {
      type: "object",
      maxProperties: 200,
      additionalProperties: text(100),
    },
  },
  additionalProperties: false,
};
const integrationPatch = {
  name: text(100),
  baseUrl: { type: "string", format: "uri", maxLength: 500 },
  token: credential,
  config: integrationConfig,
  isActive: bool,
};
const endpointPatch = {
  name: text(120),
  url: { type: "string", format: "uri", maxLength: 2000 },
  events: {
    type: "array",
    minItems: 1,
    maxItems: 20,
    uniqueItems: true,
    items: { type: "string", enum: webhook.WEBHOOK_EVENTS },
  },
  isActive: bool,
};
const fieldPatch = {
  name: text(120),
  options: {
    type: "array",
    maxItems: 100,
    items: {
      type: "object",
      properties: { value: text(100), label: text(120), color: text(40) },
      required: ["value", "label"],
      additionalProperties: false,
    },
  },
  requiredStates: { type: "array", maxItems: 100, items: text(80) },
  isRequired: bool,
  sortOrder: integer(-100000, 100000),
};
const createProjectProps = (
  z.toJSONSchema(createProjectSchema) as { properties: Record<string, unknown> }
).properties;
const templatePayload = z.toJSONSchema(templatePayloadSchema);
type Handler = (
  ctx: ToolCtx,
  args: Record<string, unknown>,
) => Promise<unknown>;
function tool(
  name: string,
  kind: "read" | "write",
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  handler: Handler,
  options: Partial<Pick<ToolDef, "scope" | "destructive" | "idempotent">> = {},
): ToolDef {
  return {
    name,
    kind,
    description,
    ...options,
    ...(kind === "write" ? { idempotent: options.idempotent !== false } : {}),
    inputSchema: {
      type: "object",
      properties: {
        ...properties,
        ...(kind === "write" && options.idempotent !== false
          ? { idempotencyKey: text(200) }
          : {}),
      },
      required,
      additionalProperties: false,
    },
    handler:
      kind === "read"
        ? handler
        : async (ctx, args) => {
            service.assertProjectToolWritePermission(ctx.actor, name, args);
            if (options.idempotent === false) return handler(ctx, args);
            const { idempotencyKey, ...input } = args;
            const result = await withIdempotency(
              {
                actorId: ctx.actor.memberId,
                key: (idempotencyKey as string | undefined) ?? null,
                scope: name,
                body: args,
              },
              () => handler(ctx, input),
            );
            return { replayed: result.replayed, result: result.value };
          },
  };
}
const read = (
  name: string,
  desc: string,
  properties: Record<string, unknown>,
  required: string[],
  handler: Handler,
  options?: Partial<Pick<ToolDef, "scope" | "destructive" | "idempotent">>,
) => tool(name, "read", desc, properties, required, handler, options);
const write = (
  name: string,
  desc: string,
  properties: Record<string, unknown>,
  required: string[],
  handler: Handler,
  options?: Partial<Pick<ToolDef, "scope" | "destructive" | "idempotent">>,
) => tool(name, "write", desc, properties, required, handler, options);
const account = { scope: "account" } as const;
const destructive = { destructive: true };
const ok = async (fn: Promise<unknown>) => {
  await fn;
  return { ok: true };
};
const patch = (args: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(
    Object.entries(args).filter(([key]) => !keys.includes(key)),
  );
const asInput = <T>(args: Record<string, unknown>) => args as T;
function managePortfolio(ctx: ToolCtx) {
  service.assertProjectPermission(ctx.actor, "project:create", null);
}

export const PROJECT_TOOLS: ToolDef[] = [
  write(
    "project.create",
    "创建项目并在同一事务复制工作流；需账号 project:create 权限和未限制项目的令牌。",
    createProjectProps,
    ["key", "name"],
    (c, a) => project.createProject(c.actor, createProjectSchema.parse(a)),
    account,
  ),
  write(
    "project.update",
    "修改项目名称、描述、负责人和部门；项目 key 创建后不可改。",
    {
      ...projectRef,
      name: text(200),
      description: { type: ["string", "null"], maxLength: 5000 },
      leadMemberId: nullableUuid,
      departmentId: nullableUuid,
    },
    ["projectId"],
    (c, a) =>
      service.updateProject(
        c.actor,
        String(a.projectId),
        patch(a, "projectId"),
      ),
  ),
  write(
    "project.archive",
    "归档项目；保留历史数据。",
    projectRef,
    ["projectId"],
    (c, a) => service.archiveProject(c.actor, String(a.projectId), true),
    destructive,
  ),
  write(
    "project.unarchive",
    "取消项目归档。",
    projectRef,
    ["projectId"],
    (c, a) => service.archiveProject(c.actor, String(a.projectId), false),
  ),
  write(
    "project.status",
    "按项目状态流转规则更改状态；状态定义见 project.get。",
    { ...projectRef, statusKey: text(40) },
    ["projectId", "statusKey"],
    (c, a) =>
      service.transitionProjectStatus(
        c.actor,
        String(a.projectId),
        String(a.statusKey),
      ),
    destructive,
  ),
  write(
    "project.member.add",
    "为项目添加成员和一个或多个角色；需 project:manage_member。",
    {
      ...projectRef,
      memberId: UUID,
      roleIds: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
        items: UUID,
      },
    },
    ["projectId", "memberId", "roleIds"],
    (c, a) =>
      projectMember.addProjectMember(c.actor, String(a.projectId), {
        memberId: String(a.memberId),
        roleIds: a.roleIds as string[],
      }),
  ),
  write(
    "project.member.remove",
    "移除项目成员及其项目角色；需 project:manage_member。",
    { ...projectRef, memberId: UUID },
    ["projectId", "memberId"],
    (c, a) =>
      ok(
        projectMember.removeProjectMember(
          c.actor,
          String(a.projectId),
          String(a.memberId),
        ),
      ),
    destructive,
  ),
  read(
    "member.list",
    "分页发现成员 ID、姓名、用户名及状态；需组织级 member:manage，不返回邮箱及负荷。",
    pagination,
    [],
    (c, a) => service.listMembers(c.actor, a),
    account,
  ),
  read(
    "role.list",
    "发现可授权角色的 ID、名称与权限；需组织级 role:manage。",
    {},
    [],
    async (c) => ({ roles: await roles.listRoles(c.actor) }),
    account,
  ),
  read(
    "projectTemplate.list",
    "列出项目模板；需 project:create 和未限制项目的令牌。",
    {},
    [],
    async (c) => ({ templates: await templates.listTemplates(c.actor) }),
    account,
  ),
  read(
    "projectTemplate.get",
    "读取项目模板初始集。",
    { templateId: UUID },
    ["templateId"],
    (c, a) => templates.getTemplate(c.actor, String(a.templateId)),
    account,
  ),
  write(
    "projectTemplate.create",
    "创建项目模板；初始集有数量上限。",
    { name: text(120), payload: templatePayload },
    ["name"],
    (c, a) =>
      templates.createTemplate(
        c.actor,
        asInput<Parameters<typeof templates.createTemplate>[1]>(a),
      ),
    account,
  ),
  write(
    "projectTemplate.update",
    "更新自定义模板；内置模板只读。",
    { templateId: UUID, name: text(120), payload: templatePayload },
    ["templateId"],
    (c, a) =>
      templates.updateTemplate(
        c.actor,
        String(a.templateId),
        patch(a, "templateId"),
      ),
    account,
  ),
  write(
    "projectTemplate.delete",
    "删除自定义模板；内置模板不可删除。",
    { templateId: UUID },
    ["templateId"],
    (c, a) => ok(templates.deleteTemplate(c.actor, String(a.templateId))),
    { ...account, ...destructive },
  ),
  write(
    "projectTemplate.createProject",
    "从模板创建项目，返回应用计数与逐项失败；失败项不会撤销已创建的项目。",
    {
      templateId: UUID,
      key: createProjectProps.key,
      name: text(100),
      description: { type: ["string", "null"], maxLength: 2000 },
    },
    ["templateId", "key", "name"],
    (c, a) =>
      templates.createProjectFromTemplate(
        c.actor,
        asInput<Parameters<typeof templates.createProjectFromTemplate>[1]>(a),
      ),
    account,
  ),
  read(
    "insight.burnDown",
    "迭代燃尽图；区分快照和实时推算，迭代必须属于 projectId。",
    { ...projectRef, iterationId: UUID },
    ["projectId", "iterationId"],
    async (c, a) => {
      await service.assertIterationProject(
        c.actor,
        String(a.projectId),
        String(a.iterationId),
      );
      return insight.burnDown(c.actor, String(a.iterationId));
    },
  ),
  read(
    "insight.cumulativeFlow",
    "迭代累积流及统计口径。",
    { ...projectRef, iterationId: UUID },
    ["projectId", "iterationId"],
    async (c, a) => {
      await service.assertIterationProject(
        c.actor,
        String(a.projectId),
        String(a.iterationId),
      );
      return insight.cumulativeFlow(c.actor, String(a.iterationId));
    },
  ),
  read(
    "insight.projectActivity",
    "项目活动趋势，最长 366 天。",
    { ...projectRef, days: integer(1, 366) },
    ["projectId"],
    (c, a) =>
      insight.projectActivitySeries(
        c.actor,
        String(a.projectId),
        a.days as number | undefined,
      ),
  ),
  read(
    "dashboard.list",
    "列出指定项目看板。",
    projectRef,
    ["projectId"],
    async (c, a) => ({
      dashboards: await service.listDashboards(c.actor, String(a.projectId)),
    }),
  ),
  read(
    "dashboard.get",
    "项目看板详情和挂件配置；数据请用 dashboard.widgets.data。",
    dashboardRef,
    ["projectId", "dashboardId"],
    (c, a) =>
      service.getDashboard(c.actor, String(a.projectId), String(a.dashboardId)),
  ),
  write(
    "dashboard.create",
    "创建项目看板；需 dashboard:manage。",
    { ...projectRef, name: text(80), isDefault: bool },
    ["projectId", "name"],
    (c, a) =>
      insight.createDashboard(
        c.actor,
        asInput<Parameters<typeof insight.createDashboard>[1]>(a),
      ),
  ),
  write(
    "dashboard.update",
    "更新项目看板名称及默认标记。",
    { ...dashboardRef, name: text(80), isDefault: bool },
    ["projectId", "dashboardId"],
    async (c, a) => {
      await service.getDashboard(
        c.actor,
        String(a.projectId),
        String(a.dashboardId),
      );
      return insight.updateDashboard(
        c.actor,
        String(a.dashboardId),
        patch(a, "projectId", "dashboardId"),
      );
    },
  ),
  write(
    "dashboard.delete",
    "删除项目看板及其挂件。",
    dashboardRef,
    ["projectId", "dashboardId"],
    async (c, a) => {
      await service.getDashboard(
        c.actor,
        String(a.projectId),
        String(a.dashboardId),
      );
      return ok(insight.deleteDashboard(c.actor, String(a.dashboardId)));
    },
    destructive,
  ),
  read(
    "dashboard.widgets.list",
    "列出项目看板挂件。",
    dashboardRef,
    ["projectId", "dashboardId"],
    async (c, a) => ({
      widgets: (
        await service.getDashboard(
          c.actor,
          String(a.projectId),
          String(a.dashboardId),
        )
      ).widgets,
    }),
  ),
  write(
    "dashboard.widgets.create",
    "添加项目看板挂件；燃尽/累积流仅允许引用同项目迭代。",
    {
      ...dashboardRef,
      type: widgetType,
      config: widgetConfig,
      sortOrder: integer(-100000, 100000),
    },
    ["projectId", "dashboardId", "type"],
    (c, a) =>
      service.addWidget(
        c.actor,
        String(a.projectId),
        String(a.dashboardId),
        asInput<Parameters<typeof insight.addWidget>[2]>(
          patch(a, "projectId", "dashboardId"),
        ),
      ),
  ),
  write(
    "dashboard.widgets.update",
    "修改项目挂件类型、配置及顺序。",
    {
      ...widgetRef,
      type: widgetType,
      config: widgetConfig,
      sortOrder: integer(-100000, 100000),
    },
    ["projectId", "dashboardId", "widgetId"],
    (c, a) =>
      service.updateWidget(
        c.actor,
        String(a.projectId),
        String(a.dashboardId),
        String(a.widgetId),
        patch(a, "projectId", "dashboardId", "widgetId"),
      ),
  ),
  write(
    "dashboard.widgets.delete",
    "删除项目看板挂件。",
    widgetRef,
    ["projectId", "dashboardId", "widgetId"],
    async (c, a) => {
      await service.getWidget(
        c.actor,
        String(a.projectId),
        String(a.dashboardId),
        String(a.widgetId),
      );
      return ok(insight.deleteWidget(c.actor, String(a.widgetId)));
    },
    destructive,
  ),
  read(
    "dashboard.widgets.data",
    "读取指定挂件的真实聚合和统计口径。",
    widgetRef,
    ["projectId", "dashboardId", "widgetId"],
    async (c, a) =>
      insight.widgetData(
        c.actor,
        await service.getWidget(
          c.actor,
          String(a.projectId),
          String(a.dashboardId),
          String(a.widgetId),
        ),
      ),
  ),
  read(
    "portfolio.list",
    "列出项目集和账号可见项目汇总；拒绝项目受限令牌，需组织 project:create。",
    {},
    [],
    async (c) => {
      managePortfolio(c);
      return { portfolios: await portfolio.listPortfolios(c.actor) };
    },
    account,
  ),
  read(
    "portfolio.get",
    "读取项目集及账号可见项目。",
    { portfolioId: UUID },
    ["portfolioId"],
    (c, a) => {
      managePortfolio(c);
      return portfolio.getPortfolio(c.actor, String(a.portfolioId));
    },
    account,
  ),
  write(
    "portfolio.create",
    "创建项目集分组。",
    { name: text(120) },
    ["name"],
    (c, a) => portfolio.createPortfolio(c.actor, { name: String(a.name) }),
    account,
  ),
  write(
    "portfolio.update",
    "更新项目集名称。",
    { portfolioId: UUID, name: text(120) },
    ["portfolioId", "name"],
    (c, a) =>
      portfolio.updatePortfolio(c.actor, String(a.portfolioId), {
        name: String(a.name),
      }),
    account,
  ),
  write(
    "portfolio.delete",
    "删除项目集分组；项目本身仍保留。",
    { portfolioId: UUID },
    ["portfolioId"],
    (c, a) => ok(portfolio.deletePortfolio(c.actor, String(a.portfolioId))),
    { ...account, ...destructive },
  ),
  write(
    "portfolio.addProject",
    "把项目加入项目集。",
    { portfolioId: UUID, ...projectRef },
    ["portfolioId", "projectId"],
    (c, a) =>
      portfolio.addProject(c.actor, String(a.portfolioId), String(a.projectId)),
    account,
  ),
  write(
    "portfolio.removeProject",
    "从项目集中移除项目。",
    { portfolioId: UUID, ...projectRef },
    ["portfolioId", "projectId"],
    (c, a) =>
      portfolio.removeProject(
        c.actor,
        String(a.portfolioId),
        String(a.projectId),
      ),
    { ...account, ...destructive },
  ),
  read(
    "portfolio.summary",
    "项目集进展、风险、里程碑及近期活动；拒绝项目受限令牌。",
    { portfolioId: UUID },
    ["portfolioId"],
    (c, a) => {
      managePortfolio(c);
      return portfolio.getSummary(c.actor, String(a.portfolioId));
    },
    account,
  ),
  read(
    "customField.definitions",
    "列出项目自定义字段定义；可包含归档字段。",
    { ...projectRef, includeArchived: bool },
    ["projectId"],
    async (c, a) => ({
      definitions: await fields.listDefs(c.actor, String(a.projectId), {
        includeArchived: a.includeArchived as boolean | undefined,
      }),
    }),
  ),
  write(
    "customField.create",
    "创建项目自定义字段；需 work_item:manage_field。",
    {
      ...projectRef,
      ...fieldPatch,
      key: { type: "string", pattern: "^[a-z][a-z0-9_]{1,39}$" },
      type: { type: "string", enum: fields.FIELD_TYPES },
    },
    ["projectId", "key", "name", "type"],
    (c, a) =>
      fields.createDef(
        c.actor,
        String(a.projectId),
        asInput<Parameters<typeof fields.createDef>[2]>(patch(a, "projectId")),
      ),
  ),
  write(
    "customField.update",
    "更新字段定义；key 和 type 不可修改。",
    { ...projectRef, fieldId: UUID, ...fieldPatch },
    ["projectId", "fieldId"],
    (c, a) =>
      service.updateField(
        c.actor,
        String(a.projectId),
        String(a.fieldId),
        patch(a, "projectId", "fieldId"),
      ),
  ),
  write(
    "customField.archive",
    "归档字段，保留已有值。",
    { ...projectRef, fieldId: UUID },
    ["projectId", "fieldId"],
    async (c, a) => {
      await service.assertFieldProject(
        c.actor,
        String(a.projectId),
        String(a.fieldId),
      );
      return ok(fields.archiveDef(c.actor, String(a.fieldId)));
    },
    destructive,
  ),
  read(
    "project.report",
    "生成项目 PDF 报告，以 base64 返回，最大 1 MiB。",
    projectRef,
    ["projectId"],
    (c, a) => service.projectReport(c.actor, String(a.projectId)),
  ),
  read(
    "project.exportCsv",
    "按筛选导出项目工作项 CSV，最多 1000 行及 1 MiB；超限应收窄筛选。",
    {
      ...projectRef,
      limit: integer(1, 1000),
      type: {
        type: "string",
        enum: ["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"],
      },
      severity: { type: "string", enum: ["S1", "S2", "S3", "S4"] },
      priority: {
        type: "string",
        enum: ["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"],
      },
      statusCategory: {
        type: "string",
        enum: ["OPEN", "DONE", "NOT_STARTED", "IN_PROGRESS", "TERMINAL"],
      },
      assigneeId: UUID,
      milestoneId: UUID,
      q: text(200),
    },
    ["projectId"],
    (c, a) =>
      service.exportCsv(
        c.actor,
        String(a.projectId),
        patch(a, "projectId", "limit"),
        a.limit as number | undefined,
      ),
  ),
  read(
    "integration.list",
    "安全列出项目外部集成状态；需 integration:manage，不含 URL、配置和凭据。",
    projectRef,
    ["projectId"],
    async (c, a) => ({
      integrations: await service.listIntegrations(
        c.actor,
        String(a.projectId),
      ),
    }),
  ),
  write(
    "integration.create",
    "创建项目 Git 集成；token 仅写入加密存储，响应只含状态；沿用统一 SSRF 校验。",
    {
      ...projectRef,
      ...integrationPatch,
      kind: { type: "string", enum: ["GITLAB", "GITHUB", "GITEE"] },
    },
    ["projectId", "kind", "name", "baseUrl", "token"],
    (c, a) =>
      connection.createIntegration(
        c.actor,
        asInput<Parameters<typeof connection.createIntegration>[1]>(a),
      ),
  ),
  write(
    "integration.update",
    "更新项目集成配置或轮换凭据；不允许更改项目归属，不返回凭据与配置。",
    { ...integrationRef, ...integrationPatch },
    ["projectId", "integrationId"],
    (c, a) =>
      connection.updateIntegration(
        c.actor,
        String(a.projectId),
        String(a.integrationId),
        patch(a, "projectId", "integrationId"),
      ),
  ),
  write(
    "integration.delete",
    "删除项目集成及同步游标。",
    integrationRef,
    ["projectId", "integrationId"],
    (c, a) =>
      connection.deleteIntegration(
        c.actor,
        String(a.projectId),
        String(a.integrationId),
      ),
    destructive,
  ),
  read(
    "integration.syncStatus",
    "读取项目集成启用状态和最近同步时间；不返回凭据、配置及游标内容。",
    integrationRef,
    ["projectId", "integrationId"],
    (c, a) =>
      connection.syncStatus(
        c.actor,
        String(a.projectId),
        String(a.integrationId),
      ),
  ),
  write(
    "integration.sync",
    "立即从项目 Git 集成拉取提交、PR 和评审，返回计数；会调用外部服务。",
    integrationRef,
    ["projectId", "integrationId"],
    (c, a) =>
      connection.syncIntegration(
        c.actor,
        String(a.projectId),
        String(a.integrationId),
      ),
  ),
  read(
    "webhook.list",
    "列出项目 Webhook 端点；签名密钥永不回显。",
    projectRef,
    ["projectId"],
    async (c, a) => ({
      endpoints: await webhook.listEndpoints(c.actor, String(a.projectId)),
    }),
  ),
  write(
    "webhook.create",
    "创建项目 Webhook；响应仅本次返回一次签名 secret，请安全保存。不会缓存密钥；请求重试可能创建第二个端点。",
    {
      ...projectRef,
      name: endpointPatch.name,
      url: endpointPatch.url,
      events: endpointPatch.events,
    },
    ["projectId", "name", "url", "events"],
    (c, a) =>
      webhook.createEndpoint(
        c.actor,
        asInput<Parameters<typeof webhook.createEndpoint>[1]>(a),
      ),
    { idempotent: false },
  ),
  write(
    "webhook.update",
    "修改项目 Webhook 订阅和启停状态；URL 沿用统一 SSRF 校验。",
    { ...endpointRef, ...endpointPatch },
    ["projectId", "endpointId"],
    (c, a) =>
      connection.updateEndpoint(
        c.actor,
        String(a.projectId),
        String(a.endpointId),
        patch(a, "projectId", "endpointId"),
      ),
  ),
  write(
    "webhook.delete",
    "删除项目 Webhook 及投递记录。",
    endpointRef,
    ["projectId", "endpointId"],
    (c, a) =>
      connection.deleteEndpoint(
        c.actor,
        String(a.projectId),
        String(a.endpointId),
      ),
    destructive,
  ),
  read(
    "webhook.deliveries",
    "列出项目端点最近 100 次投递状态；不回显 payload、错误正文或密钥。",
    {
      ...endpointRef,
      status: {
        type: "string",
        enum: ["PENDING", "RETRYING", "SUCCEEDED", "DEAD"],
      },
    },
    ["projectId", "endpointId"],
    async (c, a) => ({
      deliveries: await connection.deliveries(
        c.actor,
        String(a.projectId),
        String(a.endpointId),
        a.status as string | undefined,
      ),
    }),
  ),
  write(
    "webhook.replay",
    "人工重放项目端点的一次投递；会调用外部地址并可能重复触发接收方操作。",
    { ...endpointRef, deliveryId: UUID },
    ["projectId", "endpointId", "deliveryId"],
    (c, a) =>
      connection.replay(
        c.actor,
        String(a.projectId),
        String(a.endpointId),
        String(a.deliveryId),
      ),
    destructive,
  ),
];
