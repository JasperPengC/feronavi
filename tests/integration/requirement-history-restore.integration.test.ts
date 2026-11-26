import { expect, it } from "vitest";
import { createIsolatedDatabase, prepareDatabase, runNode } from "../support/isolated-database.ts";

it("需求历史数据集与数据库一致，新旧备份实际导入保留正文及独立版本", async () => {
  const database = await createIsolatedDatabase();
  try {
    await prepareDatabase(database);
    const { stdout } = await runNode(["tests/support/requirement-history-restore.ts"], database.env);
    expect(stdout).toContain("requirement history restore passed");
    await runNode(["scripts/e2e-system-backup-registry.ts"], database.env);
  } finally { await database.cleanup(); }
});
