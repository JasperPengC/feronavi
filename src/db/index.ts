/** 数据库连接（postgres.js + Drizzle）。选 postgres.js 是因为纯 JS、无原生编译。 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";
import { currentDatabaseContext, databaseContext, type DatabaseContext } from "./context.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未设置");

const pool = postgres(url, {
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idle_timeout: 30,
  // 迁移等长语句需要更宽的超时
  connect_timeout: 10,
  // 可观测性（Round 59）：给应用连接打 application_name，便于用 pg_stat_activity 度量
  // 连接池饱和度（6.6 要求"池饱和度 > 80% 告警"）——否则无法与其它客户端区分。
  connection: { application_name: "feronavi-app" },
});

const rootDatabase = drizzle(pool, { schema });
type Database = typeof rootDatabase;
type Connection = typeof pool;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** 原生 SQL 与 Drizzle 都读取同一异步上下文，防止 service/repo 在事务中逃回连接池。 */
export const sql = new Proxy(pool, {
  apply(_target, thisArg, args) {
    const connection = currentDatabaseContext()?.connection as Connection | undefined ?? pool;
    return Reflect.apply(connection, thisArg, args);
  },
  get(_target, property) {
    const context = currentDatabaseContext();
    const connection = context?.connection as Connection | undefined ?? pool;
    if (property === "options") return pool.options;
    if (property === "begin" || (context?.transaction && property === "savepoint")) {
      return (optionsOrFn: string | ((connection: Connection) => unknown), callback?: (connection: Connection) => unknown) => {
        const fn = typeof optionsOrFn === "function" ? optionsOrFn : callback!;
        const options = property === "begin" && typeof optionsOrFn === "string" ? optionsOrFn : "";
        return inTransaction(async () => { const result = fn(sql); return Array.isArray(result) ? Promise.all(result) : result; }, options);
      };
    }
    const value = Reflect.get(connection, property);
    return typeof value === "function" ? value.bind(connection) : value;
  },
});
export const db: Database = new Proxy(rootDatabase, {
  get(_target, property) {
    const context = currentDatabaseContext();
    const database = context?.database as Database | undefined ?? rootDatabase;
    if (property === "transaction") {
      return (fn: (transaction: Transaction) => Promise<unknown>, config?: { isolationLevel?: string; accessMode?: string; deferrable?: boolean }) => {
        const options = [config?.isolationLevel && `isolation level ${config.isolationLevel}`, config?.accessMode,
          config?.deferrable === undefined ? undefined : config.deferrable ? "deferrable" : "not deferrable"].filter(Boolean).join(" ");
        return inTransaction(() => fn(db as unknown as Transaction), options);
      };
    }
    if (context?.transaction && property === "rollback") return () => { throw new Error("事务已请求回滚"); };
    const value = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

function contextFor(connection: object, transaction: boolean): DatabaseContext {
  // postgres.js 的保留/事务连接不暴露 options；Drizzle 建构器需要共享的类型编解码配置。
  const adapter = new Proxy(connection, {
    get(target, property) {
      if (property === "options") return pool.options;
      // Drizzle migrator 直接调用 session.transaction，绕过 db.transaction 代理。
      // 为保留连接补齐 begin/savepoint，让该入口也进入同一 ALS 事务上下文。
      if (property === "begin" || property === "savepoint") return Reflect.get(sql, property);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { connection, database: drizzle(adapter as Connection, { schema }), transaction, active: true, afterCommit: [], afterCompletion: [] };
}

async function flushEffects(callbacks: (() => Promise<unknown>)[]): Promise<void> {
  // for-of 会继续处理执行期间追加的联动；单条失败不跳过剩余副作用。
  for (const callback of callbacks) {
    try { await callback(); } catch (error) { console.error("[after-commit] 后续操作失败", error); }
  }
}

/** 绑定保留连接，用于会话锁；业务查询也复用它，DB_POOL_MAX=1 时不会自锁。 */
export async function onReservedConnection<T>(connection: object, fn: () => Promise<T>): Promise<T> {
  const context = contextFor(connection, false);
  try {
    return await databaseContext.run(context, async () => {
      try { return await fn(); }
      // 非事务写入已提交，即使主任务后续失败，仍须完成已登记的副作用。
      finally { await flushEffects(context.afterCompletion); }
    });
  }
  finally { context.active = false; }
}

let savepointSequence = 0;
/** 数据写入与幂等结果共用事务；嵌套事务使用同连接的 savepoint。 */
export async function inTransaction<T>(fn: () => Promise<T>, options = ""): Promise<T> {
  // 与 postgres.js begin 一样仅接受事务选项字符；禁止拼接任意 SQL。
  if (!/^[a-z ]*$/iu.test(options)) throw new Error("事务选项格式无效");
  const parent = currentDatabaseContext();
  if (parent?.transaction && options) throw new Error("嵌套事务不能改变外层隔离级别或访问模式");
  const reserved = parent ? undefined : await pool.reserve();
  const connection = (parent?.connection ?? reserved) as postgres.ReservedSql;
  const savepoint = parent?.transaction ? `feronavi_sp_${++savepointSequence}` : null;
  const context = contextFor(connection, true);
  let result: T;
  try {
    await connection.unsafe(savepoint ? `savepoint ${savepoint}` : `begin ${options}`);
    result = await databaseContext.run(context, fn);
    context.active = false;
    const completed = await connection.unsafe(savepoint ? `release savepoint ${savepoint}` : "commit");
    // PostgreSQL 对已 aborted 的事务 COMMIT 会返回 ROLLBACK，不能误报提交成功。
    if (!savepoint && completed.command !== "COMMIT") throw new Error("事务未提交（可能已被数据库错误中止）");
  } catch (error) {
    context.active = false;
    await connection.unsafe(savepoint ? `rollback to savepoint ${savepoint}` : "rollback").catch(async () => {
      // 无法恢复会话时终止其后端，禁止把不明事务状态交给连接池下个请求。
      await connection.unsafe("select pg_terminate_backend(pg_backend_pid())").catch(() => {});
    });
    throw error;
  } finally {
    reserved?.release();
  }
  if (parent?.transaction) parent.afterCommit.push(...context.afterCommit);
  else {
    // 新异步链不继承已关闭事务。提交后信号失败只能记录，不能把已提交响应改报失败。
    const flush = () => flushEffects(context.afterCommit);
    if (parent) await databaseContext.run(parent, flush);
    else await databaseContext.exit(flush);
  }
  return result;
}
export { schema };
