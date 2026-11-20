/** 健康探测 —— 只做最轻量的连通性检查，不写业务逻辑 */
import type postgres from "postgres";
import { createIndependentSql } from "../../db/index.ts";

let pending: Promise<void> | undefined;

/** 探针拥有自己的连接；期限届满销毁它，不取消业务连接上的查询。 */
export async function runDatabaseHealthProbe<T>(read: (connection: postgres.Sql) => PromiseLike<T>): Promise<T> {
  const connection = createIndependentSql();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(connection), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("database health timeout")), 1000);
    })]);
  } finally {
    clearTimeout(timer);
    await connection.end({ timeout: 1 });
  }
}

/** 数据库连通性探针（`SELECT 1`） */
export async function pgSqlProbe(): Promise<void> {
  pending ??= runDatabaseHealthProbe(async connection => { await connection`select 1`; }).finally(() => { pending = undefined; });
  await pending;
}
