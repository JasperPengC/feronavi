import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";

let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });

it("看板筛选与未排期列表的总数和分页覆盖完整匹配集合", async () => {
  const { stdout } = await runNode(["tests/support/planning-queries.ts"], database.env);
  expect(stdout).toContain("planning query contracts passed");
});
