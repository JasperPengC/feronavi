/**
 * MCP 写工具（第十三期，规范 4.9 节写工具表）
 *
 * 三条纪律（与读工具一致，写工具风险更高）：
 *   1 **档位是上限不是授权**：能力 = 账号权限 ∩ 令牌档位 ∩ 项目白名单；
 *      `READ_ONLY` 档一律拒绝写；`ADMIN` 档**也不绕过账号权限**。
 *   2 **幂等键**：规范给多数写工具定的并发模型是幂等键 —— 经 `idempotency_key` 表
 *      （key + 调用者 + 工具名 三元域），同键重放原样返回首次结果，同键不同体直接 CONFLICT。
 *   3 **破坏性操作先确认**（规范护栏）：状态流转属破坏性，工具描述里写明要求调用方先确认；
 *      服务端无法替 agent"确认"，但通过返回可读的迁移边让 agent 有据可依。
 *
 * 已补齐的能力：
 *   - ~~plan.create*~~ **已补齐（第 17 轮）**：创建逻辑已抽进 `planning.service.createPlan`，
 *     路由也改为调它 —— 抽取同时修掉一个**授权缺口**（内联实现只检查项目存在、**没有任何权限判定**，
 *     任何能看到该项目的人都能建里程碑/迭代/版本/模块）。
 *   - ~~announcement.send / announcement.revoke~~ **已补齐（第 39 轮）**：`announcement` 表落地（规范 8.5），
 *     护栏按"最高风险操作"配置 —— **需 `notification:send` 权限 ∩ ADMIN 档**，扇出有上限并如实记录投递人数，
 *     **撤回仅限发送人本人**。
 *   - ~~notification.markRead / notification.setPrefs~~ **已补齐（第 31 轮）**。
 */
import { guardTools } from "./guard.ts";
import { z } from "zod";
import { mcpAutomationRuleSchema } from "../../shared/schemas/automation.ts";
import { DomainError } from "../../shared/errors.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { withIdempotency } from "../services/idempotency.service.ts";
import * as wiService from "../services/work-item.service.ts";
import * as commentService from "../services/comment.service.ts";
import * as ideaService from "../services/idea.service.ts";
import * as wikiService from "../services/wiki.service.ts";
import * as planningService from "../services/planning.service.ts";
import * as notifService from "../services/notification.service.ts";
import * as announcementService from "../services/announcement.service.ts";
import * as relationService from "../services/relation.service.ts";
import { projectAllowed } from "../services/token.service.ts";
import * as slaService from "../services/sla.service.ts";
import * as approvalService from "../services/approval.service.ts";
import * as automationService from "../services/automation.service.ts";
import * as collabRooms from "../services/collab-room.persistence.ts";
import * as collabDocuments from "../services/collab-document.service.ts";
import { createContentUpdate } from "../services/collab-document-core.ts";
import { requireUserConfirmation } from "../services/collab-room.service.ts";
import * as collabCommands from "../services/collab-command.service.ts";

const UUID = { type: "string", format: "uuid" } as const;
const UUID_OR_NULL = { anyOf: [UUID, { type: "null" }] } as const;
const str = (description: string) => ({ type: "string", description }) as const;

/** 账号权限判定（写工具必须逐条声明所需权限，不允许"档位对了就放行"） */
function assertPerm(ctx: ToolCtx, action: string, projectId: string | null, createdBy?: string | null) {
  const pctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: ctx.actor.memberId };
  if (!can(ctx.actor, action, { projectId, teamId: null, createdBy: createdBy ?? null }, pctx)) {
    throw new DomainError("FORBIDDEN", `账号缺少权限：${action}`, { action });
  }
}

/** 幂等包装：工具名即幂等 scope（规范：同一 key 在不同工具互不干扰） */
async function idem<T>(ctx: ToolCtx, toolName: string, args: Record<string, unknown>, fn: () => Promise<T>) {
  const key = (args.idempotencyKey as string | undefined) ?? null;
  const r = await withIdempotency({ actorId: ctx.actor.memberId, key, scope: toolName, body: args }, fn);
  return r.replayed ? { replayed: true, result: r.value } : { replayed: false, result: r.value };
}

const IDEM_PROP = { idempotencyKey: str("幂等键（可选）：同一 key 重试会原样返回首次结果，不会重复创建") };

const WRITE_TOOLS_BASE: ToolDef[] = [
  {
    name: "collab.command",
    description: "在工作项、评论、计划、审批或自动化协作房间执行领域命令。写命令必须 userConfirmed=true，业务权限、审计和房间事件由同一领域服务处理。支持幂等键。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        resourceType: { type: "string", enum: ["WORK_ITEM", "COMMENT", "PLAN", "APPROVAL", "AUTOMATION"] },
        resourceId: UUID,
        action: str("领域命令名"),
        input: { type: "object", additionalProperties: true },
        userConfirmed: { type: "boolean" },
        ...IDEM_PROP,
      },
      required: ["resourceType", "resourceId", "action", "userConfirmed"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const resourceType = String(args.resourceType);
      const resourceId = String(args.resourceId);
      const room = await collabRooms.getRoom(ctx.actor, resourceType, resourceId);
      if (!projectAllowed(ctx.token, room.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      return idem(ctx, "collab.command", args, () => collabCommands.executeCommand(
        ctx.actor, resourceType, resourceId, String(args.action), (args.input ?? {}) as Record<string, unknown>, args.userConfirmed === true,
      ));
    },
  },
  {
    name: "collab.update",
    description: "向页面协作房间追加一个 Yjs update。update 只进入协作日志，不会绕过页面权限或直接发布；可安全重试。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        pageId: UUID,
        clientId: str("协作客户端标识"),
        operationId: str("幂等操作标识"),
        updateBase64: str("Yjs update 的 base64 编码"),
      },
      required: ["pageId", "clientId", "operationId", "updateBase64"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const pageId = String(args.pageId);
      const room = await collabRooms.getRoom(ctx.actor, "PAGE", pageId);
      if (!projectAllowed(ctx.token, room.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      if (!(await collabRooms.canWriteRoom(ctx.actor, room))) throw new DomainError("FORBIDDEN", "没有页面写权限", null);
      const clientId = String(args.clientId);
      await collabRooms.joinRoom(ctx.actor, "PAGE", pageId, clientId);
      return collabDocuments.applyUpdate({
        roomId: room.id, actorId: ctx.actor.memberId, clientId,
        operationId: String(args.operationId), updateBase64: String(args.updateBase64),
      });
    },
  },
  {
    name: "collab.publishPage",
    description: "发布页面协作草稿。必须先取得用户明确确认并传 userConfirmed=true；同时提供当前已发布 revision 作为 CAS 基线。冲突时不会覆盖他人修改。支持幂等键。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { pageId: UUID, title: str("可选的新标题"), expectedRevisionId: UUID, changeSummary: str("变更说明"), userConfirmed: { type: "boolean", description: "用户已明确确认本次发布" }, ...IDEM_PROP },
      required: ["pageId", "expectedRevisionId", "userConfirmed"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const pageId = String(args.pageId);
      const room = await collabRooms.getRoom(ctx.actor, "PAGE", pageId);
      if (!projectAllowed(ctx.token, room.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      if (!(await collabRooms.canWriteRoom(ctx.actor, room))) throw new DomainError("FORBIDDEN", "没有页面写权限", null);
      requireUserConfirmation(args.userConfirmed === true);
      const { pageId: _page, idempotencyKey: _key, ...input } = args;
      const { userConfirmed: _confirmed, ...publishInput } = input;
      return idem(ctx, "collab.publishPage", args, () => collabDocuments.publishPage(ctx.actor, room.id, publishInput as { expectedRevisionId: string; title?: string; changeSummary?: string }));
    },
  },
  {
    name: "workitem.create",
    description: "新建工作项。**幂等键**；返回完整行（含 key 与 id）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: UUID, type: { type: "string", enum: ["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"] },
        title: str("标题"), description: str("Markdown 正文"),
        priority: { type: "string", enum: ["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"] },
        assigneeId: UUID, dueDate: str("YYYY-MM-DD"), estimatePoints: { type: "number" },
        iterationId: UUID, milestoneId: UUID, ...IDEM_PROP,
      },
      required: ["projectId", "type", "title"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertPerm(ctx, "work_item:create", projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "workitem.create", args, () => wiService.createWorkItem(ctx.actor, projectId, input as never));
    },
  },
  {
    name: "workitem.update",
    description: "改工作项（**乐观锁**：传 expectedVersion，冲突返回 VERSION_CONFLICT）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: UUID, title: str("标题"), description: str("正文"),
        priority: { type: "string", enum: ["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"] },
        dueDate: str("YYYY-MM-DD"), expectedVersion: { type: "integer", minimum: 1, description: "乐观锁版本号" },
      },
      required: ["workItemId", "expectedVersion"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = String(args.workItemId);
      /**
       * ⚠️ 乐观锁令牌在服务层叫 `version`（patch 内的字段），MCP 对外叫 `expectedVersion`。
       * 直接把 expectedVersion 混进 patch 会被当成待更新**列**（实测报 Failed query）——
       * 工具层的职责正是做这层命名映射。
       */
      const { workItemId: _i, expectedVersion, ...patch } = args;
      return wiService.updateWorkItem(ctx.actor, id, { ...patch, version: expectedVersion } as never);
    },
  },
  {
    name: "workitem.transition",
    description: "状态流转（**破坏性**：执行前请先读 meta.workflow 并用 workitem.get 确认可用迁移边，未经用户确认不得执行）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { workItemId: UUID, toStateKey: str("目标状态 key（须来自 meta.workflow）"), version: { type: "number" }, comment: str("流转说明") },
      required: ["workItemId", "toStateKey", "version"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = String(args.workItemId);
      const wi = await wiService.getWorkItem(ctx.actor, id);
      assertPerm(ctx, "work_item:transition", wi.projectId);
      return wiService.transitionWorkItem(ctx.actor, id, {
        toStateKey: String(args.toStateKey), version: Number(args.version), comment: args.comment as string | undefined,
      } as never);
    },
  },
  {
    name: "workitem.assign",
    description: "指派工作项（幂等键）。人名请先经 project.members 取 ID。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { workItemId: UUID, assigneeId: UUID, ...IDEM_PROP },
      required: ["workItemId"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = String(args.workItemId);
      const wi = await wiService.getWorkItem(ctx.actor, id);
      assertPerm(ctx, "work_item:assign", wi.projectId);
      return idem(ctx, "workitem.assign", args, () =>
        wiService.updateWorkItem(ctx.actor, id, { version: wi.version, assigneeId: (args.assigneeId as string | null) ?? null }));
    },
  },
  {
    name: "workitem.comment",
    description: "给工作项加评论（幂等键；@提及用 @用户名）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { workItemId: UUID, body: str("评论正文"), parentId: UUID, ...IDEM_PROP },
      required: ["workItemId", "body"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = String(args.workItemId);
      const wi = await wiService.getWorkItem(ctx.actor, id);
      assertPerm(ctx, "comment:create", wi.projectId);
      return idem(ctx, "workitem.comment", args, () => commentService.createComment(ctx.actor, {
        targetType: "WORK_ITEM", targetId: id, body: String(args.body), parentId: (args.parentId as string | undefined) ?? null,
      } as never));
    },
  },
  {
    name: "workitem.link",
    description: "建立工作项关联（**天然幂等**；BLOCKED_BY 会被规范化为 BLOCKS 存储）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        fromWorkItemId: UUID, toWorkItemId: UUID,
        type: { type: "string", enum: ["BLOCKS", "BLOCKED_BY", "RELATES_TO", "DUPLICATES", "DUPLICATED_BY", "CAUSES", "CAUSED_BY"] },
      },
      required: ["fromWorkItemId", "toWorkItemId", "type"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const from = String(args.fromWorkItemId);
      const wi = await wiService.getWorkItem(ctx.actor, from);
      assertPerm(ctx, "work_item:update_any", wi.projectId);
      return relationService.addRelation(ctx.actor, from, { targetId: String(args.toWorkItemId), type: String(args.type) });
    },
  },
  {
    name: "comment.update",
    description: "改自己的评论（own 权限；含资源级归属判定）。",
    kind: "write",
    inputSchema: { type: "object", properties: { commentId: UUID, body: str("新正文") }, required: ["commentId", "body"], additionalProperties: false },
    handler: async (ctx, args) => commentService.updateComment(ctx.actor, String(args.commentId), String(args.body)),
  },
  {
    name: "comment.delete",
    description: "删评论（**破坏性**：本人或具备 delete_any；软删）。",
    kind: "write",
    inputSchema: { type: "object", properties: { commentId: UUID }, required: ["commentId"], additionalProperties: false },
    handler: async (ctx, args) => {
      await commentService.deleteComment(ctx.actor, String(args.commentId));
      return { ok: true };
    },
  },
  {
    name: "idea.submit",
    description: "提交想法（幂等键）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { projectId: UUID, title: str("标题"), description: str("说明"), ...IDEM_PROP },
      required: ["projectId", "title"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertPerm(ctx, "idea:submit", projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "idea.submit", args, () => ideaService.createIdea(ctx.actor, projectId, input as never));
    },
  },
  {
    name: "idea.vote",
    description: "给想法投票（**天然幂等**：重复调用即改权重，-1 为反对票）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { ideaId: UUID, weight: { type: "number", minimum: -1, maximum: 5, description: "权重，默认 1" } },
      required: ["ideaId"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const it = await ideaService.getIdea(ctx.actor, String(args.ideaId));
      assertPerm(ctx, "idea:vote", it.projectId);
      return ideaService.vote(ctx.actor, String(args.ideaId), Number(args.weight ?? 1));
    },
  },
  {
    name: "idea.promote",
    description: "把想法转成工作项（**幂等**：已转过则返回既有工作项）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { ideaId: UUID, type: { type: "string", enum: ["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"] } },
      required: ["ideaId"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const it = await ideaService.getIdea(ctx.actor, String(args.ideaId));
      assertPerm(ctx, "idea:manage", it.projectId);
      return ideaService.promote(ctx.actor, String(args.ideaId), { type: args.type as string | undefined });
    },
  },
  {
    name: "page.create",
    description: "建文档（幂等键；slug 由标题派生，冲突会自动追加序号）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: UUID, title: str("标题"), content: str("Markdown 正文"),
        visibility: { type: "string", enum: ["PROJECT", "RESTRICTED"], description: "受限页需 page:manage_visibility" },
        parentId: UUID, ...IDEM_PROP,
      },
      required: ["projectId", "title"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      assertPerm(ctx, "page:create", projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "page.create", args, () => wikiService.createPage(ctx.actor, projectId, input as never));
    },
  },
  {
    name: "page.update",
    description: "改文档（先确认本次发布；正文通过 Yjs 协作日志写入，再按 expectedRevisionId CAS 发布；生成新版本，历史永不删除）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { pageId: UUID, title: str("标题"), content: str("正文"), expectedRevisionId: UUID_OR_NULL, changeSummary: str("变更说明"), userConfirmed: { type: "boolean", description: "用户明确确认本次页面发布" }, ...IDEM_PROP },
      required: ["pageId", "expectedRevisionId", "userConfirmed"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const pageId = String(args.pageId);
      requireUserConfirmation(args.userConfirmed === true);
      const room = await collabRooms.getOrCreateRoom(ctx.actor, "PAGE", pageId);
      if (!projectAllowed(ctx.token, room.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      if (!(await collabRooms.canWriteRoom(ctx.actor, room))) throw new DomainError("FORBIDDEN", "没有页面写权限", null);
      const expectedRevisionId = typeof args.expectedRevisionId === "string" ? args.expectedRevisionId : null;
      if (!expectedRevisionId) throw new DomainError("VERSION_CONFLICT", "页面尚未建立可用的发布基线，请先读取页面后重试", null);
      const clientId = `mcp:${ctx.token.tokenId}`;
      const operationId = String(args.idempotencyKey ?? `${clientId}:${expectedRevisionId}`);
      const title = typeof args.title === "string" ? args.title : undefined;
      const result = await idem(ctx, "page.update", args, async () => {
        const state = await collabDocuments.loadDocument(room.id);
        const delta = typeof args.content === "string" ? createContentUpdate(state.state, String(args.content)) : null;
        if (delta) {
          await collabDocuments.applyUpdate({ roomId: room.id, actorId: ctx.actor.memberId, clientId, operationId, updateBase64: Buffer.from(delta).toString("base64") });
        }
        return collabDocuments.publishPage(ctx.actor, room.id, { expectedRevisionId, title, changeSummary: typeof args.changeSummary === "string" ? args.changeSummary : "MCP 文档更新" });
      });
      return result;
    },
  },
];

const PLAN_TOOLS: ToolDef[] = [
  {
    name: "plan.createMilestone",
    description: "建里程碑（幂等键）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { projectId: UUID, name: str("名称"), dueDate: str("YYYY-MM-DD"), description: str("说明"), ...IDEM_PROP },
      required: ["projectId", "name"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "plan.createMilestone", args, () => planningService.createPlan(ctx.actor, projectId, "milestone", input));
    },
  },
  {
    name: "plan.createIteration",
    description: "建迭代（幂等键；起止日期必填 —— 燃尽图以迭代为时间轴）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: UUID, name: str("名称"),
        startDate: str("YYYY-MM-DD"), endDate: str("YYYY-MM-DD"), ...IDEM_PROP,
      },
      required: ["projectId", "name", "startDate", "endDate"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "plan.createIteration", args, () => planningService.createPlan(ctx.actor, projectId, "iteration", input));
    },
  },
  {
    name: "plan.createRelease",
    description: "建版本（幂等键）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { projectId: UUID, name: str("名称"), releaseDate: str("YYYY-MM-DD"), ...IDEM_PROP },
      required: ["projectId", "name"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "plan.createRelease", args, () => planningService.createPlan(ctx.actor, projectId, "release", input));
    },
  },
  {
    name: "plan.createModule",
    description: "建模块（幂等键；父模块必须同项目）。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { projectId: UUID, name: str("名称"), parentId: UUID, ...IDEM_PROP },
      required: ["projectId", "name"], additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "plan.createModule", args, () => planningService.createPlan(ctx.actor, projectId, "module", input));
    },
  },
];

const NOTIFICATION_TOOLS: ToolDef[] = [
  {
    name: "notification.markRead",
    description: "把自己的通知标为已读（幂等：已读再标仍返回成功）。不传 notificationId 则全部标为已读。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { notificationId: UUID },
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      // 通知天然「仅本人」：服务端按 actor 过滤，不存在越权读取他人通知的可能
      if (args.notificationId) {
        await notifService.markRead(ctx.actor, String(args.notificationId));
        return { ok: true, scope: "one", id: args.notificationId };
      }
      await notifService.markAllRead(ctx.actor);
      return { ok: true, scope: "all" };
    },
  },
  {
    name: "notification.setPrefs",
    description: "设置自己的通知偏好（分类开关 / 免打扰时段）。**只影响本人**。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        categoryPrefs: {
          type: "object",
          description: '按分类的开关，如 {"ASSIGN":{"inApp":true,"email":false}}',
          additionalProperties: { type: "object", additionalProperties: { type: "boolean" } },
        },
        dndStart: { type: "string", description: "免打扰开始，HH:MM" },
        dndEnd: { type: "string", description: "免打扰结束，HH:MM" },
        dndTimezone: { type: "string", description: "免打扰所依据的时区，如 Asia/Shanghai" },
      },
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      // 传什么改什么：省略的字段不动（避免 agent 一次调用把用户其它偏好清空）
      const patch: Record<string, unknown> = {};
      for (const k of ["categoryPrefs", "dndStart", "dndEnd", "dndTimezone"]) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      if (Object.keys(patch).length === 0) {
        throw new DomainError("VALIDATION", "没有需要修改的偏好字段", null);
      }
      return notifService.updatePreferences(ctx.actor, patch as never);
    },
  },
];

const ANNOUNCEMENT_TOOLS: ToolDef[] = [
  {
    name: "announcement.send",
    description: "群发公告（**最高风险**：一次影响全组织。执行前必须让用户明确确认标题、正文与受众范围）。需要 ADMIN 档且账号具备 notification:send。",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        title: str("公告标题"),
        body: str("公告正文（Markdown）"),
        severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"], description: "严重级别" },
        audience: {
          type: "object",
          description: "目标范围；**省略或留空 = 全员**（这最危险，务必确认）",
          properties: {
            roleKeys: { type: "array", items: { type: "string" }, description: "按角色 key 广播" },
            teamIds: { type: "array", items: { type: "string" }, description: "按团队 ID 广播" },
          },
          additionalProperties: false,
        },
        idempotencyKey: str("幂等键（可选）：群发这种操作强烈建议带上，防止重试造成二次骚扰"),
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      // 双条件：档位必须是 ADMIN（工具层），权限由服务层判（notification:send）
      if (ctx.token.tier !== "ADMIN") throw new DomainError("FORBIDDEN", "群发公告需要 ADMIN 档令牌", { requiredTier: "ADMIN" });
      const { idempotencyKey: _k, ...input } = args;
      return idem(ctx, "announcement.send", args, () => announcementService.sendAnnouncement(ctx.actor, input as never));
    },
  },
  {
    name: "announcement.revoke",
    description: "撤回公告（**仅限发送人本人**；撤回后对应通知一并清除）。",
    kind: "write",
    inputSchema: { type: "object", properties: { announcementId: UUID }, required: ["announcementId"], additionalProperties: false },
    handler: async (ctx, args) => announcementService.revokeAnnouncement(ctx.actor, String(args.announcementId)),
  },
  {
    name: "sla.pause",
    description: "暂停工作项的 SLA 时钟。需要项目更新权限。",
    kind: "write",
    inputSchema: { type: "object", properties: { workItemId: UUID, ...IDEM_PROP }, required: ["workItemId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const wi = await wiService.getWorkItem(ctx.actor, String(args.workItemId));
      assertPerm(ctx, "project:update", wi.projectId);
      return idem(ctx, "sla.pause", args, () => slaService.pauseSla(ctx.actor, wi.id));
    },
  },
  {
    name: "sla.resume",
    description: "恢复工作项的 SLA 时钟并顺延暂停时长。需要项目更新权限。",
    kind: "write",
    inputSchema: { type: "object", properties: { workItemId: UUID, ...IDEM_PROP }, required: ["workItemId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const wi = await wiService.getWorkItem(ctx.actor, String(args.workItemId));
      assertPerm(ctx, "project:update", wi.projectId);
      return idem(ctx, "sla.resume", args, () => slaService.resumeSla(ctx.actor, wi.id));
    },
  },
  {
    name: "approval.approve",
    description: "通过一条待审批请求并执行对应流转。",
    kind: "write",
    inputSchema: { type: "object", properties: { approvalId: UUID, comment: str("审批意见"), ...IDEM_PROP }, required: ["approvalId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = await approvalService.projectIdForApproval(String(args.approvalId));
      if (!projectId || !projectAllowed(ctx.token, projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      return idem(ctx, "approval.approve", args, () => approvalService.decide(ctx.actor, String(args.approvalId), "approve", args.comment ? String(args.comment) : undefined));
    },
  },
  {
    name: "approval.reject",
    description: "驳回一条待审批请求。",
    kind: "write",
    inputSchema: { type: "object", properties: { approvalId: UUID, comment: str("驳回意见"), ...IDEM_PROP }, required: ["approvalId"], additionalProperties: false },
    handler: async (ctx, args) => {
      const projectId = await approvalService.projectIdForApproval(String(args.approvalId));
      if (!projectId || !projectAllowed(ctx.token, projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      return idem(ctx, "approval.reject", args, () => approvalService.decide(ctx.actor, String(args.approvalId), "reject", args.comment ? String(args.comment) : undefined));
    },
  },
  {
    name: "automation.createRule",
    description: "创建自动化规则；trigger=SCHEDULE 时支持 scheduleCron 与 scheduleTimezone。",
    kind: "write",
    inputSchema: z.toJSONSchema(mcpAutomationRuleSchema, { target: "draft-7" }),
    handler: async (ctx, args) => {
      const projectId = String(args.projectId);
      if (!projectAllowed(ctx.token, projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      assertPerm(ctx, "project:update", projectId);
      const { projectId: _p, idempotencyKey: _k, ...input } = args;
      return idem(ctx, "automation.createRule", args, () => automationService.createRule(ctx.actor, projectId, input));
    },
  },

];

export const WRITE_TOOLS: ToolDef[] = guardTools([...WRITE_TOOLS_BASE, ...PLAN_TOOLS, ...NOTIFICATION_TOOLS, ...ANNOUNCEMENT_TOOLS]);

export const WRITE_TOOL_NAMES = WRITE_TOOLS.map((t) => t.name);
void str;
