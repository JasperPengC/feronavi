import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as workItems from "./work-item.service.ts";
import * as comments from "./comment.service.ts";
import * as planning from "./planning.service.ts";
import * as approvals from "./approval.service.ts";
import * as automations from "./automation.service.ts";
import * as rooms from "./collab-room.persistence.ts";
import { requireUserConfirmation } from "./collab-room.service.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { publishRoomEvent } from "./collab-document.service.ts";
import { z } from "zod";
import { COLLAB_COMMANDS, PLAN_COMMANDS, WRITE_ACTIONS } from "../../shared/collab-commands.ts";
import { createMilestoneSchema, createIterationSchema, createReleaseSchema, createModuleSchema } from "../../shared/schemas/planning.ts";
import * as lifecycle from "./planning-lifecycle.service.ts";

type CommandResource = "WORK_ITEM" | "COMMENT" | "PLAN" | "APPROVAL" | "AUTOMATION";
type CommandInput = Record<string, unknown>;

export { COLLAB_COMMANDS, WRITE_ACTIONS };

async function executePlanCommand(actor: Actor, projectId: string, resourceId: string, action: string, input: CommandInput) {
  const { kind, operation } = PLAN_COMMANDS[action]!;
  if (operation === "create") {
    const schema = { milestone: createMilestoneSchema, iteration: createIterationSchema, release: createReleaseSchema, module: createModuleSchema }[kind];
    const parsed = schema.strict().safeParse(input);
    if (!parsed.success) throw new DomainError("VALIDATION", "计划创建参数不合法", parsed.error.issues);
    return planning.createPlan(actor, projectId, kind, parsed.data);
  }
  // 计划类型和写入目标来自命令名及当前房间；input 不接受替代资源 ID。
  const current = await planning.get(actor, resourceId, kind);
  if (current.projectId !== projectId) throw new DomainError("VALIDATION", "计划与协作房间项目不匹配", null);
  if (operation === "update") return planning.updatePlan(actor, resourceId, kind, input);
  const schema = operation === "complete" && kind === "iteration"
    ? z.object({ targetIterationId: z.string().uuid().optional() }).strict() : z.object({}).strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "计划生命周期参数不合法", parsed.error.issues);
  if (kind === "iteration" || kind === "release") {
    return operation === "complete" ? lifecycle.complete(actor, resourceId, kind, parsed.data)
      : lifecycle.setArchived(actor, resourceId, kind, operation === "archive");
  }
  if (operation === "archive") await planning.archive(actor, resourceId, kind);
  else await planning.unarchive(actor, resourceId, kind);
  return planning.get(actor, resourceId, kind);
}

function stringArg(input: CommandInput, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new DomainError("VALIDATION", `${key} 必须是非空字符串`, null);
  return value;
}

function numberArg(input: CommandInput, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError("VALIDATION", `${key} 必须是有限数字`, null);
  }
  return value;
}

function assertResource(resourceType: string): asserts resourceType is CommandResource {
  if (!["WORK_ITEM", "COMMENT", "PLAN", "APPROVAL", "AUTOMATION"].includes(resourceType)) {
    throw new DomainError("VALIDATION", "该资源类型不支持命令协作", null);
  }
}

export async function executeCommand(actor: Actor, resourceType: string, resourceId: string, action: string, input: CommandInput, userConfirmed = false) {
  assertResource(resourceType);
  const room = await rooms.getRoom(actor, resourceType, resourceId);
  if (room.mode !== "COMMAND") throw new DomainError("VALIDATION", "该协作房间不支持领域命令", null);
  if (!(COLLAB_COMMANDS[resourceType] as readonly string[]).includes(action)) throw new DomainError("VALIDATION", "命令与资源类型不匹配或不支持", { action });
  requireUserConfirmation(userConfirmed);

  let result: unknown;
  if (resourceType === "PLAN") result = await executePlanCommand(actor, room.projectId, resourceId, action, input);
  else switch (action) {
    case "workitem.update": {
      if (resourceType !== "WORK_ITEM") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      const { expectedVersion, ...patch } = input;
      if (typeof expectedVersion !== "number") throw new DomainError("VALIDATION", "expectedVersion 必填", null);
      result = await workItems.updateWorkItem(actor, resourceId, { ...patch, version: numberArg({ expectedVersion }, "expectedVersion") } as never);
      break;
    }
    case "workitem.transition": {
      if (resourceType !== "WORK_ITEM") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      const fields = z.record(z.string(), z.unknown()).optional().safeParse(input.fields);
      if (!fields.success) throw new DomainError("VALIDATION", "流转字段必须是对象", fields.error.issues);
      try {
        result = await workItems.transitionWorkItem(actor, resourceId, {
          toStateKey: stringArg(input, "toStateKey"), version: numberArg(input, "version"), comment: input.comment as string | undefined, fields: fields.data,
        } as never);
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "BLOCKED_BY_PREREQUISITE") throw error;
        const details = z.object({ approvalId: z.string().uuid() }).safeParse(error.details);
        if (!details.success) throw error;
        const pending = (await approvals.listForItem(actor, resourceId)).find(row => row.id === details.data.approvalId && row.status === "PENDING");
        if (!pending) throw error;
        // 申请已成功落库；作为命令结果提交，避免幂等事务把审批申请与审计一起回滚。
        result = { status: "PENDING_APPROVAL", approvalId: pending.id, workItemId: resourceId };
      }
      break;
    }
    case "workitem.assign": {
      if (resourceType !== "WORK_ITEM") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      const current = await workItems.getWorkItem(actor, resourceId);
      result = await workItems.updateWorkItem(actor, resourceId, { version: current.version, assigneeId: (input.assigneeId as string | null) ?? null });
      break;
    }
    case "workitem.comment": {
      if (resourceType !== "WORK_ITEM") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      result = await comments.createComment(actor, { targetType: "WORK_ITEM", targetId: resourceId, body: stringArg(input, "body"), parentId: (input.parentId as string | undefined) ?? null } as never);
      break;
    }
    case "comment.update":
      if (resourceType !== "COMMENT") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      result = await comments.updateComment(actor, resourceId, stringArg(input, "body"));
      break;
    case "comment.delete":
      if (resourceType !== "COMMENT") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      await comments.deleteComment(actor, resourceId);
      result = { ok: true };
      break;
    case "approval.approve":
    case "approval.reject":
      if (resourceType !== "APPROVAL") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      result = await approvals.decide(actor, resourceId, action.endsWith("approve") ? "approve" : "reject", input.comment as string | undefined);
      break;
    case "automation.createRule":
      if (resourceType !== "AUTOMATION") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      result = await automations.createRule(actor, room.projectId, input);
      break;
    case "automation.updateRule":
      result = await automations.updateRule(actor, room.projectId, resourceId, input);
      break;
    case "automation.disableRule":
    case "automation.deleteRule":
    case "automation.dryRun": {
      const schema = action === "automation.dryRun" ? z.object({ workItemId: z.string().uuid() }).strict() : z.object({}).strict();
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw new DomainError("VALIDATION", "自动化命令参数不合法", parsed.error.issues);
      const rule = (await automations.listRules(actor, room.projectId)).find(rule => rule.id === resourceId);
      if (!rule) throw new DomainError("NOT_FOUND", "规则不存在", null);
      result = action === "automation.dryRun" ? await automations.testRule(actor, room.projectId, rule, stringArg(input, "workItemId"))
        : action === "automation.disableRule" ? await automations.updateRule(actor, room.projectId, resourceId, { enabled: false })
          : await automations.deleteRule(actor, room.projectId, resourceId);
      break;
    }
    default:
      throw new DomainError("VALIDATION", "不支持的协作命令", { action });
  }

  await recordBusinessEvent({
    actor, action: `collab.command.${action}`, targetType: resourceType, targetId: resourceId, projectId: room.projectId,
    summary: `${actor.name} 执行了协作命令 ${action}`,
  });
  await publishRoomEvent(room.id, "collab.command.completed", { roomId: room.id, resourceType, resourceId, action });
  return result;
}
