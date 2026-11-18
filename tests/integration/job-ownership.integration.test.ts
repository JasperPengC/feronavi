import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("回收后的旧消费者不能覆盖新执行结果，耗尽重试次数的僵死任务进入死信", async () => {
  const result = await runNode(["tests/integration/job-ownership.fixture.ts"], database.env);
  expect(result.stdout).toContain("job ownership passed");
});
