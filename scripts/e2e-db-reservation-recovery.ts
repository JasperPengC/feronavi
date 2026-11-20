/** 仅终止本次隔离库中自己持有的连接，验证断线后旧租约不会污染连接池。 */
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

assertIsolatedTestEnvironment();
const sql = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 3 });
const observer = postgres(process.env.DATABASE_URL!, { max: 1 });
try {
  const lease = await sql.reserve();
  await lease`begin`;
  const [backend] = await lease`select pg_backend_pid() as pid`;
  await observer`select pg_terminate_backend(${backend!.pid})`;
  await delay(100);
  await assert.rejects(() => lease`rollback`, { code: "CONNECTION_CLOSED" });
  console.log("PASS 已断开的租约明确拒绝回滚，不触发异步空连接写入");
  lease.release();
  lease.release();
  assert.equal((await sql`select 42 as answer`)[0]!.answer, 42);
  console.log("PASS 重复释放失效租约后连接池可以重新连接");
  const next = await sql.reserve();
  await next`begin`;
  await next`create table reservation_recovery (value integer)`;
  await next`insert into reservation_recovery values (7)`;
  await next`commit`;
  next.release();
  await assert.rejects(() => next`select 1`, { code: "CONNECTION_RELEASED" });
  assert.equal((await sql`select value from reservation_recovery`)[0]!.value, 7);
  console.log("PASS 新租约可提交并复读，已释放租约不能复用");
} finally {
  await Promise.all([sql.end({ timeout: 1 }), observer.end({ timeout: 1 })]);
}
