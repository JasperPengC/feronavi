/**
 * MCP 工具注册表（第六期 W4，总纲 4.9 节）
 *
 * 纪律（第 4.1 节）：**REST 与 MCP 共用同一 service 层** —— 每个工具只是
 * 一层参数映射与守卫，**不允许在工具里写查询**。
 *
 * 读写工具均执行声明的输入契约、令牌范围和领域服务授权。
 */
import { DomainError } from "../../shared/errors.ts";
import { WRITE_TOOLS } from "./write-tools.ts";
import { guardTools } from "./guard.ts";
import type { Actor } from "../permission/actor.ts";
import { projectAllowed, tierAllows, type TokenContext } from "../services/token.service.ts";
import * as projectService from "../services/project.service.ts";
import * as wiService from "../services/work-item.service.ts";
import * as commentService from "../services/comment.service.ts";
import * as planningService from "../services/planning.service.ts";
import * as notifService from "../services/notification.service.ts";
import * as auditService from "../services/audit.service.ts";
import * as metaService from "../services/meta.service.ts";
import * as wikiService from "../services/wiki.service.ts";
import * as knowledgeService from "../services/knowledge.service.ts";
import * as slaService from "../services/sla.service.ts";
import * as approvalService from "../services/approval.service.ts";
import * as automationService from "../services/automation.service.ts";
import * as collabRooms from "../services/collab-room.persistence.ts";
import * as collabDocuments from "../services/collab-document.service.ts";

const COLLAB_ACTIONS: Record<string, { read: string[]; write: string[] }> = {
  PAGE: { read: ["page.get"], write: ["collab.update", "collab.publishPage"] },
  WORK_ITEM: { read: ["workitem.get"], write: ["workitem.update", "workitem.transition", "workitem.assign", "workitem.comment"] },
  COMMENT: { read: [], write: ["comment.update", "comment.delete"] },
  PLAN: { read: ["plan.getMilestone"], write: ["plan.createMilestone", "plan.createIteration", "plan.createRelease", "plan.createModule"] },
  APPROVAL: { read: ["approval.list"], write: ["approval.approve", "approval.reject"] },
  AUTOMATION: { read: ["automation.listRules", "automation.listRuns"], write: ["automation.createRule"] },
};
const COLLAB_DOMAIN_TOOLS: Record<string, string[]> = {
  WORK_ITEM: ["workitem.get", "workitem.update", "workitem.transition", "workitem.assign", "workitem.comment"],
  COMMENT: ["comment.update", "comment.delete"],
  PLAN: ["plan.getMilestone", "plan.createMilestone", "plan.createIteration", "plan.createRelease", "plan.createModule"],
  APPROVAL: ["approval.list", "approval.approve", "approval.reject"],
  AUTOMATION: ["automation.listRules", "automation.listRuns", "automation.createRule"],
};

export interface ToolCtx {
  actor: Actor;
  token: TokenContext;
}

export interface ToolDef {
  name: string;
  description: string;
  kind: "read" | "write";
  inputSchema: Record<string, unknown>;
  handler: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<unknown>;
}

const UUID = { type: "string", format: "uuid" } as const;
const str = (description: string) => ({ type: "string", description }) as const;

/** 项目白名单守卫：非白名单项目一律 NOT_FOUND（与"不存在"同形，不泄露存在性） */
function assertProject(ctx: ToolCtx, projectId: string): void {
  if (!projectAllowed(ctx.token, projectId)) {
    throw new DomainError("NOT_FOUND", "资源不存在", null);
  }
}

/** 可见项目（已按令牌白名单收窄）—— whoami 与 project.list 共用同一口径 */
async function visibleProjects(ctx: ToolCtx, opts: { page?: number; pageSize?: number } = {}) {
  const r = await projectService.listVisibleFor(ctx.actor, { page: opts.page, pageSize: opts.pageSize ?? 100 });
  return ctx.token.projectWhitelist.length
    ? r.items.filter((p) => projectAllowed(ctx.token, String(p.id)))
    : r.items;
}

export const TOOLS: ToolDef[] = guardTools([
  {
    name: "ping",
    description: "连通性自检。客户端冷启动第一个调用，验证令牌与端点可用。",
    kind: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => ({ ok: true, server: "feronavi" }),
  },
  {
    name: "collab.inspect",
    description: "读取协作房间的项目范围、当前发布基线、在线成员能力和可执行动作。草稿不会被当作 RAG 已发布知识。",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: { resourceType: { type: "string", enum: ["PAGE", "WORK_ITEM", "COMMENT", "PLAN", "APPROVAL", "AUTOMATION"] }, resourceId: UUID },
      required: ["resourceType", "resourceId"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const room = await collabRooms.getRoom(ctx.actor, String(args.resourceType), String(args.resourceId));
      if (!projectAllowed(ctx.token, room.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      const state = await collabDocuments.loadDocument(room.id);
      const canWrite = await collabRooms.canWriteRoom(ctx.actor, room);
      return {
        roomId: room.id, resourceType: room.resourceType, resourceId: room.resourceId, projectId: room.projectId,
        mode: room.mode, baseRevisionId: room.baseRevisionId, sequence: state.sequence,
        canWrite,
        rag: { source: room.resourceType === "PAGE" ? "published_revision" : "not_applicable", publishedRevisionId: room.baseRevisionId },
        actions: (() => {
          const actions = COLLAB_ACTIONS[room.resourceType];
          const writable = canWrite && ctx.token.tier !== "READ_ONLY";
          return room.mode === "TEXT_CRDT" ? [...(actions?.read ?? []), ...(writable ? actions?.write ?? [] : [])] : [];
        })(),
        domainTools: COLLAB_DOMAIN_TOOLS[room.resourceType] ?? [],
        domainAuthorization: "每个 MCP 领域工具会重新检查账号权限、项目白名单和业务前置条件",
      };
    },
  },
  {
    name: "whoami",
    description: "自省：当前身份、令牌档位、可见项目。冷启动必调 —— 拿到项目 ID 后再调其它工具。",
    kind: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      // 三重交集：whoami 的"可见项目"必须已经过令牌白名单收窄，
      // 否则 agent 会拿到它其实无权访问的项目 ID（实测踩到）
      const projects = await visibleProjects(ctx);
      return {
        member: { id: ctx.actor.memberId, username: ctx.actor.username, name: ctx.actor.name },
        tokenTier: ctx.token.tier,
        projectWhitelist: ctx.token.projectWhitelist,   // 空 = 不限制
        permissions: [...ctx.actor.permissions].sort(),
        timezone: ctx.actor.timezone,
        locale: ctx.actor.locale,
        visibleProjects: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })),
      };
    },
  },
  {
    name: "project.list",
    description: "可见项目列表（按数据范围过滤）。",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: { page: { type: "number" }, pageSize: { type: "number" } },
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const items = await visibleProjects(ctx, {
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
      return { items, total: items.length };
    },
  },
  {
    name: "project.get",
    description: "项目详情（含状态与工作项计数）。",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return projectService.getProjectDetail(ctx.actor, projectId);
    },
  },
  {
    name: "project.members",
    description: "项目成员与项目级角色。**这是人名 → 成员 ID 的唯一途径，不要猜 ID。**",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return { members: await projectService.membersOf(ctx.actor, projectId) };
    },
  },
  {
    name: "workitem.list",
    description: "工作项列表（可按状态 key / 指派人 / 类型过滤，分页）。",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: {
        projectId: UUID,
        statusKey: str("状态 key，如 TODO / IN_PROGRESS；合法值请先读 meta.workflow"),
        assigneeId: UUID,
        type: { type: "string", enum: ["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"] },
        page: { type: "number" },
        pageSize: { type: "number" },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return wiService.listWorkItems(ctx.actor, projectId, {
        statusKey: args.statusKey as string | undefined,
        assigneeId: args.assigneeId as string | undefined,
        type: args.type as string | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
    },
  },
  {
    name: "workitem.get",
    description: "工作项详情，附带当前身份可用的状态流转（迁移边）。",
    kind: "read",
    inputSchema: { type: "object", properties: { workItemId: UUID }, required: ["workItemId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const id = String(args.workItemId);
      const wi = await wiService.getWorkItem(ctx.actor, id);
      assertProject(ctx, String(wi.projectId));
      const transitions = await wiService.allowedTransitions(ctx.actor, {
        workflowId: wi.workflowId, statusId: wi.statusId,
      });
      return { workItem: wi, allowedTransitions: transitions };
    },
  },
  {
    name: "workitem.comments",
    description: "工作项的评论（顶层 + 回复，深度限 2 层）。",
    kind: "read",
    inputSchema: { type: "object", properties: { workItemId: UUID }, required: ["workItemId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const id = String(args.workItemId);
      const wi = await wiService.getWorkItem(ctx.actor, id);
      assertProject(ctx, String(wi.projectId));
      return { comments: await commentService.listComments(ctx.actor, "WORK_ITEM", id, { parentId: null }) };
    },
  },
  {
    name: "plan.listMilestones",
    description: "里程碑列表。",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: { projectId: UUID, includeArchived: { type: "boolean" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return {
        milestones: await planningService.list(ctx.actor, projectId, "milestone", {
          includeArchived: args.includeArchived === true,
        }),
      };
    },
  },
  {
    name: "plan.getMilestone",
    description: "里程碑详情，**含其下工作项**。",
    kind: "read",
    inputSchema: { type: "object", properties: { milestoneId: UUID }, required: ["milestoneId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const id = String(args.milestoneId);
      const ms = await planningService.get(ctx.actor, id, "milestone");
      assertProject(ctx, String(ms.projectId));
      const linked = await wiService.listWorkItems(ctx.actor, String(ms.projectId), { pageSize: 100 });
      return {
        milestone: ms,
        workItems: linked.items.filter((i) => String(i.milestoneId ?? "") === id),
      };
    },
  },
  {
    name: "plan.listIterations",
    description: "迭代列表（含起止日期与结转策略）。",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return { iterations: await planningService.list(ctx.actor, projectId, "iteration") };
    },
  },
  {
    name: "plan.listReleases",
    description: "版本列表。",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return { releases: await planningService.list(ctx.actor, projectId, "release") };
    },
  },
  {
    name: "notification.list",
    description: "自己的通知，返回体含 unreadCount。",
    kind: "read",
    inputSchema: { type: "object", properties: { unreadOnly: { type: "boolean" } }, additionalProperties: false },
    handler: async (ctx, args) => ({
      items: await notifService.listNotifications(ctx.actor, { unreadOnly: args.unreadOnly === true }),
      unreadCount: await notifService.countUnread(ctx.actor),
    }),
  },
  {
    name: "activity.project",
    description: "项目研发活跃度（活动时间线，仅项目维度）。",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: {
        projectId: UUID, page: { type: "number" }, pageSize: { type: "number" },
        category: { type: "string", description: "动作类别：work_item / comment / wiki / attachment / plan / project / announcement / role / idea" },
        q: { type: "string", description: "摘要关键字" },
        mineOnly: { type: "boolean", description: "只看当前成员自己的活动" },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return auditService.projectActivity(ctx.actor, projectId, {
        page: (args.page as number | undefined) ?? 1,
        pageSize: (args.pageSize as number | undefined) ?? 50,
        category: args.category as string | undefined,
        q: args.q as string | undefined,
        mineOnly: args.mineOnly === true,
      });
    },
  },
  {
    name: "meta.workflow",
    description: "项目的工作流定义：状态、迁移边与每边的必填字段。**流转前必须先读这个，不要硬编码状态名。**",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return metaService.describeWorkflows(ctx.actor, projectId);
    },
  },
  {
    name: "page.list",
    description: "项目文档列表（标题/可见性/更新时间）。读文档正文用 page.get。",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return { pages: await wikiService.listPages(ctx.actor, projectId) };
    },
  },
  {
    name: "page.get",
    description: "文档详情（正文、当前版本、可见性）。",
    kind: "read",
    inputSchema: { type: "object", properties: { pageId: UUID }, required: ["pageId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const page = await wikiService.getPage(ctx.actor, String(args.pageId));
      assertProject(ctx, String(page.projectId));
      return page;
    },
  },
  {
    name: "knowledge.search",
    description: "项目知识库检索（向量优先，未配置 AI 时退化为关键词）；返回带引用的片段。",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: { projectId: UUID, q: str("检索问题"), limit: { type: "number", minimum: 1, maximum: 20 } },
      required: ["projectId", "q"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return knowledgeService.searchKnowledge(ctx.actor, projectId, String(args.q), Number(args.limit ?? 10));
    },
  },
  {
    name: "knowledge.ask",
    description: "基于项目知识库问答（返回服务端派生的引用；未配置模型时只返回检索片段）。",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: { projectId: UUID, question: str("问题"), limit: { type: "number", minimum: 1, maximum: 20 } },
      required: ["projectId", "question"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertProject(ctx, projectId);
      return knowledgeService.askKnowledge(ctx.actor, projectId, String(args.question), Number(args.limit ?? 5));
    },
  },
  {
    name: "meta.fields",
    description: "工作项字段定义（类型 / 必填 / 取值域）。提交前读一次，避免被 VALIDATION 拒绝。",
    kind: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => metaService.describeFields(),
  },
  {
    name: "sla.get",
    description: "查看工作项的 SLA 时钟、策略与暂停状态。",
    kind: "read",
    inputSchema: { type: "object", properties: { workItemId: UUID }, required: ["workItemId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const wi = await wiService.getWorkItem(ctx.actor, String(args.workItemId));
      assertProject(ctx, wi.projectId);
      return { sla: await slaService.getSla(wi.id) };
    },
  },
  {
    name: "approval.list",
    description: "列出工作项的审批记录（含待审批）。",
    kind: "read",
    inputSchema: { type: "object", properties: { workItemId: UUID }, required: ["workItemId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const wi = await wiService.getWorkItem(ctx.actor, String(args.workItemId));
      assertProject(ctx, wi.projectId);
      return { approvals: await approvalService.listForItem(ctx.actor, wi.id) };
    },
  },
  {
    name: "automation.listRules",
    description: "列出项目的自动化规则（含 SCHEDULE 定时规则）。",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId); assertProject(ctx, projectId);
      return { rules: await automationService.listRules(ctx.actor, projectId) };
    },
  },
  {
    name: "automation.listRuns",
    description: "列出项目自动化运行记录。",
    kind: "read",
    inputSchema: { type: "object", properties: { projectId: UUID, limit: { type: "number", minimum: 1, maximum: 200 } }, required: ["projectId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId); assertProject(ctx, projectId);
      return { runs: await automationService.listRuns(ctx.actor, projectId, { limit: Number(args.limit ?? 50) }) };
    },
  },

]);

/** 档位守卫：READ_ONLY 不能调用已注册的写工具；账号权限与项目范围继续由服务层校验。 */
export function assertToolAllowed(ctx: ToolCtx, tool: ToolDef): void {
  if (!tierAllows(ctx.token, tool.kind)) {
    throw new DomainError("FORBIDDEN", `当前令牌档位（${ctx.token.tier}）不允许该操作`, null);
  }
}

export const TOOL_NAMES = [...TOOLS, ...WRITE_TOOLS].map((t) => t.name);
