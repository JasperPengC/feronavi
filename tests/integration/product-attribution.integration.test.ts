import { afterEach, beforeEach, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeEach(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterEach(async () => { await database?.cleanup(); });
it("产品跨项目归属保持权限、并发版本和正文历史边界", async () => {
  const result = await runNode(["tests/support/product-attribution.ts"], database.env);
  expect(result.stdout).toContain("product attribution contracts passed");
});
it("产品备份保留跨项目归属，旧包恢复为空归属并拒绝损坏新包", async () => {
  const result = await runNode(["tests/support/product-attribution-restore.ts"], database.env);
  expect(result.stdout).toContain("product attribution restore passed");
});
