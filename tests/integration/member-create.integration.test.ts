import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("直接创建成员的权限、输入、初始密码、角色、重复冲突和事务回滚", async () => {
  const { stdout } = await runNode(["tests/integration/member-create.fixture.ts"], database.env);
  expect(stdout).toContain("member creation contracts passed");
});
