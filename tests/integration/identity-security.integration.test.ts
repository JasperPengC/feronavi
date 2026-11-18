import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("账号停用、一次性登录材料和邀请并发的数据库契约", async () => {
  const { stdout } = await runNode(["tests/integration/identity-security.fixture.ts"], database.env);
  expect(stdout).toContain("identity security contracts passed");
});
