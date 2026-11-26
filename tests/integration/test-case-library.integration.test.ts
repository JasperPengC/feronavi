import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createIsolatedDatabase,
  prepareDatabase,
  runNode,
  type IsolatedDatabase,
} from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeEach(async () => {
  database = await createIsolatedDatabase();
  await prepareDatabase(database);
});
afterEach(async () => {
  await database?.cleanup();
});
it("正式用例版本、套件、固定需求关联和变更影响遵循权限与并发", async () => {
  const result = await runNode(
    ["tests/support/test-case-library.ts"],
    database.env,
  );
  expect(result.stdout).toContain("test case library passed");
});

it("用例库真实 ZIP 新旧恢复保留版本，拒绝损坏快照", async () => {
  const result = await runNode(
    ["tests/support/test-case-library-restore.ts"],
    database.env,
  );
  expect(result.stdout).toContain("test case library restore passed");
});
