/**
 * 业务事件记录（审计 + 活动时间线）
 *
 * 为什么单独抽一个：`audit_entry` 与 `activity_entry` 的写入此前分散在各服务里（工作项两处、想法一处），
 * 新增事件时容易漏写/写错 severity。这里统一入口：
 *   · 审计失败、活动写失败都**不阻断主操作**（与既有 writeAudit 纪律一致）；
 *   · activity 的 summary 是**预渲染文案**（前端不拼装，见 audit.service 注释）。
 */
import type { Actor } from "../permission/actor.ts";
import { businessInvalidation, type ResourceInvalidation } from "../../shared/resource-events.ts";
import { publish } from "./events.service.ts";

export interface BusinessEventInput {
  actor: Actor;
  action: string;
  targetType: string;
  targetId?: string | null;
  /** 活动时间线的项目归属；平台级事件传 null */
  projectId?: string | null;
  /** 预渲染摘要；不传则只写审计、不写活动 */
  summary?: string;
  changes?: unknown;
  severity?: "SECURITY" | "BUSINESS";
  /** 附件等子资源使用其受权限保护的父资源作为缓存定位。 */
  invalidation?: Pick<ResourceInvalidation, "domain" | "resourceType" | "resourceId">;
}

export async function recordBusinessEvent(input: BusinessEventInput): Promise<void> {
  const invalidation = businessInvalidation(input);
  if (invalidation) await publish("resource.invalidated", { ...invalidation }, null, invalidation).catch(() => {});
  try {
    const { writeAudit, writeActivity } = await import("./audit.service.ts");
    await writeAudit({
      actorId: input.actor.memberId,
      actorSnapshot: input.actor.username,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      changes: input.changes,
      severity: input.severity ?? "BUSINESS",
    });
    if (input.summary) {
      await writeActivity({
        projectId: input.projectId ?? null,
        actorId: input.actor.memberId,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        action: input.action,
        summary: input.summary,
      });
    }
  } catch (e) {
    console.error("[event-log] 记录失败（不阻断主操作）:", (e as Error).message);
  }
}
