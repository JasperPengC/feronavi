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
it("测试计划固定版本，失败转缺陷与复测链不可变，报告按最新尝试统计", async () => {
  const result = await runNode(
    ["tests/support/test-execution.ts"],
    database.env,
  );
  expect(result.stdout).toContain("test execution domain passed");
});
it("真实ZIP保留执行/复测链，兼容旧包并拒绝损坏执行",async()=>{
 const result=await runNode(["tests/support/test-execution-restore.ts"],database.env);
 expect(result.stdout).toContain("test execution restore passed");
});
