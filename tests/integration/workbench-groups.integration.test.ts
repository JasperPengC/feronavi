import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";

let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });

it("工作台分组总数、分页与数据范围覆盖完整集合", async () => {
  const { stdout } = await runNode(["tests/support/workbench-groups.ts"], database.env);
  expect(stdout).toContain("workbench group contracts passed");
});
