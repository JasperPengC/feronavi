import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("缺少应用装配时在写入前失败，避免创建后报错留下半成品", async () => {
  const result = await runNode(["tests/integration/bootstrap-integrity.fixture.ts"], database.env);
  expect(result.stdout).toContain("bootstrap integrity passed");
});
