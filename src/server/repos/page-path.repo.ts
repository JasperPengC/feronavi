import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { page } from "../../db/schema.ts";
import type { SQL } from "drizzle-orm";
import { pageActive } from "./page-state.ts";

/** 路径由当前可见目录计算，不写入正文向量；隐藏祖先处截断。 */
export async function visibleDocumentPaths(projectIds: string[], visible: SQL, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.execute<{ id: string; title: string; parentId: string | null; projectId: string }>(sql`
    with recursive ancestors as (
      select id, parent_id, project_id from page where ${inArray(page.id, ids)}
      union
      select p.id, p.parent_id, p.project_id from page p join ancestors a on p.id = a.parent_id and p.project_id = a.project_id
    )
    select page.id, page.title, page.parent_id as "parentId", page.project_id as "projectId"
    from page join ancestors on ancestors.id = page.id
    where ${and(inArray(page.projectId, projectIds), isNull(page.deletedAt), pageActive(), visible)}
  `);
  const nodes = new Map(rows.map(row => [row.id, row]));
  const result = new Map<string, string>();
  for (const id of ids) {
    const node = nodes.get(id);
    if (!node) continue;
    const parts: string[] = [], seen = new Set([id]);
    let parent = node.parentId ? nodes.get(node.parentId) : undefined;
    while (parent && parent.projectId === node.projectId && !seen.has(parent.id)) {
      parts.unshift(parent.title); seen.add(parent.id);
      parent = parent.parentId ? nodes.get(parent.parentId) : undefined;
    }
    result.set(id, parts.join(" / "));
  }
  return result;
}
