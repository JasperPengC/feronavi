/** 新库、公开版、CRDT版及旧完整产品库升级；所有数据只在随机隔离库中。 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createIsolatedDatabase, repositoryRoot, runNode } from "../tests/support/isolated-database.ts";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
const legacyMappings = [
  [66, 1794590947741], [67, 1794657600000], [68, 1794661200000], [69, 1794664800000],
  [70, 1794672000000], [64, 1794765600000], [71, 1794769200000], [72, 1794772800000],
  [73, 1794801600000], [74, 1794898800000], [75, 1794900000000],
] as const;
// 旧迁移的真实 SQL；顺序不同但四个字段与当前0064完全等价。
const legacyPlan = 'ALTER TABLE "iteration" ADD COLUMN "completion_result" jsonb;\n--> statement-breakpoint\nALTER TABLE "iteration" ADD COLUMN "archived_at" timestamp with time zone;\n--> statement-breakpoint\nALTER TABLE "release" ADD COLUMN "completion_result" jsonb;\n--> statement-breakpoint\nALTER TABLE "release" ADD COLUMN "archived_at" timestamp with time zone;\n';

if (!process.env.FERONAVI_TEST_DATABASE) {
  for (const scenario of (process.env.UPGRADE_SCENARIOS ?? "legacy,fresh,public,crdt,release-0.2.1,legacy-partial,unknown,missing,rollback,concurrent,invalid-directory,unregistered-sql").split(",")) {
    const fixture = await createIsolatedDatabase();
    try {
      const result = await runNode(["scripts/e2e-product-source-upgrade.ts"], { ...fixture.env, UPGRADE_SCENARIO: scenario }, 120_000);
      process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    } catch (error) {
      const result = error as Error & { stdout?: string; stderr?: string };
      process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? ""); throw error;
    } finally { await fixture.cleanup(); }
  }
} else {
  assertIsolatedTestEnvironment();
  await verify();
}

async function verify() {
  const { db, sql } = await import("../src/db/index.ts");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { runMigrations } = await import("../src/db/migrate.ts");
  const scenario = process.env.UPGRADE_SCENARIO!;
  const source = join(repositoryRoot, "drizzle");
  const journal = JSON.parse(await readFile(join(source, "meta/_journal.json"), "utf8")) as { entries: Entry[] };
  let checks = 0;
  const check = (name: string, actual: unknown, expected: unknown = true) => { assert.deepEqual(actual, expected, name); checks++; console.log(`OK ${scenario}: ${name}`); };
  try {
    if (scenario !== "fresh") {
      const legacy = scenario.startsWith("legacy");
      const entries = journal.entries.filter(e => e.idx <= (scenario === "release-0.2.1" ? 75 : legacy || scenario === "public" ? 60 : 65));
      if (scenario === "release-0.2.1") {
        // 固定自已发布 v0.2.1 tag 的76项迁移，修改旧SQL不能悄悄改变验收基线。
        const snapshot = await Promise.all(entries.map(async entry => [entry, createHash("sha256").update(await readFile(join(source, `${entry.tag}.sql`))).digest("hex")]));
        check("0.2.1迁移与已发布tag逐项一致", createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), "750af6db30952069241504451cee909785b5f9b1df8268037d89d1eacd75f9f8");
      }
      const directory = join(process.env.FERONAVI_TEST_DIRECTORY!, "old-migrations");
      await mkdir(join(directory, "meta"), { recursive: true });
      for (const entry of entries) await copyFile(join(source, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
      if (legacy) {
        for (const [index, [canonicalIndex, when]] of legacyMappings.entries()) {
          if (scenario === "legacy-partial" && index > 5) break;
          const original = journal.entries.find(e => e.idx === canonicalIndex)!;
          const tag = `legacy_${61 + index}`;
          const contents = canonicalIndex === 64 ? legacyPlan : await readFile(join(source, `${original.tag}.sql`), "utf8");
          await writeFile(join(directory, `${tag}.sql`), contents);
          entries.push({ ...original, idx: 61 + index, tag, when });
        }
      }
      await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      // 用真实旧迁移器建立旧库，避免用待测升级器制造自己的预期。
      await migrate(db, { migrationsFolder: directory });
      check("旧库账本数量准确", (await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0]!.n, entries.length);
      const member = (await sql`insert into member(username,name,status,password_hash) values('upgrade-fixture','升级验收成员','ACTIVE','fixture-not-a-login') returning id`)[0]!;
      const project = (await sql`insert into project(key,name,created_by) values('UPGRADE','旧项目',${member.id}) returning id`)[0]!;
      const plan = (await sql`insert into iteration(project_id,name,start_date,end_date) values(${project.id},'原计划','2026-10-01','2026-10-14') returning id`)[0]!;
      if (scenario === "release-0.2.1") {
        const workflow = (await sql`insert into workflow(project_id,name,applies_to_type) values(${project.id},'旧需求流程','REQUIREMENT') returning id`)[0]!;
        const status = (await sql`insert into workflow_state(workflow_id,key,name,category,color) values(${workflow.id},'DRAFT','草稿','NOT_STARTED','neutral') returning id`)[0]!;
        await sql`insert into work_item(project_id,number,key,type,title,description,workflow_id,status_id,reporter_id,version,iteration_id) values(${project.id},1,'UPGRADE-1','REQUIREMENT','0.2.1原需求','升级前已修改的正文',${workflow.id},${status.id},${member.id},7,${plan.id})`;
        const page = (await sql`insert into page(project_id,title,slug) values(${project.id},'0.2.1文档','previous-document') returning id`)[0]!;
        const revision = (await sql`insert into page_revision(page_id,revision_no,content,author_id) values(${page.id},1,'原有文档内容和中文',${member.id}) returning id`)[0]!;
        await sql`update page set current_revision_id=${revision.id} where id=${page.id}`;
      }
      if (legacy || scenario === "crdt") {
        await sql`update iteration set completion_result=${JSON.stringify({ id: plan.id, targetIterationId: null, carriedOverCount: 2, remainingCount: 0 })}::jsonb,completed_at='2026-10-15T08:00:00Z' where id=${plan.id}`;
      }
      if (scenario === "legacy") {
        const conversation = (await sql`insert into rag_conversation(owner_id,project_id,title) values(${member.id},${project.id},'保留旧对话') returning id`)[0]!;
        await sql`insert into rag_message(conversation_id,request_id,question,status,reply) values(${conversation.id},${randomUUID()},'原问题','completed',${JSON.stringify({ answer: '原回答', sources: [] })}::jsonb)`;
        await sql`insert into system_backup(requested_by,mode,status,header_draft,expires_at) values(${member.id},'safe','SUCCEEDED','{}','2027-01-01')`;
      }
    }
    const snapshot = async () => {
      const tables = scenario === "legacy" ? ["member", "project", "iteration", "rag_conversation", "rag_message", "system_backup"]
        : scenario === "release-0.2.1" ? ["member", "project", "iteration", "work_item", "page", "page_revision"] : ["member", "project", "iteration"];
      const result: unknown[] = [];
      for (const table of tables) {
        const newFields = table === "work_item" ? " - 'product_id'" : table === "page" ? " - 'kind' - 'structure_version' - 'created_by'" : "";
        const rows = await sql.unsafe(`select to_jsonb(t) - 'completion_result' - 'archived_at'${newFields} as value from "${table}" t order by id`);
        result.push(rows.map(row => row.value));
      }
      return result;
    };
    const before = scenario === "fresh" ? null : await snapshot();
    if (scenario === "invalid-directory" || scenario === "unregistered-sql") {
      const ledger = Array.from(await sql`select * from drizzle.__drizzle_migrations order by id`);
      const directory = join(process.env.FERONAVI_TEST_DIRECTORY!, "invalid-migrations");
      await mkdir(join(directory, "meta"), { recursive: true });
      if (scenario === "unregistered-sql") {
        for (const entry of journal.entries) await copyFile(join(source, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
        await writeFile(join(directory, "meta/_journal.json"), JSON.stringify(journal));
        await writeFile(join(directory, "9999_unregistered.sql"), "create table unregistered(id int);");
      }
      process.env.MIGRATIONS_DIR = directory;
      await assert.rejects(runMigrations(), /迁移/);
      check("错误迁移目录拒绝启动且不改账本", Array.from(await sql`select * from drizzle.__drizzle_migrations order by id`), ledger);
      check("错误迁移目录不改业务数据", await snapshot(), before);
      const { migrationStatus } = await import("../src/server/services/upgrade.service.ts");
      check("自检明确报告错误目录", (await migrationStatus()).consistent, false);
    } else if (scenario === "unknown" || scenario === "missing") {
      if (scenario === "unknown") await sql`insert into drizzle.__drizzle_migrations(hash,created_at) values('unknown-history',1796000000000)`;
      else await sql`delete from drizzle.__drizzle_migrations where created_at=1793805000000`;
      const ledger = await sql`select * from drizzle.__drizzle_migrations order by id`;
      await assert.rejects(runMigrations(), /迁移历史/);
      check("未知或缺失迁移历史拒绝升级且不改账本", await sql`select * from drizzle.__drizzle_migrations order by id`, ledger);
      check("拒绝升级保留业务数据", await snapshot(), before);
    } else {
      const oldLedger = scenario === "fresh" ? [] : await sql`select * from drizzle.__drizzle_migrations order by id`;
      if (scenario === "rollback") {
        const brokenDirectory = join(process.env.FERONAVI_TEST_DIRECTORY!, "broken-migrations");
        await mkdir(join(brokenDirectory, "meta"), { recursive: true });
        for (const entry of journal.entries) await copyFile(join(source, `${entry.tag}.sql`), join(brokenDirectory, `${entry.tag}.sql`));
        const last = journal.entries.at(-1)!;
        const extra = { ...last, idx: last.idx + 1, when: last.when + 1000, tag: `${String(last.idx + 1).padStart(4, "0")}_transaction_failure` };
        await writeFile(join(brokenDirectory, "meta/_journal.json"), JSON.stringify({ ...journal, entries: [...journal.entries, extra] }));
        await writeFile(join(brokenDirectory, `${extra.tag}.sql`), 'create table upgrade_rollback_marker(id int);\n--> statement-breakpoint\nselect deliberately_missing_upgrade_function();');
        process.env.MIGRATIONS_DIR = brokenDirectory;
        await assert.rejects(runMigrations(), /deliberately_missing_upgrade_function/);
        check("失败升级不追加任何历史记录", Array.from(await sql`select * from drizzle.__drizzle_migrations order by id`), Array.from(oldLedger));
        check("失败升级回滚本批次已创建的表", (await sql`select to_regclass('upgrade_rollback_marker') as marker, to_regclass('system_backup') as backup`)[0], { marker: null, backup: null });
        check("失败升级保留原业务数据", await snapshot(), before);
        process.env.MIGRATIONS_DIR = source;
      }
      if (scenario === "concurrent") {
        await Promise.all([1, 2].map(() => runNode(["src/db/migrate-cli.ts"], { ...process.env, DB_POOL_MAX: "1" }, 60_000)));
        check("双实例单连接池并发升级均成功", true);
      } else await runMigrations();
      const tables = await sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('collab_room','collab_update','collab_snapshot','rag_conversation','rag_message','system_backup','system_restore','assistant_artifact') order by table_name`;
      check("CRDT、助手和备份表完整", tables.map(row => row.table_name), ['assistant_artifact','collab_room','collab_snapshot','collab_update','rag_conversation','rag_message','system_backup','system_restore']);
      check("审批快照字段存在", (await sql`select count(*)::int as n from information_schema.columns where table_name='approval_request' and column_name='transition_fields'`)[0]!.n, 1);
      if (before) check("旧成员、项目、会话与备份数据逐行保留", await snapshot(), before);
      if (scenario === "release-0.2.1") {
        check("旧需求捕获为BASELINE而非伪造创建历史", Array.from(await sql`select revision_no,work_item_version,title,description,author_id,source from requirement_revision`), [{ revision_no: 1, work_item_version: 7, title: "0.2.1原需求", description: "升级前已修改的正文", author_id: null, source: "BASELINE" }]);
        const page = (await sql`select kind,structure_version,created_by,(select author_id from page_revision where id=page.current_revision_id) as author from page`)[0]!;
        check("旧文档默认类型和结构版本正确", [page.kind, page.structure_version], ["DOCUMENT", 1]);
        check("旧文档创建人从真实首版作者回填", page.created_by, page.author);
        check("新增测试与交付业务表存在且为空", Array.from(await sql`select (select count(*)::int from test_case) as cases,(select count(*)::int from release_candidate) as candidates`), [{ cases: 0, candidates: 0 }]);
      }
      const ledger = await sql`select * from drizzle.__drizzle_migrations order by id`;
      check("旧账本原样保留", ledger.slice(0, oldLedger.length), Array.from(oldLedger));
      check("每项迁移只记录一次", ledger.length, journal.entries.length);
      if (scenario.startsWith("legacy")) check("旧计划完成回执保留", (await sql`select completion_result->>'carriedOverCount' as count from iteration`)[0]?.count, "2");
      await runMigrations();
      check("重复升级不追加账本", await sql`select * from drizzle.__drizzle_migrations order by id`, ledger);
      if (before) check("重复升级不改业务数据", await snapshot(), before);
      const { migrationStatus } = await import("../src/server/services/upgrade.service.ts");
      check("升级自检识别完整历史", (await migrationStatus()).consistent);
      if (scenario === "crdt") {
        await sql`update drizzle.__drizzle_migrations set hash='tampered-but-count-unchanged' where id=2`;
        check("升级自检拒绝数量相同但hash损坏的账本", (await migrationStatus()).consistent, false);
      }
      const hash = createHash("sha256").update(JSON.stringify(tables)).digest("hex");
      console.log(`schema-tables ${hash}`);
    }
    console.log(`产品旧库升级 ${scenario} ${checks}/${checks}`);
  } finally { await sql.end({ timeout: 5 }); }
}
