import { onReservedConnection, sql } from "../../../db/index.ts";
import { DomainError } from "../../../shared/errors.ts";
import { AsyncLocalStorage } from "node:async_hooks";

const LOCK_KEY = "feronavi.system-restore.v1";
const heldLock = new AsyncLocalStorage<{ active: boolean }>();

/** 会话锁与所有回调查询绑定同一物理连接，包含回滚后的失败记录。 */
export async function withSystemRestoreLock<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const result = await tryWithSystemRestoreLock(fn);
  if (!result.acquired)
    throw new DomainError("CONFLICT", "系统数据恢复锁已被占用", null);
  return result.value;
}

/** worker先取锁再领取；竞争时不领取、不消耗一次性句柄或执行次数。 */
export async function tryWithSystemRestoreLock<T>(
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (heldLock.getStore()?.active) return { acquired: true, value: await fn() };
  const connection = await sql.reserve();
  let acquired = false;
  const context = { active: true };
  try {
    const [row] =
      await connection`select pg_try_advisory_lock(hashtextextended(${LOCK_KEY}, 0)) as locked`;
    acquired = row!.locked === true;
    if (!acquired) return { acquired: false };
    return {
      acquired: true,
      value: await onReservedConnection(connection, () =>
        heldLock.run(context, fn),
      ),
    };
  } finally {
    context.active = false;
    if (acquired) {
      try {
        await connection`select pg_advisory_unlock(hashtextextended(${LOCK_KEY}, 0))`;
      } catch {
        await connection`select pg_terminate_backend(pg_backend_pid())`.catch(
          () => {},
        );
      }
    }
    connection.release();
  }
}

export async function isSystemRestoring(): Promise<boolean> {
  const rows =
    await sql`select 1 from system_restore where status = 'RESTORING' limit 1`;
  return rows.length > 0;
}

export async function assertNotRestoring(): Promise<void> {
  if (await isSystemRestoring())
    throw new DomainError("CONFLICT", "系统数据恢复进行中", null);
}
