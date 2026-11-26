import { afterEach, beforeEach, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeEach(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterEach(async () => { await database?.cleanup(); });
it("Agent登记、分步确认、冲突修正、回读与即时撤权共用现有执行链", async () => {
  const result = await runNode(["tests/support/agent-execution.ts"], database.env);
  expect(result.stdout).toContain("agent execution passed");
});
it("真实ZIP恢复保留运行与修正历史，成功步骤不因幂等缓存排除而重做", async () => {
  const result = await runNode(["tests/support/agent-execution-restore.ts"], database.env);
  expect(result.stdout).toContain("agent execution restore passed");
});
