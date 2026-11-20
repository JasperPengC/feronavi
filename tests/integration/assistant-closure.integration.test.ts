import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("项目助手完成文档恢复、结转、依赖、想法、协作、进展及工时闭环", async () => {
  const { stdout } = await runNode(["tests/integration/assistant-closure.fixture.ts"], database.env);
  expect(stdout).toContain("assistant closure contracts passed");
});
