/** 使用专用测试容器内工具，演练随机库的完整 pg_dump / pg_restore。 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";
import { createSiblingTestDatabase } from "../tests/support/isolated-special.ts";

const sourceName = assertIsolatedTestEnvironment();
const sourceUrl = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(sourceUrl.hostname), "只允许本机隔离数据库");
const user = decodeURIComponent(sourceUrl.username);
const container = process.env.PG_CONTAINER;
assert.ok(container && /^[a-zA-Z0-9_.-]+$/.test(container), "必须显式声明测试PostgreSQL容器");
const [inspection] = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }));
const bindings = inspection.NetworkSettings?.Ports?.["5432/tcp"] as { HostPort: string }[] | undefined;
assert.ok(inspection.State?.Running && bindings?.some(binding => binding.HostPort === sourceUrl.port), "声明容器必须与隔离数据库连接端口一致");
const dumpFile = join(process.env.FERONAVI_TEST_DIRECTORY!, "restore-rehearsal.dump");
const source = postgres(sourceUrl.toString(), { max: 1, onnotice: () => {} });
const target = await createSiblingTestDatabase();
const restored = postgres(target.url, { max: 1, onnotice: () => {} });
function command(args: string[]) {
  const child = spawn("docker", ["exec", "-i", container, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let error = ""; child.stderr.on("data", c => { error = (error + c).slice(-2000); });
  const done = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`容器工具失败（${code}）：${error}`))); });
  return { child, done };
}
try {
  await source`create table ops_restore_probe (id integer primary key, content text not null, amount numeric(12,2) not null)`;
  await source`insert into ops_restore_probe values (1, '随机库恢复演练：中文、附件元数据不可乱码', 12345.67), (2, 'second row', -0.01)`;
  const [actor] = await source`insert into member (username, name, password_hash, status) values ('ops-restore-owner', '恢复测试', '!disabled', 'ACTIVE') returning id`;
  const [project] = await source`insert into project (key, name, created_by) values ('OPSRESTORE', '计划闭环恢复', ${actor!.id}) returning id`;
  const completion = JSON.stringify({ id: "restore-result", projectId: project!.id, completedAt: "2026-11-15T00:00:00.000Z", targetIterationId: null, carriedOverCount: 3, remainingCount: 0 });
  await source`insert into iteration (project_id, name, start_date, end_date, completed_at, completion_result, archived_at)
    values (${project!.id}, '归档迭代', '2026-11-01', '2026-11-14', '2026-11-15T00:00:00Z', ${completion}::jsonb, '2026-11-15T01:00:00Z')`;
  await source`insert into release (project_id, name, completed_at, completion_result, archived_at)
    values (${project!.id}, '归档版本', '2026-11-15T00:00:00Z', ${completion}::jsonb, '2026-11-15T01:00:00Z')`;
  const started = Date.now();
  const dump = command(["pg_dump", "-U", user, "-Fc", "--no-owner", "--no-privileges", sourceName]);
  dump.child.stdin.end();
  await Promise.all([pipeline(dump.child.stdout, createWriteStream(dumpFile, { mode: 0o600 })), dump.done]);
  const restore = command(["pg_restore", "-U", user, "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", target.name]);
  restore.child.stdout.resume();
  await Promise.all([pipeline(createReadStream(dumpFile), restore.child.stdin), restore.done]);
  const originalRows = await source`select * from ops_restore_probe order by id`;
  assert.deepEqual(await restored`select * from ops_restore_probe order by id`, originalRows);
  assert.deepEqual(await restored`select * from iteration where project_id=${project!.id} order by id`, await source`select * from iteration where project_id=${project!.id} order by id`);
  assert.deepEqual(await restored`select * from release where project_id=${project!.id} order by id`, await source`select * from release where project_id=${project!.id} order by id`);
  const sourceTables = await source`select table_name from information_schema.tables where table_schema='public' order by table_name`;
  assert.deepEqual(await restored`select table_name from information_schema.tables where table_schema='public' order by table_name`, sourceTables);
  const [before] = await source`select count(*)::int n from drizzle.__drizzle_migrations`;
  const [after] = await restored`select count(*)::int n from drizzle.__drizzle_migrations`;
  assert.equal(after!.n, before!.n);
  assert.equal((await restored`select count(*)::int n from pg_extension where extname in ('vector','zhparser')`)[0]!.n, 2);
  console.log(`PASS pg_dump -> empty random database -> pg_restore: ${sourceTables.length} tables, ${after!.n} migrations, vector/zhparser, Chinese/numeric rows identical; ${(await stat(dumpFile)).size} bytes; ${Date.now() - started}ms`);
  console.log("PASS iteration/release full rows including completion_result JSONB and archived_at timestamps survive real dump/restore");
} finally {
  await source.end({ timeout: 1 }); await restored.end({ timeout: 1 }); await target.cleanup();
}
