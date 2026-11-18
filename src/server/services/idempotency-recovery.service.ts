/** 仅供具有服务器访问权的运维 CLI 使用；旧不明请求必须人工核对业务结果。 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, inTransaction } from "../../db/index.ts";
import { auditEntry, idempotencyKey } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";

const identitySchema = z.object({ actorId: z.string().uuid(), scope: z.string().min(1).max(200), key: z.string().min(1).max(1000) });
type Identity = z.infer<typeof identitySchema>;
const recoverySchema = identitySchema.extend({
  expectedRequestHash: z.string().regex(/^[a-f0-9]{64}$/u), operatorId: z.string().uuid(), evidence: z.string().trim().min(1).max(2000),
});
type Recovery = z.infer<typeof recoverySchema> & ({ resolution: "ROLLED_BACK" } | { resolution: "COMMITTED"; response: unknown });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const predicate = (input: Identity) => and(eq(idempotencyKey.actorId, input.actorId), eq(idempotencyKey.scope, input.scope), eq(idempotencyKey.key, input.key));

/** 默认只读检查；不暴露请求 key 或已保存的业务响应。 */
export async function inspectIdempotency(input: Identity) {
  const identity = identitySchema.parse(input);
  const row = (await db.select().from(idempotencyKey).where(predicate(identity)).limit(1))[0];
  if (!row) return null;
  return { actorId: row.actorId, scope: row.scope, keyHash: digest(row.key), requestHash: row.requestHash,
    state: row.state, responseStatus: row.responseStatus, createdAt: row.createdAt, expiresAt: row.expiresAt };
}

export async function recoverIdempotency(input: Recovery): Promise<void> {
  const identity = recoverySchema.parse(input);
  if (input.resolution !== "COMMITTED" && input.resolution !== "ROLLED_BACK") throw new DomainError("VALIDATION", "必须明确确认已提交或已回滚");
  // JSON round trip 与数据库响应存储一致；undefined / BigInt 等不得被误确认成已提交。
  let response: unknown;
  if (input.resolution === "COMMITTED") {
    try { response = JSON.parse(JSON.stringify(input.response)); }
    catch { throw new DomainError("VALIDATION", "已提交恢复必须提供有效 JSON 响应"); }
  }
  await inTransaction(async () => {
    const locks = await db.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${JSON.stringify([identity.actorId, identity.scope, identity.key])}, 0)) as ok`);
    if (!(locks as unknown as { ok: boolean }[])[0]?.ok) throw new DomainError("CONFLICT", "请求仍在执行，不能恢复");
    const where = predicate(identity);
    const row = (await db.select().from(idempotencyKey).where(where).limit(1))[0];
    if (!row || row.state !== "IN_PROGRESS" || row.requestHash !== identity.expectedRequestHash) {
      throw new DomainError("CONFLICT", "记录不存在、已完成或请求摘要已变化，请重新检查");
    }
    // 专用固定结构：只写状态与不可逆摘要；证据原文由运维留在受控工单中。
    // 审计写入失败必须回滚恢复，不能使用会吞错的通用 writeAudit。
    await db.insert(auditEntry).values({
      actorId: identity.operatorId, actorSnapshot: "CLI recovery", severity: "SECURITY", targetType: "idempotency",
      action: `idempotency.recover.${input.resolution.toLowerCase()}`,
      changes: { requestHash: row.requestHash, identityHash: digest(JSON.stringify([identity.actorId, identity.scope, identity.key])),
        evidenceHash: digest(identity.evidence), resolution: input.resolution },
    });
    if (input.resolution === "ROLLED_BACK") await db.delete(idempotencyKey).where(where);
    else await db.update(idempotencyKey).set({ state: "DONE", responseStatus: 200, responseBody: response, expiresAt: new Date(Date.now() + 86_400_000) }).where(where);
  });
}
