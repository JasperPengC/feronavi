import { z } from "zod";
import { db } from "../../db/index.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import * as projects from "../repos/project.repo.ts";
import { lockProjectTree } from "./project-tree.ts";
export type DeliveryPermission =
  "integration:manage" | "work_item:update_any" | "release:manage";
export async function readDeliveryProject(actor: Actor, projectId: string) {
  if (
    !(await projects.isVisibleTo(
      actor.memberId,
      projectId,
      actor.grants.some((g) => g.scopeType === "ORG"),
    ))
  )
    throw forbidden();
  const p = await projects.findById(projectId);
  if (!p) throw forbidden();
  return p;
}
export async function assertDeliveryWrite(
  actor: Actor,
  projectId: string,
  permission: DeliveryPermission,
) {
  const p = await readDeliveryProject(actor, projectId);
  if (
    !can(
      actor,
      permission,
      { projectId },
      {
        memberId: actor.memberId,
        memberProjectIds: new Set(),
        memberTeamIds: new Set(),
      },
    )
  )
    throw forbidden();
  if (p.archivedAt || p.lifecycleLock)
    throw new DomainError("BLOCKED_BY_PREREQUISITE", "项目已归档或锁定", null);
}
export async function withDeliveryWrite<T>(
  actor: Actor,
  projectId: string,
  permission: DeliveryPermission,
  fn: () => Promise<T>,
) {
  await assertDeliveryWrite(actor, projectId, permission);
  return db.transaction(async () => {
    await lockProjectTree(projectId);
    await assertDeliveryWrite(actor, projectId, permission);
    return fn();
  });
}
export function parseDelivery<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new DomainError("VALIDATION", "交付参数不合法", parsed.error.issues);
  return parsed.data;
}
