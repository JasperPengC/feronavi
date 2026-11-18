import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("真实事务、同键并发、中断恢复及固定会话调度锁", async () => {
  const { stdout } = await runNode(["tests/integration/transaction-idempotency.fixture.ts"], { ...database.env, DB_POOL_MAX: "3" });
  expect(stdout).toContain("transaction idempotency contracts passed");
});
it("连接池只有一个连接时，锁任务中的 SQL、事务及提交后回调不会自锁", async () => {
  const { stdout } = await runNode(["tests/integration/transaction-idempotency.fixture.ts", "single-connection"], { ...database.env, DB_POOL_MAX: "1" });
  expect(stdout).toContain("single connection contracts passed");
});
it("单连接定时扫描隔离坏规则，释放锁前完成工作项的自动化和 SLA 后续链", async () => {
  const { stdout } = await runNode(["tests/integration/transaction-idempotency.fixture.ts", "scheduled-followups"], { ...database.env, DB_POOL_MAX: "1" });
  expect(stdout).toContain("scheduled followup contracts passed");
});
it("空库单连接池迁移与重复启动迁移不会自锁", async () => {
  const empty = await createIsolatedDatabase();
  try {
    const { stdout } = await runNode(["tests/integration/transaction-idempotency.fixture.ts", "single-connection-migration"], { ...empty.env, DB_POOL_MAX: "1" });
    expect(stdout).toContain("single connection migration contracts passed");
  } finally { await empty.cleanup(); }
});
