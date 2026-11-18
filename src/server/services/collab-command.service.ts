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

type CommandResource = "WORK_ITEM" | "COMMENT" | "PLAN" | "APPROVAL" | "AUTOMATION";
type CommandInput = Record<string, unknown>;

const WRITE_ACTIONS = new Set([
  "workitem.update", "workitem.transition", "workitem.assign", "workitem.comment",
  "comment.update", "comment.delete",
  "plan.createMilestone", "plan.createIteration", "plan.createRelease", "plan.createModule",
  "approval.approve", "approval.reject", "automation.createRule",
]);

export const COLLAB_COMMANDS = {
  WORK_ITEM: ["workitem.update", "workitem.transition", "workitem.assign", "workitem.comment"],
  COMMENT: ["comment.update", "comment.delete"],
  PLAN: ["plan.createMilestone", "plan.createIteration", "plan.createRelease", "plan.createModule"],
  APPROVAL: ["approval.approve", "approval.reject"],
  AUTOMATION: ["automation.createRule"],
} as const;

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
  if (WRITE_ACTIONS.has(action)) requireUserConfirmation(userConfirmed);

  let result: unknown;
  switch (action) {
    case "workitem.update": {
      if (resourceType !== "WORK_ITEM") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      const { expectedVersion, ...patch } = input;
      if (typeof expectedVersion !== "number") throw new DomainError("VALIDATION", "expectedVersion 必填", null);
      result = await workItems.updateWorkItem(actor, resourceId, { ...patch, version: numberArg({ expectedVersion }, "expectedVersion") } as never);
      break;
    }
    case "workitem.transition": {
      if (resourceType !== "WORK_ITEM") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      result = await workItems.transitionWorkItem(actor, resourceId, {
        toStateKey: stringArg(input, "toStateKey"), version: numberArg(input, "version"), comment: input.comment as string | undefined,
      } as never);
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
    case "plan.createMilestone":
    case "plan.createIteration":
    case "plan.createRelease":
    case "plan.createModule": {
      if (resourceType !== "PLAN") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      const kind = action.slice("plan.create".length).toLowerCase() as "milestone" | "iteration" | "release" | "module";
      result = await planning.createPlan(actor, room.projectId, kind, input);
      break;
    }
    case "approval.approve":
    case "approval.reject":
      if (resourceType !== "APPROVAL") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      result = await approvals.decide(actor, resourceId, action.endsWith("approve") ? "approve" : "reject", input.comment as string | undefined);
      break;
    case "automation.createRule":
      if (resourceType !== "AUTOMATION") throw new DomainError("VALIDATION", "命令与资源类型不匹配", null);
      result = await automations.createRule(actor, room.projectId, input);
      break;
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

export { WRITE_ACTIONS };
