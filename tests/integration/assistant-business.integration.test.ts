import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("助手计划、文档、评论建议经过拒绝/指纹/授权/幂等和历史ACL复检", async () => {
  const { stdout } = await runNode(["tests/integration/assistant-business.fixture.ts"], database.env);
  expect(stdout).toContain("assistant business confirmation contracts passed");
});
