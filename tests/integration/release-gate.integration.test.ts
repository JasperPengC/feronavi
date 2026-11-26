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
it("发布核心强制核验冻结范围、来源、最新流水线、测试构建与部署并保留反馈", async () => {
  const result = await runNode(["tests/support/release-gate.ts"], database.env);
  expect(result.stdout).toContain("release gate passed");
});
it("发布候选、核验快照和反馈可经真实ZIP完整/安全恢复，损坏包整体拒绝", async () => {
  const result = await runNode(
    ["tests/support/release-gate-restore.ts"],
    database.env,
  );
  expect(result.stdout).toContain("release gate restore passed");
});
