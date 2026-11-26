import { afterAll, beforeAll, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterAll(async () => { await database?.cleanup(); });
it("所有文档发布入口拒绝本地链接且没有部分写入", async () => {
  const { stdout } = await runNode(["tests/support/document-links.ts"], database.env);
  expect(stdout).toContain("document link contracts passed");
});
