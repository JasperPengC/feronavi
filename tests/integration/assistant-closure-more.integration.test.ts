import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("项目助手确认剩余业务闭环并拒绝角色撤销与集合冲突", async () => {
  const { stdout } = await runNode(["tests/integration/assistant-closure-more.fixture.ts"], database.env);
  expect(stdout).toContain("assistant remaining closure contracts passed");
});
