/** MCP 令牌范围检查所需的资源归属查询；账号可见性和写权限仍由领域服务检查。 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { approvalRequest, comment, idea, iteration, milestone, module, page, release, workItem } from "../../db/schema.ts";

export type McpResourceKind = "workItem" | "page" | "idea" | "milestone" | "iteration" | "release" | "module" | "comment" | "approval";

export async function projectForMcpResource(kind: McpResourceKind, id: string): Promise<string | null> {
  if (kind === "comment") {
    const [row] = await db.select({ targetType: comment.targetType, targetId: comment.targetId }).from(comment).where(eq(comment.id, id)).limit(1);
    if (!row) return null;
    const targetKind = { WORK_ITEM: "workItem", PAGE: "page", MILESTONE: "milestone" }[row.targetType] as McpResourceKind | undefined;
    return targetKind ? projectForMcpResource(targetKind, row.targetId) : null;
  }
  if (kind === "approval") {
    const [row] = await db.select({ projectId: workItem.projectId }).from(approvalRequest)
      .innerJoin(workItem, eq(workItem.id, approvalRequest.workItemId)).where(eq(approvalRequest.id, id)).limit(1);
    return row?.projectId ?? null;
  }
  const table = { workItem, page, idea, milestone, iteration, release, module }[kind];
  const [row] = await db.select({ projectId: table.projectId }).from(table).where(eq(table.id, id)).limit(1);
  return row?.projectId ?? null;
}
