/** 工作区事件的只读权限投影，与发布总线隔离。 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { dashboard, focusSession, ragConversation, savedView, timeBlock, todo } from "../../db/schema.ts";
import { parseWorkspaceInvalidation } from "../../shared/resource-events.ts";
import { loadActor } from "../auth/actor-loader.ts";
import { can } from "../permission/engine.ts";
import * as projects from "../repos/project.repo.ts";
import type { SseEvent } from "./events.service.ts";

export async function canDeliverWorkspaceEvent(memberId: string, event: SseEvent): Promise<boolean> {
  if (event.memberId !== memberId) return false;
  const data = parseWorkspaceInvalidation(event.data);
  if (!data) return false;
  const actor = await loadActor(memberId);
  if (!actor) return false;
  if (data.projectId && (!await projects.findById(data.projectId) || !await projects.isVisibleTo(memberId, data.projectId, actor.grants.some(grant => grant.scopeType === "ORG")))) return false;
  if (data.domain === "todo") {
    const [row] = await db.select({ ownerId: todo.memberId }).from(todo).where(eq(todo.id, data.resourceId)).limit(1);
    return !row || row.ownerId === memberId;
  }
  if (data.domain === "ragConversation") {
    const [row] = await db.select({ ownerId: ragConversation.ownerId }).from(ragConversation).where(eq(ragConversation.id, data.resourceId)).limit(1);
    return !!row && row.ownerId === memberId;
  }
  if (data.domain === "focus") {
    const table = data.resourceType === "FOCUS_SESSION" ? focusSession : timeBlock;
    const [row] = await db.select({ ownerId: table.memberId }).from(table).where(eq(table.id, data.resourceId)).limit(1);
    return !row || row.ownerId === memberId;
  }
  if (data.domain === "savedView") {
    const [row] = await db.select({ ownerId: savedView.ownerId, projectId: savedView.projectId, scope: savedView.scope }).from(savedView).where(eq(savedView.id, data.resourceId)).limit(1);
    if (row) return row.projectId === data.projectId && (row.ownerId === memberId || row.scope === "PROJECT_SHARED" && !!row.projectId);
    return true; // 删除事件已在写入时绑定真实所有者/项目，补取仍先检查当前项目权限。
  }
  if (data.domain === "dashboard") {
    const [row] = await db.select({ projectId: dashboard.projectId }).from(dashboard).where(eq(dashboard.id, data.resourceId)).limit(1);
    return !row || row.projectId === data.projectId;
  }
  if (data.domain === "role") return can(actor, "role:manage", { projectId: null, teamId: null }, { memberId, memberProjectIds: new Set(), memberTeamIds: new Set() });
  if (data.domain === "projectTemplate") return can(actor, "project:create", { projectId: null, teamId: null }, { memberId, memberProjectIds: new Set(), memberTeamIds: new Set() });
  // portfolio/global dashboard/organization/directory的现有读服务允许所有已登录有效账号。
  return true;
}
