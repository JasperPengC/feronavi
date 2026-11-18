import assert from "node:assert/strict";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { job } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const queue = await import("../../src/server/services/job.service.ts");
try {
  await queue.enqueue({ kind: "ownership", maxAttempts: 3 });
  const [oldClaim] = await queue.claimBatch("old-worker", 1);
  await db.update(job).set({ lockedAt: new Date(Date.now() - 660_000) }).where(eq(job.id, oldClaim!.id));
  await queue.recoverStalled();
  const [newClaim] = await queue.claimBatch("new-worker", 1);
  await queue.markSucceeded(oldClaim!.id, oldClaim);
  assert.equal((await db.select().from(job).where(eq(job.id, oldClaim!.id)))[0]!.status, "RUNNING", "旧租约不能完成新任务");
  await queue.markFailed(oldClaim!.id, "stale failure", oldClaim);
  assert.equal((await db.select().from(job).where(eq(job.id, oldClaim!.id)))[0]!.lockedBy, "new-worker");
  await queue.markSucceeded(newClaim!.id, newClaim);
  assert.equal((await db.select().from(job).where(eq(job.id, oldClaim!.id)))[0]!.status, "SUCCEEDED");
  await queue.enqueue({ kind: "ownership", maxAttempts: 1 });
  const [lastClaim] = await queue.claimBatch("crashed-worker", 1);
  await db.update(job).set({ lockedAt: new Date(Date.now() - 660_000) }).where(eq(job.id, lastClaim!.id));
  await queue.recoverStalled();
  assert.equal((await db.select().from(job).where(eq(job.id, lastClaim!.id)))[0]!.status, "DEAD");
  assert.equal((await queue.claimBatch("retry-worker", 1)).length, 0);
  console.log("job ownership passed");
} finally { await sql.end({ timeout: 2 }); }
