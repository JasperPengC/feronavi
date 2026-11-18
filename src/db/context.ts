/** 进程内异步调用链的数据库执行上下文；无数据库连接副作用。 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface DatabaseContext {
  database: object;
  connection: object;
  transaction: boolean;
  active: boolean;
  afterCommit: (() => Promise<unknown>)[];
  afterCompletion: (() => Promise<unknown>)[];
}
export const databaseContext = new AsyncLocalStorage<DatabaseContext>();

export function currentDatabaseContext(): DatabaseContext | undefined {
  const context = databaseContext.getStore();
  if (context && !context.active) throw new Error("数据库上下文已关闭，后台操作必须显式移到提交之后");
  return context;
}

/**
 * 事务内等待提交；保留连接内等待主任务完成，并在释放会话前执行。
 * callback 必须直接执行操作，不能再次调用会登记同一 callback 的包装函数。
 */
export function deferAfterCommit(callback: () => Promise<unknown>): boolean {
  const context = currentDatabaseContext();
  if (!context) return false;
  (context.transaction ? context.afterCommit : context.afterCompletion).push(callback);
  return true;
}
