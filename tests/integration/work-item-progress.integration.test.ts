import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("四类工作项HTTP与MCP共用进展、幂等、可见性和编辑权限", async () => {
  const { stdout } = await runNode(["tests/support/work-item-progress.ts"], database.env);
  expect(stdout).toContain("work item progress contracts passed");
});
