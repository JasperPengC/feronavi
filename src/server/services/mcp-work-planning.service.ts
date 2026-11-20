/** 工作计划补充领域入口：REST/MCP 共用容量契约与现有业务服务授权。 */
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { iterationCapacity, projectMembership } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as planning from "./planning.service.ts";
import * as workItems from "./work-item.service.ts";
import * as relations from "./relation.service.ts";
import * as issues from "./issues.service.ts";
import * as milestones from "./milestone-detail.service.ts";
import * as collaboration from "./collab.service.ts";
import * as transfers from "./work-item-transfer.service.ts";
import * as prefsTime from "./prefs-time.service.ts";

export async function iterationCapacityList(actor: Actor, iterationId: string) {
  const it = await planning.get(actor, iterationId, "iteration");
  const rows = (await db.execute(sql`
    select pm.member_id::text as member_id, m.name, m.username,
           ic.capacity_points::float8 as capacity_points,
           ic.capacity_hours::float8 as capacity_hours,
           coalesce(ic.logged_points, 0)::float8 as logged_points
    from project_membership pm join member m on m.id = pm.member_id
    left join iteration_capacity ic on ic.iteration_id = ${iterationId} and ic.member_id = pm.member_id
    where pm.project_id = ${it.projectId} order by m.name
  `)) as unknown as {
    member_id: string;
    name: string;
    username: string;
    capacity_points: number | null;
    capacity_hours: number | null;
    logged_points: number;
  }[];
  return {
    members: rows.map((r) => ({
      memberId: r.member_id,
      name: r.name,
      username: r.username,
      capacityPoints: r.capacity_points,
      capacityHours: r.capacity_hours,
      loggedPoints: r.logged_points,
    })),
  };
}

export async function setIterationCapacity(
  actor: Actor,
  iterationId: string,
  memberId: string,
  input: { capacityPoints?: number | null; capacityHours?: number | null },
) {
  const it = await planning.get(actor, iterationId, "iteration");
  const ctx: PermissionContext = {
    memberProjectIds: new Set(),
    memberTeamIds: new Set(),
    memberId: actor.memberId,
  };
  if (
    !can(
      actor,
      "iteration:manage",
      { projectId: it.projectId, teamId: null },
      ctx,
    )
  )
    throw forbidden();
  const hasPoints = input.capacityPoints != null;
  const hasHours = input.capacityHours != null;
  if (hasPoints === hasHours)
    throw new DomainError("VALIDATION", "容量点数与容量小时必须二选一", null);
  for (const [value, maximum] of [
    [input.capacityPoints, 99999],
    [input.capacityHours, 999999],
  ] as const) {
    if (
      value != null &&
      (!Number.isFinite(value) || value < 0 || value > maximum)
    )
      throw new DomainError("VALIDATION", "容量超出有效范围", null);
  }
  const members = await db
    .select({ memberId: projectMembership.memberId })
    .from(projectMembership)
    .where(eq(projectMembership.projectId, it.projectId));
  if (!members.some((m) => m.memberId === memberId))
    throw new DomainError("VALIDATION", "成员不属于该项目", null);
  const values = {
    iterationId,
    memberId,
    capacityPoints: hasPoints ? String(input.capacityPoints) : null,
    capacityHours: hasHours ? String(input.capacityHours) : null,
  };
  const [capacity] = await db
    .insert(iterationCapacity)
    .values(values)
    .onConflictDoUpdate({
      target: [iterationCapacity.iterationId, iterationCapacity.memberId],
      set: {
        capacityPoints: values.capacityPoints,
        capacityHours: values.capacityHours,
      },
    })
    .returning();
  return { ok: true, capacity };
}

export async function authorizeUnlinkRelation(
  actor: Actor,
  workItemId: string,
  relationId: string,
): Promise<void> {
  const wi = await workItems.getWorkItem(actor, workItemId);
  const ctx: PermissionContext = {
    memberProjectIds: new Set(),
    memberTeamIds: new Set(),
    memberId: actor.memberId,
  };
  if (
    !can(
      actor,
      "work_item:update_any",
      { projectId: wi.projectId, teamId: null, createdBy: wi.reporterId },
      ctx,
    )
  )
    throw forbidden();
  const view = await relations.listRelations(actor, workItemId);
  if (
    ![...view.blocks, ...view.blockedBy, ...view.others].some(
      (relation) => relation.id === relationId,
    )
  )
    throw forbidden();
}

export async function unlinkRelation(
  actor: Actor,
  workItemId: string,
  relationId: string,
): Promise<void> {
  await authorizeUnlinkRelation(actor, workItemId, relationId);
  await relations.removeRelation(actor, workItemId, relationId);
}

export async function deleteWorkItemProgress(
  actor: Actor,
  workItemId: string,
  updateId: string,
): Promise<void> {
  const updates = await issues.listProgressUpdates(actor, workItemId);
  if (!updates.some((update) => update.id === updateId)) throw forbidden();
  await issues.deleteProgressUpdate(actor, updateId);
}

export async function deleteMilestoneProgress(
  actor: Actor,
  milestoneId: string,
  updateId: string,
): Promise<void> {
  const detail = await milestones.milestoneDetail(actor, milestoneId);
  if (!detail.progressUpdates.some((update) => update.id === updateId))
    throw forbidden();
  await milestones.deleteProgressUpdate(actor, updateId);
}

/** 所有工作计划写入口在取幂等结果前重新检查当前资源与授权。 */
export async function authorizeWorkPlanningWrite(
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const planMatch =
    /^plan\.(?:update|archive|unarchive|complete)(Milestone|Iteration|Release|Module)$/.exec(
      name,
    );
  if (planMatch) {
    const kind = planMatch[1]!.toLowerCase() as planning.PlanKind;
    const current = await planning.get(actor, String(args[`${kind}Id`]), kind);
    await planning.assertPlanManagement(actor, kind, current.projectId);
    return;
  }
  if (name === "plan.setIterationCapacity") {
    const current = await planning.get(
      actor,
      String(args.iterationId),
      "iteration",
    );
    await planning.assertPlanManagement(actor, "iteration", current.projectId);
    return;
  }
  if (name === "savedView.reorder" || name === "savedView.delete") {
    const ids =
      name === "savedView.reorder"
        ? (args.savedViewIds as string[])
        : [String(args.savedViewId)];
    for (const id of ids) {
      const view = await planning.getSavedView(actor, id);
      if (view.ownerId !== actor.memberId) throw forbidden();
    }
    return;
  }
  if (name === "workitem.unlink") {
    await authorizeUnlinkRelation(
      actor,
      String(args.workItemId),
      String(args.relationId),
    );
    return;
  }
  if (name === "workitem.transfer" || name === "workitem.delete") {
    const wi =
      name === "workitem.transfer"
        ? await transfers.authorizeTransfer(actor, String(args.workItemId))
        : await prefsTime.assertTimeLogWorkItemVisible(
            actor,
            String(args.workItemId),
          );
    const ctx: PermissionContext = {
      memberProjectIds: new Set(),
      memberTeamIds: new Set(),
      memberId: actor.memberId,
    };
    const resource = {
      projectId: wi.projectId,
      teamId: null,
      createdBy: wi.reporterId,
    };
    if (name === "workitem.delete") {
      if (!can(actor, "work_item:delete", resource, ctx)) throw forbidden();
    } else if (
      !can(actor, "work_item:update_any", resource, ctx) &&
      !can(actor, "work_item:update_own", resource, ctx) &&
      !(await collaboration.isCollaborator(actor.memberId, wi.id))
    )
      throw forbidden();
    return;
  }
  if (name === "workitem.addProgressUpdate") {
    await issues.authorizeProgressCreate(actor, String(args.workItemId));
    return;
  }
  if (name === "workitem.deleteProgressUpdate") {
    const update = await issues.authorizeProgressDelete(
      actor,
      String(args.workItemProgressUpdateId),
    );
    if (update.workItemId !== args.workItemId) throw forbidden();
    return;
  }
  if (name === "plan.addMilestoneProgressUpdate") {
    await milestones.authorizeProgressCreate(actor, String(args.milestoneId));
    return;
  }
  if (name === "plan.deleteMilestoneProgressUpdate") {
    await planning.get(actor, String(args.milestoneId), "milestone");
    const update = await milestones.authorizeProgressDelete(
      actor,
      String(args.milestoneProgressUpdateId),
    );
    if (update.milestoneId !== args.milestoneId) throw forbidden();
    return;
  }
  throw new DomainError("FORBIDDEN", "工具未声明写入授权", null);
}
