import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("需求分解的HTTP/MCP摘要、父子权限、树约束与并发编辑一致", async () => {
  const { stdout } = await runNode(["tests/support/work-breakdown.ts"], database.env);
  expect(stdout).toContain("work breakdown contracts passed");
});
