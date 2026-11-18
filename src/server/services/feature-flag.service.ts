/**
 * 功能开关（规范 8.3 / REST 11 节）
 *
 * 纪律：
 *   1 只有 `setting:manage` 可读写；
 *   2 key 是稳定标识（小写字母开头，允许字母/数字/点/下划线/连字符，≤100），不做"任意字符串"；
 *   3 写操作落 SECURITY 审计（开关会改变系统行为，必须可追责）；
 *   4 **如实登记**：当前没有内置业务消费者 —— 本模块不拿它给已上线功能做隐形开关。
 */
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { featureFlag } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";

const KEY_RE = /^[a-z][a-z0-9._-]{1,99}$/;

function assertManage(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

export async function listFeatureFlags(actor: Actor) {
  assertManage(actor);
  return db.select().from(featureFlag).orderBy(asc(featureFlag.key));
}

export async function setFeatureFlag(actor: Actor, key: string, input: { enabled: boolean; config?: Record<string, unknown> }) {
  assertManage(actor);
  if (!KEY_RE.test(key)) {
    throw new DomainError("VALIDATION", "开关 key 需以小写字母开头，仅含字母/数字/点/下划线/连字符，长度 2–100", null);
  }
  const [row] = await db.insert(featureFlag).values({
    key, enabled: input.enabled, config: (input.config ?? {}) as object,
  }).onConflictDoUpdate({
    target: featureFlag.key,
    set: {
      enabled: input.enabled,
      ...(input.config !== undefined ? { config: input.config as object } : {}),
    },
  }).returning();
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      // target_id 是 uuid 列，开关 key 是 text → 放 changes（白名单内的 flagKey），targetId 留空
      action: "feature_flag.updated", targetType: "FEATURE_FLAG", targetId: null,
      changes: { flagKey: key },
    });
  }
  return row!;
}

/** 供未来消费者读取（当前无内置消费者）：未配置 = false */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const row = (await db.select({ enabled: featureFlag.enabled }).from(featureFlag).where(eq(featureFlag.key, key)).limit(1))[0];
  return row?.enabled ?? false;
}
