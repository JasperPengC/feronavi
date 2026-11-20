/** 手动迁移与应用启动共用同一 PostgreSQL 锁及升级历史验证。 */
import { sql } from "./index.ts";
import { runMigrations } from "./migrate.ts";
try {
  await runMigrations();
} finally {
  await sql.end({ timeout: 5 });
}
