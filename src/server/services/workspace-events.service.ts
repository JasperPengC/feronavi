/** 非项目聚合/个人业务只推送给明确成员；实时与重放都重新授权。 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { deferAfterCommit } from "../../db/context.ts";
import { member } from "../../db/schema.ts";
import { type WorkspaceInvalidation } from "../../shared/resource-events.ts";
import { canDeliverWorkspaceEvent } from "./workspace-event-access.service.ts";
export { canDeliverWorkspaceEvent } from "./workspace-event-access.service.ts";
import type { SseEvent } from "./events.service.ts";

export interface WorkspaceEventInput extends Omit<WorkspaceInvalidation, "projectId"> {
  projectId?: string | null;
  /** 私人数据必填实际所有者；共享数据省略后逐一筛选合法账号。 */
  memberId?: string;
}

export async function publishWorkspaceInvalidation(input: WorkspaceEventInput): Promise<void> {
  if (deferAfterCommit(() => publishNow(input))) return;
  await publishNow(input);
}
async function publishNow(input: WorkspaceEventInput): Promise<void> {
  if ((input.domain === "todo" || input.domain === "focus" || input.domain === "ragConversation" || input.domain === "savedView" && !input.projectId) && !input.memberId) throw new Error("私人失效事件必须指定实际所有者");
  const data: WorkspaceInvalidation = { domain: input.domain, projectId: input.projectId ?? null, resourceType: input.resourceType, resourceId: input.resourceId };
  const recipients = input.memberId ? [{ id: input.memberId }] : await db.select({ id: member.id }).from(member).where(and(eq(member.status, "ACTIVE"), isNull(member.anonymizedAt)));
  const { publish } = await import("./events.service.ts");
  for (const recipient of recipients) {
    const event: SseEvent = { id: 0, event: "workspace.invalidated", data: { ...data }, memberId: recipient.id };
    if (await canDeliverWorkspaceEvent(recipient.id, event)) await publish(event.event, event.data, recipient.id);
  }
}
