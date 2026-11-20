import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { collabRoom, comment, page, workItem } from "../../db/schema.ts";
import { parseResourceInvalidation, type ResourceScope } from "../../shared/resource-events.ts";
import { loadActor } from "../auth/actor-loader.ts";
import { can } from "../permission/engine.ts";
import * as projects from "../repos/project.repo.ts";
import { hasAcl } from "./page-access.service.ts";
import type { SseEvent } from "./events.service.ts";
import { canDeliverWorkspaceEvent } from "./workspace-event-access.service.ts";

/** 旧工作项/评论事件也走相同可见性门，避免历史广播绕过项目与页面 ACL。 */
export async function legacyEventScope(event: string, data: Record<string, unknown>): Promise<ResourceScope | null> {
  if (event === "resource.invalidated") return parseResourceInvalidation(data);
  if (event.startsWith("collab.") && typeof data.roomId === "string") {
    const [row] = await db.select({ projectId: collabRoom.projectId, resourceType: collabRoom.resourceType, resourceId: collabRoom.resourceId }).from(collabRoom).where(eq(collabRoom.id, data.roomId)).limit(1);
    return row ?? null;
  }
  if (event.startsWith("attachment.") && typeof data.projectId === "string" && typeof data.targetType === "string" && typeof data.targetId === "string") {
    return { projectId: data.projectId, resourceType: data.targetType, resourceId: data.targetId };
  }
  if (event.startsWith("import.") && typeof data.projectId === "string" && typeof data.batchId === "string") {
    return { projectId: data.projectId, resourceType: "IMPORT_BATCH", resourceId: data.batchId };
  }
  if (event.startsWith("workitem.") && typeof data.id === "string") {
    const [row] = await db.select({ projectId: workItem.projectId }).from(workItem).where(eq(workItem.id, data.id)).limit(1);
    return row ? { projectId: row.projectId, resourceType: "WORK_ITEM", resourceId: data.id } : null;
  }
  if (event.startsWith("comment.") && typeof data.targetType === "string" && typeof data.targetId === "string") {
    const table = data.targetType === "WORK_ITEM" ? workItem : data.targetType === "PAGE" ? page : null;
    if (!table) return null;
    const [row] = await db.select({ projectId: table.projectId }).from(table).where(eq(table.id, data.targetId)).limit(1);
    return row ? { projectId: row.projectId, resourceType: data.targetType, resourceId: data.targetId } : null;
  }
  return null;
}

export function canDeliverEvent(memberId: string, event: SseEvent): boolean | Promise<boolean> {
  if (event.memberId !== null && event.memberId !== memberId) return false;
  if (event.event.startsWith("notification.")) return event.memberId === memberId;
  if (event.event === "workspace.invalidated") return canDeliverWorkspaceEvent(memberId, event);
  if (!event.scope && !/^(workitem|comment|collab|attachment|import)\./u.test(event.event) && event.event !== "resource.invalidated") return true;
  return canDeliverScopedEvent(memberId, event);
}

async function canDeliverScopedEvent(memberId: string, event: SseEvent): Promise<boolean> {
  const scope = event.scope ?? await legacyEventScope(event.event, event.data);
  if (!scope) return false;
  // 不复用连接建立时的 Actor 或 60 秒缓存：撤销权限后下一条事件立即按新授权判定。
  const actor = await loadActor(memberId);
  if (!actor || !await projects.isVisibleTo(memberId, scope.projectId, actor.grants.some((g) => g.scopeType === "ORG"))) return false;
  if (["automation", "sla"].includes(String(event.data.domain)) && !can(actor, "project:update", { projectId: scope.projectId }, {
    memberId, memberProjectIds: new Set(), memberTeamIds: new Set(),
  })) return false;
  let resourceType = scope.resourceType;
  let resourceId = scope.resourceId;
  if (resourceType === "COMMENT") {
    const [row] = await db.select({ targetType: comment.targetType, targetId: comment.targetId }).from(comment).where(eq(comment.id, resourceId)).limit(1);
    if (!row) return false;
    resourceType = row.targetType;
    resourceId = row.targetId;
  }
  if (resourceType === "PAGE") {
    const [row] = await db.select({ projectId: page.projectId, visibility: page.visibility }).from(page).where(eq(page.id, resourceId)).limit(1);
    if (!row || row.projectId !== scope.projectId) return false;
    if (row.visibility === "RESTRICTED") return hasAcl(actor, resourceId, "read");
  }
  return true;
}
