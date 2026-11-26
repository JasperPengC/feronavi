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
it("需求变更固定基线、评审、影响与确认，拒绝过期和越权并保持事务原子性", async () => {
  const result = await runNode(
    ["tests/support/requirement-changes.ts"],
    database.env,
  );
  expect(result.stdout).toContain("requirement changes contracts passed");
});
it("需求变更真实 ZIP 新旧恢复保留历史和确认，拒绝篡改记录", async () => {
  const result = await runNode(
    ["tests/support/requirement-changes-restore.ts"],
    database.env,
  );
  expect(result.stdout).toContain("requirement changes restore passed");
});
