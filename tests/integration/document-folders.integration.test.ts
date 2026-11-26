import { afterEach, beforeEach, expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeEach(async () => { database = await createIsolatedDatabase(); await prepareDatabase(database); });
afterEach(async () => { await database?.cleanup(); });
it("目录移动、归档继承、权限与RAG遵循同一有效文档范围", async () => {
  const { stdout } = await runNode(["tests/support/document-folders.ts"], database.env);
  expect(stdout).toContain("document folder contracts passed");
});
it("真实备份包保留目录结构，兼容旧文档并拒绝缺字段新包", async () => {
  const { stdout } = await runNode(["tests/support/document-folders-restore.ts"], database.env);
  expect(stdout).toContain("document folders restore passed");
});
