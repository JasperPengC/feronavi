import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { collabMember } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { assertDocumentUpdateAllowed, isCollabResourceType, requireUserConfirmation } from "../services/collab-room.service.ts";
import * as rooms from "../services/collab-room.persistence.ts";
import * as documents from "../services/collab-document.service.ts";
import * as commands from "../services/collab-command.service.ts";
import { COLLAB_COMMANDS } from "../../shared/collab-commands.ts";

const ACTIONS: Record<string, { read: string[]; write: string[] }> = {
  PAGE: { read: ["page.get"], write: ["collab.update", "collab.publishPage"] },
  WORK_ITEM: { read: ["workitem.get"], write: ["workitem.update", "workitem.transition", "workitem.assign", "workitem.comment"] },
  COMMENT: { read: [], write: ["comment.update", "comment.delete"] },
  PLAN: { read: ["plan.getMilestone", "plan.getIteration", "plan.getRelease", "plan.getModule"], write: [...COLLAB_COMMANDS.PLAN] },
  APPROVAL: { read: ["approval.list"], write: ["approval.approve", "approval.reject"] },
  AUTOMATION: { read: ["automation.listRules", "automation.listRuns", "automation.dryRun"], write: COLLAB_COMMANDS.AUTOMATION.filter(action => action !== "automation.dryRun") },
};
const DOMAIN_TOOLS: Record<string, string[]> = {
  WORK_ITEM: ["workitem.get", "workitem.update", "workitem.transition", "workitem.assign", "workitem.comment"],
  COMMENT: ["comment.update", "comment.delete"],
  PLAN: ["plan.getMilestone", "plan.getIteration", "plan.getRelease", "plan.getModule", ...COLLAB_COMMANDS.PLAN],
  APPROVAL: ["approval.list", "approval.approve", "approval.reject"],
  AUTOMATION: ["automation.listRules", "automation.listRuns", ...COLLAB_COMMANDS.AUTOMATION],
};

declare module "fastify" { interface FastifyRequest { actor?: Actor } }

const params = z.object({ resourceType: z.string(), resourceId: z.string().uuid() });
const actorOf = (req: { actor?: Actor }): Actor => {
  if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
  return req.actor;
};

export async function registerCollaborationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/collaboration/rooms/:resourceType/:resourceId", async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    const room = await rooms.getRoom(actor, p.resourceType, p.resourceId);
    const members = await db.select({ memberId: collabMember.memberId, clientId: collabMember.clientId, lastSeenAt: collabMember.lastSeenAt })
      .from(collabMember).where(and(eq(collabMember.roomId, room.id), eq(collabMember.connected, true)));
    return { room, members: members.filter((member) => member.lastSeenAt > new Date(Date.now() - 60_000)) };
  });

  app.post("/api/v1/collaboration/rooms/:resourceType/:resourceId/join", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    const body = z.object({ clientId: z.string().min(1).max(100) }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    const joined = await rooms.joinRoom(actor, p.resourceType, p.resourceId, body.data.clientId);
    await documents.publishRoomEvent(joined.room.id, "collab.presence", { roomId: joined.room.id });
    return joined;
  });

  app.post("/api/v1/collaboration/rooms/:resourceType/:resourceId/heartbeat", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    const body = z.object({ clientId: z.string().min(1).max(100) }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    return rooms.heartbeatRoom(actor, p.resourceType, p.resourceId, body.data.clientId);
  });

  app.post("/api/v1/collaboration/rooms/:resourceType/:resourceId/leave", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    const body = z.object({ clientId: z.string().min(1).max(100) }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    const left = await rooms.leaveRoom(actor, p.resourceType, p.resourceId, body.data.clientId);
    await documents.publishRoomEvent(left.roomId, "collab.presence", { roomId: left.roomId });
    return left;
  });

  app.get("/api/v1/collaboration/rooms/:resourceType/:resourceId/state", async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    const room = await rooms.getRoom(actor, p.resourceType, p.resourceId);
    const state = await documents.loadDocument(room.id);
    return { roomId: room.id, baseRevisionId: state.baseRevisionId, sequence: state.sequence, stateBase64: Buffer.from(state.state).toString("base64") };
  });

  app.post("/api/v1/collaboration/rooms/:resourceType/:resourceId/updates", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    if (!isCollabResourceType(p.resourceType)) throw new DomainError("VALIDATION", "不支持的协作资源类型", null);
    const room = await rooms.getRoom(actor, p.resourceType, p.resourceId);
    const body = z.object({ clientId: z.string().min(1).max(100), operationId: z.string().min(1).max(120), updateBase64: z.string() }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    const membership = (await db.select().from(collabMember).where(and(
      eq(collabMember.roomId, room.id), eq(collabMember.memberId, actor.memberId), eq(collabMember.clientId, body.data.clientId), eq(collabMember.connected, true),
    )).limit(1))[0];
    if (!membership) throw new DomainError("FORBIDDEN", "请先加入协作房间", null);
    const canWrite = await rooms.canWriteRoom(actor, room);
    try { assertDocumentUpdateAllowed(room.mode as "TEXT_CRDT" | "COMMAND", canWrite); }
    catch (error) {
      throw new DomainError(canWrite ? "VALIDATION" : "FORBIDDEN", (error as Error).message, null);
    }
    return documents.applyUpdate({ roomId: room.id, actorId: actor.memberId, ...body.data });
  });

  app.get("/api/v1/collaboration/rooms/:resourceType/:resourceId/inspect", async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    const room = await rooms.getRoom(actor, p.resourceType, p.resourceId);
    const canWrite = await rooms.canWriteRoom(actor, room);
    const state = await documents.loadDocument(room.id);
    return {
      roomId: room.id, resourceType: room.resourceType, resourceId: room.resourceId, projectId: room.projectId,
      mode: room.mode, baseRevisionId: state.baseRevisionId, sequence: state.sequence,
      canRead: true, canWrite, publishedRevisionId: room.resourceType === "PAGE" ? state.baseRevisionId : null,
      actions: room.mode === "TEXT_CRDT" ? [
        ...(ACTIONS[room.resourceType]?.read ?? []),
        ...(canWrite ? ACTIONS[room.resourceType]?.write ?? [] : []),
      ] : [],
      domainTools: DOMAIN_TOOLS[room.resourceType] ?? [],
      domainAuthorization: "每个 MCP 领域工具会重新检查账号权限、项目白名单和业务前置条件",
    };
  });

  app.post("/api/v1/collaboration/rooms/:resourceType/:resourceId/publish", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    if (p.resourceType !== "PAGE") throw new DomainError("VALIDATION", "只有页面协作房间支持发布", null);
    const room = await rooms.getRoom(actor, p.resourceType, p.resourceId);
    if (!(await rooms.canWriteRoom(actor, room))) throw new DomainError("FORBIDDEN", "没有页面写权限", null);
    const body = z.object({ title: z.string().min(1).max(300).optional(), expectedStructureVersion: z.number().int().positive().optional(), expectedRevisionId: z.string().uuid(), changeSummary: z.string().max(300).optional(), userConfirmed: z.boolean() }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    requireUserConfirmation(body.data.userConfirmed);
    return documents.publishPage(actor, room.id, body.data);
  });

  app.post("/api/v1/collaboration/rooms/:resourceType/:resourceId/commands", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const p = params.parse(req.params);
    const body = z.object({
      action: z.string().min(1).max(80),
      input: z.record(z.string(), z.unknown()).default({}),
      userConfirmed: z.boolean().default(false),
    }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    return commands.executeCommand(actor, p.resourceType, p.resourceId, body.data.action, body.data.input, body.data.userConfirmed);
  });
}
