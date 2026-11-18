import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";

let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });

it("领域关系、Wiki并发版本、导入与外部提交转换保持完整性", async () => {
  const { stdout } = await runNode(["tests/integration/domain-integrity.fixture.ts"], database.env);
  expect(stdout).toContain("domain integrity contracts passed");
});
