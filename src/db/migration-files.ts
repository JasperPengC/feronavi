import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";

/** 目录与journal必须一一对应，不能漏掉未登记SQL，也不能按文件名字典序猜执行顺序。 */
export function loadMigrations(folder: string) {
  const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as { entries?: { tag?: unknown }[] };
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) throw new Error("迁移目录的journal为空或无效");
  const names = journal.entries.map(entry => {
    if (typeof entry.tag !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(entry.tag)) throw new Error("迁移目录含非法文件标识");
    return `${entry.tag}.sql`;
  });
  const actual = readdirSync(folder).filter(name => name.endsWith(".sql"));
  if (new Set(names).size !== names.length || actual.length !== names.length || actual.some(name => !names.includes(name))) {
    throw new Error("迁移目录SQL与journal不一致，存在缺失或未登记文件");
  }
  return { names, migrations: readMigrationFiles({ migrationsFolder: folder }) };
}
