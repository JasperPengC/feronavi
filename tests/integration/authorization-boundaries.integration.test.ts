import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("真实角色装载、计划 HTTP 更新和 MCP 项目/输入边界", async () => {
  const { stdout } = await runNode(["tests/integration/authorization-boundaries.fixture.ts"], database.env);
  expect(stdout).toContain("authorization boundary contracts passed");
});
