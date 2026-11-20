/** Agent 业务发现与生命周期工具；权限和业务写入复用 REST 的领域服务。 */
import type { ToolDef } from "./tools.ts";
import { guardTools } from "./guard.ts";
import { BUSINESS_WORKFLOWS } from "./business-workflows.ts";
import { describeTool } from "./contracts.ts";
import { DomainError } from "../../../shared/errors.ts";
import { tierAllows } from "../../services/token.service.ts";
import { assertToolPolicyAllowed } from "../../services/mcp-client.service.ts";
import * as items from "../../services/work-item.service.ts";
import * as ideas from "../../services/idea.service.ts";
import * as plans from "../../services/planning.service.ts";
import * as lifecycle from "../../services/planning-lifecycle.service.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";

const UUID = { type: "string", format: "uuid" };
const text = { type: "string" };
const object = { type: "object", additionalProperties: true };
const array = { type: "array", items: object };
const shape = (properties: Record<string, object>) => ({ type: "object" as const, properties, required: Object.keys(properties), additionalProperties: true });
const input = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const entity = shape({ id: UUID });
const name = { type: "string", minLength: 1, maxLength: 200 };
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const nullableText = (maxLength: number) => ({ type: ["string", "null"], maxLength });

export function createAgentTools(catalog: () => ToolDef[]): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "meta.capabilities", kind: "read",
      description: "发现实例工具、令牌档位和项目白名单。allowed 表示档位及工具策略允许；实际资源与账号权限仍在调用时检查。",
      inputSchema: input({}), outputSchema: shape({ tokenTier: text, projectWhitelist: { type: "array", items: UUID }, tools: array }),
      handler: async ctx => ({ tokenTier: ctx.token.tier, projectWhitelist: ctx.token.projectWhitelist, toolCount: catalog().length, workflows: BUSINESS_WORKFLOWS.map(flow => ({ ...flow, missingTools: flow.steps.filter(name => !catalog().some(tool => tool.name === name)) })), tools: await Promise.all(catalog().map(async tool => {
        let allowed = tierAllows(ctx.token, tool.kind);
        try { await assertToolPolicyAllowed(ctx.token.tokenId, tool.name); } catch (error) {
          if (!(error instanceof DomainError) || error.code !== "FORBIDDEN") throw error;
          allowed = false;
        }
        return { name: tool.name, description: tool.description, kind: tool.kind, scope: tool.scope ?? "project_or_resource", confirmationRequired: tool.kind === "write", allowed };
      })) }),
    },
    {
      name: "meta.tool", kind: "read", description: "按工具名读取完整输入/输出契约和读写提示；不存在的名称返回 NOT_FOUND。",
      inputSchema: input({ name: { type: "string", minLength: 1 } }, ["name"]), outputSchema: shape({ tool: object }),
      handler: async (_ctx, args) => {
        const tool = catalog().find(tool => tool.name === args.name);
        if (!tool) throw new DomainError("NOT_FOUND", "工具不存在", null);
        return { tool: describeTool(tool) };
      },
    },
    {
      name: "project.context", kind: "read", description: "一次读取项目、成员、工作流、字段、自定义字段、计划和前20项工作项，供 Agent 在指定项目内准备业务操作。",
      inputSchema: input({ projectId: UUID }, ["projectId"]),
      outputSchema: shape({ project: entity, members: array, workflow: object, fields: object, customFields: object, iterations: array, releases: array, milestones: array, modules: array, workItems: object }),
      handler: async (ctx, args) => {
        const projectArgs = { projectId: String(args.projectId) };
        const requests: [string, Record<string, unknown>][] = [["project.get", projectArgs], ["project.members", projectArgs],
          ["meta.workflow", projectArgs], ["meta.fields", {}], ["plan.listIterations", projectArgs], ["plan.listReleases", projectArgs], ["plan.listMilestones", projectArgs],
          ["customField.definitions", projectArgs], ["plan.listModules", projectArgs], ["workitem.list", { ...projectArgs, pageSize: 20 }]];
        // 聚合读取与单工具使用完全相同的策略、输入守卫及领域服务。
        for (const [name] of requests) await assertToolPolicyAllowed(ctx.token.tokenId, name);
        const [project, members, workflow, fields, iterations, releases, milestones, customFields, modules, workItems] = await Promise.all(requests.map(async ([name, input]) => {
          const tool = catalog().find(tool => tool.name === name);
          if (!tool) throw new DomainError("INTERNAL", "项目上下文工具契约缺失", { name });
          return await tool.handler(ctx, input) as Record<string, unknown>;
        }));
        return { project, members: members!.members, workflow, fields, customFields, iterations: iterations!.iterations, releases: releases!.releases, milestones: milestones!.milestones, modules: modules!.modules, workItems };
      },
    },
    {
      name: "workitem.children", kind: "read", description: "读取指定工作项的直接子项；先检查父项可见性与令牌项目范围。",
      inputSchema: input({ workItemId: UUID }, ["workItemId"]), outputSchema: shape({ parent: entity, children: array }),
      handler: async (ctx, args) => items.listChildren(ctx.actor, String(args.workItemId)),
    },
    {
      name: "idea.list", kind: "read", description: "按项目和状态分页读取想法，按热度及创建时间排序。",
      inputSchema: input({ projectId: UUID, status: { type: "string", enum: [...ideas.IDEA_STATUSES] }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 } }, ["projectId"]),
      outputSchema: shape({ items: array, total: { type: "number" }, page: { type: "number" }, pageSize: { type: "number" } }),
      handler: async (ctx, args) => ideas.listIdeas(ctx.actor, String(args.projectId), { status: args.status as string | undefined, page: args.page as number | undefined, pageSize: args.pageSize as number | undefined }),
    },
    {
      name: "idea.get", kind: "read", description: "读取想法详情、投票和转化工作项关联。",
      inputSchema: input({ ideaId: UUID }, ["ideaId"]), outputSchema: entity,
      handler: async (ctx, args) => ideas.getIdea(ctx.actor, String(args.ideaId)),
    },
    {
      name: "idea.update", kind: "write", description: "更新想法标题、描述或评审状态；需要 idea:manage 权限，执行前须获得用户确认。",
      inputSchema: input({ ideaId: UUID, title: { type: "string", minLength: 1, maxLength: 500 }, description: nullableText(20000), status: { type: "string", enum: [...ideas.IDEA_STATUSES] } }, ["ideaId"]), outputSchema: entity,
      handler: async (ctx, args) => { const { ideaId, ...patch } = args; return ideas.updateIdea(ctx.actor, String(ideaId), patch); },
    },
  ];
  tools.push({
    name: "plan.listModules", kind: "read", description: "列出项目模块及父子关系；默认排除归档模块。",
    inputSchema: input({ projectId: UUID, includeArchived: { type: "boolean" } }, ["projectId"]), outputSchema: shape({ modules: array }),
    handler: async (ctx, args) => ({ modules: await plans.list(ctx.actor, String(args.projectId), "module", { includeArchived: args.includeArchived === true }) }),
  }, {
    name: "plan.getModule", kind: "read", description: "读取模块详情及父级、归档状态。",
    inputSchema: input({ moduleId: UUID }, ["moduleId"]), outputSchema: entity,
    handler: async (ctx, args) => plans.get(ctx.actor, String(args.moduleId), "module"),
  });
  for (const kind of ["milestone", "module"] as const) {
    const suffix = kind === "milestone" ? "Milestone" : "Module";
    const idField = `${kind}Id`;
    const label = kind === "milestone" ? "里程碑" : "模块";
    const confirmed = { userConfirmed: { type: "boolean", description: "用户已明确确认本次写操作" } };
    tools.push({
      name: `plan.update${suffix}`, kind: "write", description: `更新${label}；需要计划管理权限及 userConfirmed=true。`,
      inputSchema: input({ [idField]: UUID, ...confirmed, name, ...(kind === "module" ? { parentId: { anyOf: [UUID, { type: "null" }] } } : {
        description: nullableText(5000), startDate: { anyOf: [date, { type: "null" }] }, dueDate: { anyOf: [date, { type: "null" }] },
        progressMode: { type: "string", enum: ["COUNT", "ESTIMATE_WEIGHTED", "MANUAL"] }, progressValue: { type: ["number", "null"], minimum: 0, maximum: 100 },
      }) }, [idField, "userConfirmed"]), outputSchema: entity,
      handler: async (ctx, args) => {
        const { [idField]: id, userConfirmed, ...patch } = args;
        requireUserConfirmation(userConfirmed === true);
        return plans.updatePlan(ctx.actor, String(id), kind, patch);
      },
    });
    for (const action of ["archive", "unarchive"] as const) tools.push({
      name: `plan.${action}${suffix}`, kind: "write", description: `${action === "archive" ? "归档" : "恢复归档"}${label}；归档前须移出关联工作项。需要 userConfirmed=true。`,
      inputSchema: input({ [idField]: UUID, ...confirmed }, [idField, "userConfirmed"]), outputSchema: entity,
      handler: async (ctx, args) => {
        requireUserConfirmation(args.userConfirmed === true);
        await plans[action](ctx.actor, String(args[idField]), kind);
        return plans.get(ctx.actor, String(args[idField]), kind);
      },
    });
  }
  for (const kind of ["iteration", "release"] as const) {
    const suffix = kind === "iteration" ? "Iteration" : "Release";
    const idField = `${kind}Id`;
    tools.push({
      name: `plan.get${suffix}`, kind: "read", description: `读取${kind === "iteration" ? "迭代" : "版本"}详情，含完成和归档状态。`,
      inputSchema: input({ [idField]: UUID }, [idField]), outputSchema: entity,
      handler: async (ctx, args) => plans.getDetail(ctx.actor, String(args[idField]), kind),
    }, {
      name: `plan.update${suffix}`, kind: "write", description: `更新${kind === "iteration" ? "迭代" : "版本"}属性，复用计划管理权限；执行前须获得用户确认。`,
      inputSchema: input({ [idField]: UUID, name, ...(kind === "iteration"
        ? { startDate: date, endDate: date, carryOver: { type: "boolean" } }
        : { versionTag: nullableText(100), releaseDate: { anyOf: [date, { type: "null" }] }, notes: nullableText(10000) }) }, [idField]), outputSchema: entity,
      handler: async (ctx, args) => { const { [idField]: id, ...patch } = args; return plans.updatePlan(ctx.actor, String(id), kind, patch); },
    }, {
      name: `plan.complete${suffix}`, kind: "write",
      description: kind === "iteration" ? "结束迭代；carryOver=true 且存在未完成项时必须指定同项目未完成目标迭代，原子结转。重复完成不再结转，执行前须获得用户确认。" : "完成版本；仍有未完成工作项时拒绝。重复完成保持原完成时间，执行前须获得用户确认。",
      inputSchema: input({ [idField]: UUID, ...(kind === "iteration" ? { targetIterationId: { anyOf: [UUID, { type: "null" }] } } : {}) }, [idField]),
      outputSchema: shape({ id: UUID, completedAt: text, alreadyCompleted: { type: "boolean" }, movedCount: { type: "integer" } }),
      annotations: { idempotentHint: true },
      handler: async (ctx, args) => lifecycle.complete(ctx.actor, String(args[idField]), kind, { targetIterationId: args.targetIterationId as string | null | undefined }),
    });
    for (const action of ["archive", "unarchive"] as const) tools.push({
      name: `plan.${action}${suffix}`, kind: "write", description: `${action === "archive" ? "归档" : "恢复归档"}${kind === "iteration" ? "迭代" : "版本"}。保留完成状态和历史记录；归档前必须结束且没有未完成工作项。执行前须获得用户确认。`,
      inputSchema: input({ [idField]: UUID }, [idField]), outputSchema: entity, annotations: { idempotentHint: true },
      handler: async (ctx, args) => lifecycle.setArchived(ctx.actor, String(args[idField]), kind, action === "archive"),
    });
  }
  return guardTools(tools);
}
