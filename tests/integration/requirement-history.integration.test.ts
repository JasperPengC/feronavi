import { afterAll, beforeAll, expect, it } from "vitest";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createIsolatedDatabase, prepareDatabase, runNode, type IsolatedDatabase } from "../support/isolated-database.ts";

let database: IsolatedDatabase;
beforeAll(async () => {
  database = await createIsolatedDatabase();
  const oldMigrations = join(database.directory, "old-migrations");
  await cp("drizzle", oldMigrations, { recursive: true });
  const journalPath = join(oldMigrations, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx >= 76)) {
    await rm(join(oldMigrations, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 76);
  await writeFile(journalPath, JSON.stringify(journal));
  await prepareDatabase({ ...database, env: { ...database.env, MIGRATIONS_DIR: oldMigrations } });
});
afterAll(async () => { await database?.cleanup(); });

it("需求历史兼容旧数据，保存原子化且REST/MCP遵循同一权限和分页", async () => {
  const { stdout } = await runNode(["tests/support/requirement-history.ts"], database.env);
  expect(stdout).toContain("requirement history contracts passed");
});
