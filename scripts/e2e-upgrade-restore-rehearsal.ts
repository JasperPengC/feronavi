/** 本机模拟：历史迁移快照升级及数据库/主密钥/附件灾备；不代表用户服务器升级。 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";
import { createSiblingTestDatabase } from "../tests/support/isolated-special.ts";
import { repositoryRoot, runNode } from "../tests/support/isolated-database.ts";
import { encryptSecretWithKey, decryptSecretWithKey } from "../src/server/services/crypto.service.ts";

assertIsolatedTestEnvironment();
if (process.argv.includes("--migrate-child")) {
  const { sql } = await import("../src/db/index.ts");
  try { await (await import("../src/db/migrate.ts")).runMigrations(); }
  finally { await sql.end({ timeout: 1 }); }
} else {
  const root = process.env.FERONAVI_TEST_DIRECTORY;
  assert.ok(root, "必须经隔离 runner 运行");
  const journal = JSON.parse(await readFile(join(repositoryRoot, "drizzle/meta/_journal.json"), "utf8"));
  const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  const migrate = (env: NodeJS.ProcessEnv, folder: string) => runNode(
    ["scripts/e2e-upgrade-restore-rehearsal.ts", "--migrate-child"],
    { ...env, MIGRATIONS_DIR: folder, MIGRATE_ON_START: "1", DB_POOL_MAX: "1" },
  );
  for (const cutoff of [0, 63]) {
    const database = await createSiblingTestDatabase();
    const sql = postgres(database.url, { max: 1, onnotice: () => {} });
    const folder = join(root, `historical-${cutoff}`);
    try {
      await mkdir(join(folder, "meta"), { recursive: true });
      const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= cutoff);
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      for (const entry of entries) await copyFile(join(repositoryRoot, "drizzle", `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      await migrate(database.env, folder);
      assert.equal((await sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]!.n, entries.length);
      const [member] = await sql`insert into member (username,name,password_hash,status) values ('upgrade-owner','历史用户：中文','!disabled','ACTIVE') returning *`;
      let projectId: string | undefined;
      let pageId: string | undefined;
      if (cutoff >= 63) {
        const columns = await sql`select column_name from information_schema.columns where table_name='iteration' and column_name='completion_result'`;
        assert.equal(columns.length, 0, "确认为生命周期迁移之前的 schema");
        const [project] = await sql`insert into project (key,name,created_by) values ('OLD','历史项目',${member!.id}) returning id`;
        projectId = project!.id;
        await sql`insert into iteration (project_id,name,start_date,end_date) values (${projectId!},'旧迭代','2026-11-01','2026-11-14')`;
        await sql`insert into release (project_id,name) values (${projectId!},'旧版本')`;
        const [page] = await sql`insert into page (project_id,title,slug) values (${projectId!},'历史知识','historical') returning id`;
        pageId = page!.id;
        await sql`insert into index_job (page_id,mode,status,generation,finished_at) values (${pageId!},'FULL','SUCCEEDED',1,'2026-11-14T00:00:00Z'), (${pageId!},'FULL','SUCCEEDED',2,'2026-11-14T01:00:00Z')`;
      }
      await migrate(database.env, join(repositoryRoot, "drizzle"));
      const upgradedMember = (await sql`select * from member where id=${member!.id}`)[0]!;
      assert.deepEqual(Object.fromEntries(Object.keys(member!).map(name => [name, upgradedMember[name]])), member);
      assert.equal((await sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]!.n, journal.entries.length);
      if (projectId) {
        assert.equal((await sql`select completion_result,archived_at from iteration where project_id=${projectId}`)[0]!.completion_result, null);
        assert.equal((await sql`select completion_result,archived_at from release where project_id=${projectId}`)[0]!.archived_at, null);
        const jobs = await sql`select generation,activated_at from index_job where page_id=${pageId!} order by generation`;
        assert.ok(jobs[0]!.activated_at, "已生效历史索引应回填激活时间");
        assert.equal(jobs[1]!.activated_at, null, "未来 generation 不应被误激活");
      }
      const ledger = await sql`select * from drizzle.__drizzle_migrations order by id`;
      await migrate(database.env, join(repositoryRoot, "drizzle"));
      assert.deepEqual(await sql`select * from drizzle.__drizzle_migrations order by id`, ledger);
      console.log(`PASS historical schema ${entries.at(-1).tag} (${entries.length}) -> latest (${journal.entries.length}); existing Chinese member/business rows retained; idempotent rerun${projectId ? '; lifecycle defaults + knowledge activation backfill' : ''}`);
    } finally { await sql.end({ timeout: 1 }); await database.cleanup(); }
  }

  const source = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  let target: { name: string; url: string; cleanup: () => Promise<void> };
  if (process.env.RESTORE_TEST_DATABASE_URL) {
    const targetName = assertIsolatedTestEnvironment({
      ...process.env,
      DATABASE_URL: process.env.RESTORE_TEST_DATABASE_URL,
      FERONAVI_TEST_DATABASE: process.env.RESTORE_TEST_DATABASE_NAME,
    });
    // 跨镜像夹具由外层 createIsolatedDatabase 创建并负责清理。
    target = { name: targetName, url: process.env.RESTORE_TEST_DATABASE_URL, cleanup: async () => {} };
  } else target = await createSiblingTestDatabase();
  const restored = postgres(target.url, { max: 1, onnotice: () => {} });
  const data = join(root, "ops-source-data");
  const destination = join(root, "ops-restored-data");
  const out = join(root, "ops-backups");
  const key = randomBytes(32);
  const plain = randomBytes(48).toString("base64url");
  const bytes = Buffer.concat([Buffer.from("灾备附件\n"), randomBytes(4096)]);
  try {
    await mkdir(join(data, "attachments"), { recursive: true });
    await writeFile(join(data, "master.key"), key, { mode: 0o600 });
    await writeFile(join(data, "attachments", "restore-probe.bin"), bytes);
    const cipher = encryptSecretWithKey(plain, key);
    await source`insert into setting (key,value,is_secret) values ('test.restore.probe',${source.json(cipher)},true)`;
    await source`create table ops_upgrade_probe (id integer primary key, content text, amount numeric(12,2))`;
    await source`insert into ops_upgrade_probe values (1,'中文与数值恢复',12345.67),(2,'second',-0.01)`;
    await source`alter table ops_upgrade_probe add column embedding vector(3)`;
    await source`update ops_upgrade_probe set embedding=case when id=1 then '[1,2,3]'::vector else '[4,5,6]'::vector end`;
    await source`create index ops_upgrade_probe_content on ops_upgrade_probe(content)`;
    await source`create index ops_upgrade_probe_search on ops_upgrade_probe using gin(to_tsvector('chinese_zh',content))`;
    await source`create index ops_upgrade_probe_vector on ops_upgrade_probe using hnsw(embedding vector_l2_ops)`;
    const env = { ...process.env, DATA_DIR: data };
    await runNode(["scripts/backup.ts", "--out", out], env);
    const folders = await readdir(out);
    assert.equal(folders.length, 1);
    // 真实 PostgreSQL 失败注入：恢复已执行DROP后在CREATE阶段失败，必须回滚旧库。
    await restored`create table member (marker text)`;
    await restored`insert into member values ('target must survive failed restore')`;
    await restored`create function reject_restore_create() returns event_trigger language plpgsql as $$ begin raise exception 'restore-rehearsal-injected-create-failure'; end $$`;
    await restored`create event trigger reject_restore_create on ddl_command_start when tag in ('CREATE TABLE') execute function reject_restore_create()`;
    const restoreEnv = { ...env, PG_CONTAINER: process.env.RESTORE_PG_CONTAINER ?? env.PG_CONTAINER, RESTORE_DATABASE_URL: target.url };
    await assert.rejects(runNode(["scripts/restore.ts", "--backup", join(out, folders[0]!), "--data-dir", destination], restoreEnv), /restore-rehearsal-injected-create-failure/);
    assert.deepEqual(Array.from(await restored`select * from member`), [{ marker: 'target must survive failed restore' }]);
    await assert.rejects(access(destination), { code: "ENOENT" });
    await restored`drop event trigger reject_restore_create`;
    await restored`drop function reject_restore_create()`;
    console.log("PASS pg_restore failure after DROP rolls back original database and does not switch data directory");
    await runNode(["scripts/restore.ts", "--backup", join(out, folders[0]!), "--data-dir", destination], {
      ...env,
      PG_CONTAINER: process.env.RESTORE_PG_CONTAINER ?? env.PG_CONTAINER,
      RESTORE_DATABASE_URL: target.url,
    });
    assert.deepEqual(await restored`select * from ops_upgrade_probe order by id`, await source`select * from ops_upgrade_probe order by id`);
    assert.deepEqual(await restored`select * from drizzle.__drizzle_migrations order by id`, await source`select * from drizzle.__drizzle_migrations order by id`);
    const tables = await source`select table_name from information_schema.tables where table_schema='public' order by table_name`;
    assert.deepEqual(await restored`select table_name from information_schema.tables where table_schema='public' order by table_name`, tables);
    for (const row of tables) {
      const name = row.table_name;
      assert.deepEqual(await restored`select count(*)::int n from ${restored(name)}`, await source`select count(*)::int n from ${source(name)}`, `恢复行数 ${name}`);
    }
    const sourceIndexes = await source`select indexname,indexdef from pg_indexes where schemaname='public' order by indexname`;
    assert.deepEqual(await restored`select indexname,indexdef from pg_indexes where schemaname='public' order by indexname`, sourceIndexes, "逻辑恢复在目标平台重建全部索引定义");
    assert.equal((await restored`select count(*)::int n from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (not i.indisvalid or not i.indisready)`)[0]!.n, 0);
    assert.equal((await restored`select id from ops_upgrade_probe order by embedding <-> '[1,2,3]'::vector limit 1`)[0]!.id, 1);
    assert.equal((await restored`select to_tsvector('chinese_zh',content) @@ plainto_tsquery('chinese_zh','恢复') as found from ops_upgrade_probe where id=1`)[0]!.found, true);
    assert.equal(digest(await readFile(join(destination, "attachments", "restore-probe.bin"))), digest(bytes));
    const recoveredKey = await readFile(join(destination, "master.key"));
    assert.equal(digest(recoveredKey), digest(key));
    assert.equal((await stat(join(destination, "master.key"))).mode & 0o777, 0o600);
    const [setting] = await restored`select value from setting where key='test.restore.probe'`;
    assert.equal(decryptSecretWithKey(setting!.value, recoveredKey), plain);
    recoveredKey.fill(0);
    assert.equal((await restored`select count(*)::int n from pg_extension where extname in ('vector','zhparser')`)[0]!.n, 2);
    console.log(`PASS backup.ts -> restore.ts: ${tables.length} public tables/counts + ${sourceIndexes.length} rebuilt valid/ready indexes (text/GIN/HNSW) + exact migration ledger + Chinese/numeric rows + vector/zhparser queries; attachment SHA256 identical; master.key SHA256/0600 preserved; restored encrypted setting decrypted without outbound delivery`);
    console.log("SCOPE local historical-schema simulation and local isolated disaster recovery only; user-server image/volume upgrade and rollback require that deployment's rehearsal.");
  } finally { key.fill(0); await source.end({ timeout: 1 }); await restored.end({ timeout: 1 }); await target.cleanup(); }
}
