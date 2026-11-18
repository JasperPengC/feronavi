/** 健康探测 —— 只做最轻量的连通性检查，不写业务逻辑 */
import { sql } from "../../db/index.ts";

/** 数据库连通性探针（`SELECT 1`） */
export async function pgSqlProbe(): Promise<void> {
  await sql`select 1`;
}
