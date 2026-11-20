import type { Actor } from "../permission/actor.ts";
import type { RagProject } from "../../shared/rag.ts";
import * as projectRepo from "../repos/project.repo.ts";
/** undefined = current visible scope; explicit [] = no projects. Token boundaries normalize legacy unrestricted lists. */
export async function listRagProjects(
  actor: Actor,
  allowedProjectIds?: string[],
  includeArchived = false,
): Promise<RagProject[]> {
  const allowed =
    allowedProjectIds !== undefined ? new Set(allowedProjectIds) : null;
  const projects: RagProject[] = [];
  const pageSize = 1000;
  for (const archived of includeArchived ? [false, true] : [false])
    for (let page = 1; ; page++) {
      const result = await projectRepo.listVisible(
        actor.memberId,
        actor.grants.some((g) => g.scopeType === "ORG"),
        { page, pageSize, archived },
      );
      for (const row of result.rows) {
        if (
          (!allowed || allowed.has(String(row.id))) &&
          !projects.some((p) => p.id === String(row.id))
        )
          projects.push({
            id: String(row.id),
            key: String(row.key),
            name: String(row.name),
            archived: !!(row.archived_at ?? row.archivedAt),
          });
      }
      if (page * pageSize >= result.total || result.rows.length === 0) break;
    }
  return projects.sort(
    (a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id),
  );
}
