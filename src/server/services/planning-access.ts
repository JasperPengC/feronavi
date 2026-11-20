/** Shared read and authorization boundary for planning and lifecycle use cases. */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { milestone, iteration, release, module } from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
/** 计划实体的统一权限动作（四实体共用 `milestone:manage` 之外的动作） */
const PERM: Record<string, string> = {
  milestone: "milestone:manage",
  iteration: "iteration:manage",
  release: "release:manage",
  module: "module:manage",
};

export type PlanKind = "milestone" | "iteration" | "release" | "module";

/** 四表行类型映射：get/list 按 kind 返回精确行，路由层可安全访问 kind 特有列 */
export type PlanRowMap = {
  milestone: typeof milestone.$inferSelect;
  iteration: typeof iteration.$inferSelect;
  release: typeof release.$inferSelect;
  module: typeof module.$inferSelect;
};
const TABLE = { milestone, iteration, release, module } as const;
function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

export async function assertProjectVisible(actor: Actor, projectId: string): Promise<void> {
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrgGrant(actor)))) throw forbidden();
}

export async function assertCanManage(actor: Actor, kind: PlanKind, projectId: string): Promise<void> {
  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  if (!can(actor, PERM[kind]!, { projectId, teamId: null }, ctx)) throw forbidden();
}

/** 详情（不可见与不存在同形） */
export async function get<K extends PlanKind>(actor: Actor, id: string, kind: K): Promise<PlanRowMap[K]> {
  // milestone 列集是四表公共列超集，本服务只用公共列 + archivedAt，故统一按其类型访问
  const t = TABLE[kind]! as typeof milestone;
  const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw forbidden();
  await assertProjectVisible(actor, row.projectId);
  return row as PlanRowMap[K];
}
