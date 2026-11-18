/**
 * 更新日志（Round 67 · 对标 YouQu 的 release/changelog P2）
 *
 * 数据源是各项目 **release.notes**（用户可见更新说明）：为空的不进 changelog。
 * 可见性复用项目可见性（ORG 全量；否则 ProjectMembership + PROJECT 角色范围）。
 * 写说明走 `PATCH /api/v1/releases/:id`（release:manage），读由本服务只读聚合。
 */
import { and, desc, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { project, release } from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";

function hasOrgGrant(actor: Actor): boolean { return actor.grants.some((g) => g.scopeType === "ORG"); }

export async function changelog(actor: Actor, opts: { projectId?: string } = {}) {
  // 1) 可见项目（复用列表的可见性口径；一次取够，changelog 不是高基数页面）
  const visible = await projectRepo.listVisible(actor.memberId, hasOrgGrant(actor), { page: 1, pageSize: 500, archived: false });
  const ids = visible.rows.map((r) => String(r.id));
  if (opts.projectId) {
    if (!ids.includes(opts.projectId)) throw forbidden();
    ids.splice(0, ids.length, opts.projectId);
  }
  if (ids.length === 0) return { items: [] };
  const rows = await db.select({
    id: release.id, projectId: release.projectId, projectKey: project.key, projectName: project.name,
    name: release.name, versionTag: release.versionTag, releaseDate: release.releaseDate,
    notes: release.notes, completedAt: release.completedAt,
  }).from(release)
    .innerJoin(project, sql`${project.id} = ${release.projectId}`)
    .where(and(
      inArray(release.projectId, ids),
      isNotNull(release.notes),
      ne(release.notes, ""),
    ))
    .orderBy(sql`${release.releaseDate} desc nulls last`, desc(release.name));
  return { items: rows };
}
