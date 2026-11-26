/**
 * 真实旧库升级：0063/0064/0065仅用SQL准备和核对历史数据，迁至最新后验证业务服务。
 * 运行：TEST_DATABASE_ADMIN_URL=... node scripts/e2e-plan-upgrade.ts
 * 本脚本自建空库；不要通过会提前迁至最新版的 run-isolated-test.ts 调用。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createIsolatedDatabase, repositoryRoot, runNode } from "../tests/support/isolated-database.ts";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

if (!process.env.FERONAVI_TEST_DATABASE) {
  const fixture = await createIsolatedDatabase();
  try {
    const result = await runNode(["scripts/e2e-plan-upgrade.ts"], fixture.env, 180_000);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } catch (error) {
    const result = error as Error & { stdout?: string; stderr?: string };
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw error;
  } finally { await fixture.cleanup(); }
} else {
  assertIsolatedTestEnvironment();
  await verifyUpgrade();
}

async function verifyUpgrade() {
  const { sql } = await import("../src/db/index.ts");
  const { runMigrations } = await import("../src/db/migrate.ts");
  const { DomainError } = await import("../src/shared/errors.ts");
  const checks: { name: string; pass: true }[] = [];
  const check = (name: string, value: unknown) => { assert.ok(value, name); checks.push({ name, pass: true }); console.log(`OK ${name}`); };
  const equal = (name: string, actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected, name); check(name, true); };
  const rejects = async (name: string, operation: () => Promise<unknown>) => {
    await assert.rejects(operation, (error: unknown) => error instanceof DomainError && error.code === "BLOCKED_BY_PREREQUISITE");
    check(name, true);
  };
  const source = join(repositoryRoot, "drizzle");
  const journal = JSON.parse(await readFile(join(source, "meta", "_journal.json"), "utf8"));
  const migrationDirectory = async (last: number) => {
    const directory = join(process.env.FERONAVI_TEST_DIRECTORY!, `migrations-${last}`);
    await mkdir(join(directory, "meta"), { recursive: true });
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= last);
    assert.equal(entries.at(-1)?.idx, last);
    for (const entry of entries) await copyFile(join(source, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
    await writeFile(join(directory, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    return { directory, count: entries.length };
  };
  const countMigrations = async () => (await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0]!.n;
  const snapshot = async (table: string, newColumns = false) => (await sql.unsafe(`select to_jsonb(t)${newColumns ? " - 'archived_at' - 'completion_result'" : ""} as row from "${table}" t order by id`)).map(row => row.row);
  let failure: string | null = null;
  try {
    const [{ tables }] = await sql`select count(*)::int as tables from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`;
    check("升级验收从本次隔离空库开始", tables === 0);
    const legacy = await migrationDirectory(63);
    process.env.MIGRATIONS_DIR = legacy.directory;
    await runMigrations();
    equal("迁移账本精确停在0063", await countMigrations(), legacy.count);
    const columns = await sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('iteration','release') and column_name in ('archived_at','completion_result')`;
    equal("0063计划表尚无四个0064字段", columns.length, 0);
    const marker = randomUUID().replaceAll("-", "").slice(0, 8);
    const [adminRole] = await sql`insert into role(key,name,is_builtin,is_system) values ('ADMIN','管理员',true,true) returning id`;
    const [person] = await sql`insert into member(username,name,status,password_hash)
      values (${`upgrade-${marker}`},'旧库升级管理员','ACTIVE','isolated-service-fixture') returning id`;
    await sql`insert into role_assignment(member_id,role_id,scope_type,scope_id) values (${person!.id},${adminRole!.id},'ORG',null)`;
    const [project] = await sql`insert into project(key,name,created_by) values (${`UP${marker}`},'0063旧项目',${person!.id}) returning id,key`;
    const [wf] = await sql`insert into workflow(project_id,name,applies_to_type,is_default) values (${project!.id},'旧任务工作流','TASK',true) returning id`;
    const [pendingState] = await sql`insert into workflow_state(workflow_id,key,name,category,color) values (${wf!.id},'TODO','待开始','NOT_STARTED','neutral') returning id`;
    const [ongoing] = await sql`insert into workflow_state(workflow_id,key,name,category,color) values (${wf!.id},'IN_PROGRESS','进行中','IN_PROGRESS','blue') returning id`;
    const [terminal] = await sql`insert into workflow_state(workflow_id,key,name,category,color) values (${wf!.id},'DONE','已完成','TERMINAL','green') returning id`;
    await sql`insert into workflow_transition(workflow_id,from_state_id,to_state_id) values (${wf!.id},${pendingState!.id},${ongoing!.id})`;
    const oldCompletion = new Date("2026-10-01T08:00:00.000Z");
    const oldIteration = async (name: string, completedAt: Date | null = null) => (await sql`
      insert into iteration(project_id,name,start_date,end_date,completed_at,carry_over,sort_order)
      values (${project!.id},${name},'2026-10-01','2026-10-14',${completedAt?.toISOString() ?? null},true,7) returning id`)[0]!.id as string;
    const oldRelease = async (name: string, completedAt: Date | null = null) => (await sql`
      insert into release(project_id,name,version_tag,release_date,notes,completed_at,sort_order)
      values (${project!.id},${name},'v0.6.3','2026-10-14','旧版本说明',${completedAt?.toISOString() ?? null},3) returning id`)[0]!.id as string;
    const sourceId = await oldIteration("旧进行中迭代");
    const targetId = await oldIteration("旧目标迭代");
    const completedIterationId = await oldIteration("旧已完成迭代", oldCompletion);
    const releaseId = await oldRelease("旧待完成版本");
    const completedReleaseId = await oldRelease("旧已完成版本", oldCompletion);
    const oldItem = async (number: number, iterationId: string, versionId: string, done = false) => (await sql`
      insert into work_item(project_id,number,key,type,title,description,workflow_id,status_id,iteration_id,release_id,reporter_id,version,completed_at)
      values (${project!.id},${number},${`${project!.key}-${number}`},'TASK',${`旧任务${number}`},'旧描述',${wf!.id},${done ? terminal!.id : pendingState!.id},${iterationId},${versionId},${person!.id},7,${done ? oldCompletion.toISOString() : null}) returning id`)[0]!.id as string;
    const pendingId = await oldItem(1, sourceId, releaseId);
    const finishedId = await oldItem(2, sourceId, releaseId, true);
    const historyId = await oldItem(3, completedIterationId, completedReleaseId, true);
    await sql`update project set next_issue_number = 4 where id = ${project!.id}`;
    await sql`insert into iteration_capacity(iteration_id,member_id,capacity_points,logged_points) values (${sourceId},${person!.id},21.0,8.0)`;
    await sql`insert into work_item_link(source_type,source_id,target_type,target_id) values ('WORK_ITEM',${pendingId},'ITERATION',${sourceId})`;
    const tablesToPreserve = ["iteration", "release", "work_item", "iteration_capacity", "work_item_link"];
    const before = new Map<string, unknown>();
    for (const table of tablesToPreserve) before.set(table, await snapshot(table));
    check("0063已种入开放/完成计划、工作项、容量与引用链接", (before.get("iteration") as unknown[]).length === 3 && (before.get("release") as unknown[]).length === 2 && (before.get("work_item") as unknown[]).length === 3);

    const upgraded = await migrationDirectory(64);
    process.env.MIGRATIONS_DIR = upgraded.directory;
    await runMigrations();
    equal("0064升级只增加一条迁移账本", await countMigrations(), legacy.count + 1);
    for (const table of tablesToPreserve) equal(`${table}全部旧字段与关联升级后逐行不变`, await snapshot(table, table === "iteration" || table === "release"), before.get(table));
    for (const kind of ["iteration", "release"]) {
      const rows = await sql.unsafe(`select archived_at,completion_result from "${kind}"`);
      check(`0064 ${kind}旧数据新增列默认null`, rows.length === (kind === "iteration" ? 3 : 2) && rows.every(row => row.archived_at === null && row.completion_result === null));
    }
    const after64 = [await snapshot("iteration"), await snapshot("release"), await snapshot("work_item")];
    await runMigrations();
    equal("重复执行0064不会增加迁移或覆盖旧数据", [await countMigrations(), await snapshot("iteration"), await snapshot("release"), await snapshot("work_item")], [upgraded.count, ...after64]);

    const approvalColumns = await sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'approval_request' and column_name = 'transition_fields'`;
    equal("0064旧审批表没有字段快照列", approvalColumns.length, 0);
    const [approvalItem] = await sql`insert into work_item(project_id,number,key,type,title,workflow_id,status_id,reporter_id)
      values (${project!.id},4,${`${project!.key}-4`},'TASK','升级前待审批工作项',${wf!.id},${pendingState!.id},${person!.id}) returning id`;
    const [pendingApproval] = await sql`
      insert into approval_request(work_item_id,workflow_id,from_state_id,to_state_id,requested_by,approver_role_keys,status,comment)
      values (${approvalItem!.id},${wf!.id},${pendingState!.id},${ongoing!.id},${person!.id},'["ADMIN"]'::jsonb,'PENDING','旧待审批说明') returning id`;
    const [decidedApproval] = await sql`
      insert into approval_request(work_item_id,workflow_id,from_state_id,to_state_id,requested_by,approver_role_keys,status,comment,decided_by,decided_at)
      values (${historyId},${wf!.id},${pendingState!.id},${terminal!.id},${person!.id},'["ADMIN"]'::jsonb,'APPROVED','旧已审批结论',${person!.id},${oldCompletion.toISOString()}) returning id`;
    await sql`insert into audit_entry(actor_id,action,target_type,target_id,severity)
      values (${person!.id},'approval.requested','WORK_ITEM',${approvalItem!.id},'SECURITY'),
        (${person!.id},'approval.approved','WORK_ITEM',${historyId},'SECURITY')`;
    const oldApprovals = await snapshot("approval_request");
    const oldAudits = await snapshot("audit_entry");
    const oldItems = await snapshot("work_item");
    const approvalUpgrade = await migrationDirectory(65);
    process.env.MIGRATIONS_DIR = approvalUpgrade.directory;
    await runMigrations();
    equal("0065只新增一条迁移账本", await countMigrations(), upgraded.count + 1);
    equal("0065保留所有旧审批字段、状态、决定人和时间", (await sql`select to_jsonb(t) - 'transition_fields' as row from approval_request t order by id`).map(row => row.row), oldApprovals);
    equal("0065保留旧工作项和审计逐行内容", [await snapshot("work_item"), await snapshot("audit_entry")], [oldItems, oldAudits]);
    const approvalDefaults = await sql`select transition_fields from approval_request order by id`;
    check("0065历史审批字段快照默认非null空对象", approvalDefaults.length === 2 && approvalDefaults.every(row => JSON.stringify(row.transition_fields) === "{}"));
    const after65 = [await snapshot("approval_request"), await snapshot("audit_entry"), await snapshot("work_item")];
    await runMigrations();
    equal("重复执行0065保留旧审批与审计", [await countMigrations(), await snapshot("approval_request"), await snapshot("audit_entry"), await snapshot("work_item")], [approvalUpgrade.count, ...after65]);

    // 最新业务服务的副作用依赖完整结构；历史结构阶段只允许SQL读写。
    process.env.MIGRATIONS_DIR = source;
    await runMigrations();
    equal("业务验收前已完成全部当前迁移", await countMigrations(), journal.entries.length);
    await (await import("../src/db/seed-builtin.ts")).seedBuiltin();
    await (await import("../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
    const { loadActor } = await import("../src/server/auth/actor-loader.ts");
    const actor = (await loadActor(person!.id))!;
    const plans = await import("../src/server/services/planning.service.ts");
    const lifecycle = await import("../src/server/services/planning-lifecycle.service.ts");
    const items = await import("../src/server/services/work-item.service.ts");
    for (const kind of ["iteration", "release"] as const) {
      const rows = await plans.list(actor, project!.id, kind);
      check(`${kind}旧数据默认未归档且完成收据为null`, rows.length === (kind === "iteration" ? 3 : 2) && rows.every(row => row.archivedAt === null && row.completionResult === null));
    }
    const oldDone = await plans.get(actor, completedIterationId, "iteration");
    check("旧完成时间与迭代结转设置保留", oldDone.completedAt?.toISOString() === oldCompletion.toISOString() && oldDone.carryOver);
    equal("升级后旧工作项仍可通过业务服务读取原计划关系", [(await items.getWorkItem(actor, pendingId)).iterationId, (await items.getWorkItem(actor, pendingId)).releaseId], [sourceId, releaseId]);
    await rejects("旧未完成迭代仍要求结转目标", () => lifecycle.complete(actor, sourceId, "iteration"));
    const completion = await lifecycle.complete(actor, sourceId, "iteration", { targetIterationId: targetId });
    const moved = await items.getWorkItem(actor, pendingId);
    check("旧迭代完成可结转并持久化新收据", completion.movedCount === 1 && completion.completionResult?.movedWorkItemIds?.[0] === pendingId && moved.iterationId === targetId && moved.version === 8);
    equal("旧终态工作项保留来源迭代", (await items.getWorkItem(actor, finishedId)).iterationId, sourceId);
    const archived = await lifecycle.setArchived(actor, sourceId, "iteration", true);
    check("旧迭代归档后默认列表隐藏且含归档查询可见", !!archived.archivedAt && !(await plans.list(actor, project!.id, "iteration")).some(row => row.id === sourceId) && (await plans.list(actor, project!.id, "iteration", { includeArchived: true })).some(row => row.id === sourceId));
    const restored = await lifecycle.setArchived(actor, sourceId, "iteration", false);
    check("旧迭代恢复保留完成时间与结转收据", restored.archivedAt === null && restored.completedAt?.getTime() === completion.completedAt.getTime() && restored.completionResult?.movedCount === 1);
    await rejects("旧版本有未完成工作项时仍拒绝完成", () => lifecycle.complete(actor, releaseId, "release"));
    // 模拟既有工作流完成；本用例只验迁移与计划生命周期，不改工作流定义。
    await sql`update work_item set status_id = ${terminal!.id}, completed_at = now() where id = ${pendingId}`;
    await rejects("旧未完成版本升级后也须发布候选与交付核验", () => lifecycle.complete(actor, releaseId, "release"));
    await rejects("缺交付核验的旧版本仍不能归档", () => lifecycle.setArchived(actor, releaseId, "release", true));
    const pendingRelease = await plans.get(actor, releaseId, "release");
    check("门禁失败保留旧版本未完成状态", pendingRelease.completedAt === null && pendingRelease.archivedAt === null && pendingRelease.completionResult === null);
    for (const [kind, id] of [["iteration", completedIterationId], ["release", completedReleaseId]] as const) {
      const repeated = await lifecycle.complete(actor, id, kind);
      check(`旧已完成${kind}重复完成返回未知计数且不伪造历史`, repeated.alreadyCompleted && repeated.completedAt.toISOString() === oldCompletion.toISOString()
        && repeated.completionResult.movedCount === null && repeated.completionResult.carriedOverCount === null
        && repeated.completionResult.remainingCount === null && repeated.completionResult.movedWorkItemIds === null);
      await lifecycle.setArchived(actor, id, kind, true);
      const history = await lifecycle.setArchived(actor, id, kind, false);
      check(`旧已完成${kind}可归档恢复且保持原完成时间`, history.archivedAt === null && history.completedAt?.toISOString() === oldCompletion.toISOString() && history.completionResult === null);
    }
    equal("历史工作项归属不受归档恢复影响", [(await items.getWorkItem(actor, historyId)).iterationId, (await items.getWorkItem(actor, historyId)).releaseId], [completedIterationId, completedReleaseId]);
    equal("容量历史和引用链接在生命周期操作后仍完整", [await snapshot("iteration_capacity"), await snapshot("work_item_link")], [before.get("iteration_capacity"), before.get("work_item_link")]);
    const approvals = await import("../src/server/services/approval.service.ts");
    const pendingRows = await approvals.listForItem(actor, approvalItem!.id);
    const decidedRows = await approvals.listForItem(actor, historyId);
    check("历史待审批和已处理审批默认字段快照为非null空对象", pendingRows[0]?.status === "PENDING" && decidedRows[0]?.status === "APPROVED" && JSON.stringify(pendingRows[0]?.transitionFields) === "{}" && JSON.stringify(decidedRows[0]?.transitionFields) === "{}");
    const decision = await approvals.decide(actor, pendingApproval!.id as string, "approve", "升级后继续处理");
    check("旧待审批升级后可继续审批并完成无必填字段流转", decision.status === "APPROVED" && (await items.getWorkItem(actor, approvalItem!.id)).statusId === ongoing!.id);
    const historicalDecision = (await approvals.listForItem(actor, historyId)).find(row => row.id === decidedApproval!.id);
    check("旧已处理审批在后续操作后仍保留原结论", historicalDecision?.comment === "旧已审批结论" && historicalDecision.decidedAt?.toISOString() === oldCompletion.toISOString());
    const afterApproval = [await snapshot("approval_request"), await snapshot("audit_entry"), await snapshot("work_item")];
    await runMigrations();
    equal("重复执行完整迁移保留新旧审批与审计", [await countMigrations(), await snapshot("approval_request"), await snapshot("audit_entry"), await snapshot("work_item")], [journal.entries.length, ...afterApproval]);
    console.log(`计划旧数据升级验收 ${checks.length}/${checks.length}`);
  } catch (error) { failure = String(error); throw error; }
  finally {
    if (process.env.FERONAVI_PLAN_UPGRADE_REPORT) await writeFile(process.env.FERONAVI_PLAN_UPGRADE_REPORT, JSON.stringify({ database: process.env.FERONAVI_TEST_DATABASE, from: "0063", to: journal.entries.at(-1)?.tag, historicalCheckpoints: ["0063", "0064", "0065"], checks, failure }, null, 2));
    await sql.end({ timeout: 5 });
  }
}
