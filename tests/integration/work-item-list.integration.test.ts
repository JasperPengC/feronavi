import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";

let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });

it("真实 HTTP 工作项列表遵守授权、分页、筛选、排序和跨入口搜索投影契约", async () => {
  const { stdout } = await runNode(["tests/integration/work-item-list.fixture.ts"], database.env);
  expect(stdout).toContain("work item list HTTP contracts passed");
});
