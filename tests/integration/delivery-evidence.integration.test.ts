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
it("交付证据权限、签名与API核验、重复乱序和来源失效保留真实历史", async () => {
  const result = await runNode(
    ["tests/support/delivery-evidence.ts"],
    database.env,
  );
  expect(result.stdout).toContain("delivery evidence domain passed");
});
it("真实ZIP恢复保留交付历史，安全包停用来源，完整包重包密钥，损坏数据整体拒绝", async () => {
  const result = await runNode(
    ["tests/support/delivery-restore.ts"],
    database.env,
  );
  expect(result.stdout).toContain("delivery restore passed");
});
