/** 真实进程迁移互斥；只允许隔离 runner 创建的随机库。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";
import { createSiblingTestDatabase, startIsolatedRedis } from "../tests/support/isolated-special.ts";

assertIsolatedTestEnvironment();
if (process.argv.includes("--child")) {
  const { runMigrations } = await import("../src/db/migrate.ts");
  const { sql } = await import("../src/db/index.ts");
  try { await runMigrations(); }
  catch { console.error("MIGRATION_FAILED"); process.exitCode = 1; }
  finally { await sql.end({ timeout: 1 }); }
} else {
  const folder = join(process.env.FERONAVI_TEST_DIRECTORY!, "lock-migrations");
  await mkdir(join(folder, "meta"), { recursive: true });
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 1, tag: "0000_probe", breakpoints: true }] }));
  await writeFile(join(folder, "0000_probe.sql"), "CREATE TABLE migration_lock_probe AS SELECT pg_backend_pid() AS pid;\n--> statement-breakpoint\nSELECT pg_sleep(1);");
  const redis = await startIsolatedRedis(process.env.FERONAVI_TEST_DIRECTORY!);
  const processes: ReturnType<typeof child>[] = [];
  function child(env: NodeJS.ProcessEnv, timeout = "3000") {
    const process = spawn(globalThis.process.execPath, ["scripts/e2e-migration-lock.ts", "--child"], { env: { ...env, MIGRATIONS_DIR: folder, MIGRATION_LOCK_TIMEOUT_MS: timeout, DB_POOL_MAX: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    process.stdout.on("data", c => { output += c; });
    process.stderr.on("data", c => { output += c; });
    const done = new Promise<number | null>((resolve, reject) => { process.once("error", reject); process.once("exit", resolve); });
    const result = { process, done, output: () => output };
    processes.push(result);
    return result;
  }
  async function fresh(run: (env: NodeJS.ProcessEnv, db: postgres.Sql) => Promise<void>) {
    const database = await createSiblingTestDatabase();
    const db = postgres(database.url, { max: 2, onnotice: () => {} });
    try { await run(database.env, db); }
    finally { await db.end({ timeout: 1 }); await database.cleanup(); }
  }
  try {
    for (const [label, url] of [["Redis available", redis.url], ["Redis unavailable", "redis://127.0.0.1:1"], ["Redis unset", ""]]) {
      await fresh(async (env, db) => {
        const lock = await db.reserve();
        await lock`select pg_advisory_lock(hashtext('feronavi:migrate'))`;
        const runner = child({ ...env, REDIS_URL: url }, "250");
        try {
          const code = await Promise.race([runner.done, delay(10000, undefined, { ref: false }).then(() => { throw new Error(`${label}: lock timeout not enforced`); })]);
          assert.equal(code, 1, `${label}: migration must wait for the shared PG lock and time out`);
          assert.equal((await lock`select to_regclass('migration_lock_probe') as name`)[0]!.name, null);
        } finally { await lock`select pg_advisory_unlock(hashtext('feronavi:migrate'))`; lock.release(); }
        console.log(`PASS ${label}: shared lock + bounded wait`);
      });
    }
    await fresh(async (env, db) => {
      const runs = [redis.url, "redis://127.0.0.1:1", ""].map(url => child({ ...env, REDIS_URL: url }));
      assert.deepEqual(await Promise.all(runs.map(r => r.done)), [0, 0, 0]);
      assert.equal((await db`select count(*)::int n from drizzle.__drizzle_migrations`)[0]!.n, 1);
      console.log("PASS 3 mixed-cache processes: exactly one applied migration; DB_POOL_MAX=1");
    });
    await fresh(async (env, db) => {
      const holder = child({ ...env, REDIS_URL: redis.url });
      let active = false;
      for (let i = 0; i < 150; i++) {
        const [row] = await db`select count(*)::int n from pg_stat_activity where datname=current_database() and pid <> pg_backend_pid() and state='active' and query like '%pg_sleep(1)%'`;
        if (row!.n > 0) { active = true; break; }
        await delay(100);
      }
      assert.ok(active, "holder must be inside the migration before kill");
      holder.process.kill("SIGKILL"); await holder.done;
      assert.equal(await child({ ...env, REDIS_URL: "" }).done, 0);
      assert.equal((await db`select count(*)::int n from drizzle.__drizzle_migrations`)[0]!.n, 1);
      console.log("PASS SIGKILL: PG session lock released and interrupted migration rolled back");
    });
  } finally {
    for (const runner of processes) if (runner.process.exitCode === null && runner.process.signalCode === null) runner.process.kill("SIGKILL");
    await Promise.allSettled(processes.map(r => r.done));
    await redis.stop();
  }
}
