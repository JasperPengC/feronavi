import { DomainError } from "../../shared/errors.ts";
/** SSE checks share only simultaneous work, never a settled permission cache. */
import { verifySession } from "../auth/session.ts";
import { loadActor } from "../auth/actor-loader.ts";
import {
  authenticateToken,
  projectAllowed,
  type TokenContext,
} from "./token.service.ts";
import { getWorkItem } from "./work-item.service.ts";
import { getPage } from "./wiki.service.ts";
import { get as getPlan } from "./planning.service.ts";
import { assertToolPolicyAllowed } from "./mcp-client.service.ts";
import type { Actor } from "../permission/actor.ts";
import type { SseEvent } from "./events.service.ts";
import { canDeliverEvent, legacyEventScope } from "./event-access.service.ts";
export interface EventCredential {
  memberId: string;
  sessionToken?: string;
  bearer?: string;
  ip?: string | null;
}
export interface EventIdentity {
  actor: Actor;
  token?: TokenContext;
}
const checks = new Map<string, Promise<EventIdentity>>();
export async function currentEventIdentity(
  credential: EventCredential,
): Promise<EventIdentity> {
  const key = JSON.stringify(credential);
  const existing = checks.get(key);
  if (existing) return existing;
  const pending = (async () => {
    let identity: EventIdentity;
    if (credential.bearer) {
      const value = await authenticateToken(
        credential.bearer,
        credential.ip ?? null,
      );
      if (!value)
        throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
      identity = { actor: value.actor, token: value.ctx };
    } else {
      if (!credential.sessionToken)
        throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
      const session = await verifySession(credential.sessionToken);
      if (!session || session.memberId !== credential.memberId)
        throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
      const actor = await loadActor(session.memberId);
      if (!actor)
        throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
      identity = { actor };
    }
    if (
      identity.actor.memberId !== credential.memberId ||
      identity.actor.mustChangePassword
    )
      throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return identity;
  })();
  if (checks.size < 1024) checks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (checks.get(key) === pending) checks.delete(key);
  }
}
const resourceChecks = new WeakMap<
  EventIdentity,
  Map<SseEvent, Promise<boolean>>
>();
export async function eventReadable(
  identity: EventIdentity,
  event: SseEvent,
): Promise<boolean> {
  let checks = resourceChecks.get(identity);
  if (!checks) {
    checks = new Map();
    resourceChecks.set(identity, checks);
  }
  const existing = checks.get(event);
  if (existing) return existing;
  const pending = readEventResource(identity, event);
  if (checks.size < 1024) checks.set(event, pending);
  try {
    return await pending;
  } finally {
    if (checks.get(event) === pending) checks.delete(event);
  }
}
async function readEventResource(
  identity: EventIdentity,
  event: SseEvent,
): Promise<boolean> {
  if (event.memberId !== null && event.memberId !== identity.actor.memberId)
    return false;
  if (
    event.event === "notification.new" ||
    event.event === "notification.changed"
  )
    return event.memberId === identity.actor.memberId;
  if (event.event === "presence") return true;
  let projectId: string;
  let tool: string;
  try {
    if (
      [
        "workitem.changed",
        "workitem.transitioned",
        "workitem.assigned",
      ].includes(event.event)
    ) {
      if (typeof event.data.id !== "string") return false;
      projectId = (await getWorkItem(identity.actor, event.data.id)).projectId;
      tool = "workitem.get";
    } else if (event.event === "comment.created") {
      const { targetType, targetId } = event.data;
      if (typeof targetId !== "string") return false;
      if (targetType === "WORK_ITEM") {
        projectId = (await getWorkItem(identity.actor, targetId)).projectId;
        tool = "workitem.get";
      } else if (targetType === "PAGE") {
        const page = await getPage(identity.actor, targetId);
        if (!page.projectId) return false;
        projectId = page.projectId;
        tool = "page.get";
      } else if (targetType === "MILESTONE") {
        projectId = (await getPlan(identity.actor, targetId, "milestone"))
          .projectId;
        tool = "plan.getMilestone";
      } else return false;
    } else if (event.event === "workspace.invalidated" || event.event === "resource.invalidated" || /^(collab|attachment|import)\./u.test(event.event)) {
      if (!await canDeliverEvent(identity.actor.memberId, event)) return false;
      if (!identity.token) return true;
      // 令牌只可获得授权项目的资源信号；工作区的个人/组织广播不属于项目令牌范围。
      const scope = event.scope ?? await legacyEventScope(event.event, event.data);
      if (!scope || !projectAllowed(identity.token, scope.projectId)) return false;
      const tool = scope.resourceType === "PAGE" ? "page.get" : scope.resourceType === "WORK_ITEM" ? "workitem.get" : null;
      if (!tool) return false;
      await assertToolPolicyAllowed(identity.token.tokenId, tool);
      return true;
    } else return false;
    if (identity.token) {
      if (!projectAllowed(identity.token, projectId)) return false;
      await assertToolPolicyAllowed(identity.token.tokenId, tool);
    }
    return true;
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
    )
      return false;
    throw error;
  }
}
