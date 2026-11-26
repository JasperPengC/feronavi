import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("需求正常验收可完成，旧默认流程安全迁移，自定义状态和审批保持不变", async () => {
  const result = await runNode(["tests/support/requirement-terminal.ts"], database.env);
  expect(result.stdout).toContain("requirement terminal migration passed");
});
