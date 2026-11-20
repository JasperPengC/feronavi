import "./_env.ts";
/** 成熟度整改回归：仅由随机数据库 runner 启动，不连接现有预览。 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { automationRule, automationRun, idea, member, role, roleAssignment } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { createProject } from "../src/server/services/project.service.ts";
import * as ideas from "../src/server/services/idea.service.ts";
import * as automation from "../src/server/services/automation.service.ts";
import { createWorkItem } from "../src/server/services/work-item.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

let checks = 0;
const failures: string[] = [];
async function check(label: string, run: () => Promise<void>) {
  try { await run(); checks++; console.log(`OK ${label}`); }
  catch (error) { failures.push(label); console.error(`FAIL ${label}: ${(error as Error).message}`); }
}
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [admin] = await db.insert(member).values({ username: "remediation-admin", email: "remediation@test.invalid", name: "整改回归", passwordHash: "unused", status: "ACTIVE" }).returning();
  await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(admin!.id))!;
  const project = await createProject(actor, { key: "REMEDIATE", name: "业务整改回归" });
  const mode = process.argv[2] ?? "all";

  if (mode === "all" || mode === "idea") {
    // 真实 PostgreSQL 故障覆盖回填、活动、第二条引用，证明整个操作回滚。
    await sql.unsafe(`create table remediation_fault (stage text not null);
      create function remediation_fail() returns trigger language plpgsql as $$
      begin
        if exists(select 1 from remediation_fault where stage = TG_ARGV[0]) then
          if TG_TABLE_NAME <> 'activity_entry' or NEW.action = 'idea.promoted' then
            raise exception 'injected remediation fault';
          end if;
        end if;
        return NEW;
      end $$;
      create trigger remediation_idea before update on idea for each row execute function remediation_fail('backfill');
      create trigger remediation_activity before insert on activity_entry for each row execute function remediation_fail('activity');
      create trigger remediation_link before insert on work_item_link for each row when (NEW.source_type = 'IDEA') execute function remediation_fail('links');`);
    for (const stage of ["backfill", "activity", "links"]) {
      await check(`想法转换 ${stage} 故障整体回滚且可重试`, async () => {
        const item = (await ideas.createIdea(actor, project.id, { title: `fault-${stage}` }))!;
        await sql`insert into remediation_fault values (${stage})`;
        try { await assert.rejects(() => ideas.promote(actor, item.id)); }
        finally { await sql`delete from remediation_fault`; }
        const [snapshot] = await sql`select (select count(*)::int from work_item where title = ${item.title}) as items,
          (select count(*)::int from activity_entry where target_id = ${item.id} and action = 'idea.promoted') as activities,
          (select count(*)::int from work_item_link where source_id = ${item.id} or target_id = ${item.id}) as links`;
        assert.deepEqual(snapshot, { items: 0, activities: 0, links: 0 });
        const [unchanged] = await db.select().from(idea).where(eq(idea.id, item.id));
        assert.equal(unchanged!.status, "NEW"); assert.equal(unchanged!.promotedWorkItemId, null);
        const retried = await ideas.promote(actor, item.id);
        assert.ok(retried.workItem); assert.equal(retried.alreadyPromoted, false);
      });
    }
    await check("同一想法并发转换仅一个工作项、一个活动与两条引用", async () => {
      const item = (await ideas.createIdea(actor, project.id, { title: "concurrent-promote" }))!;
      const results = await Promise.all(Array.from({ length: 6 }, () => ideas.promote(actor, item.id)));
      assert.equal(new Set(results.map((r) => r.workItem!.id)).size, 1);
      assert.equal(results.filter((r) => !r.alreadyPromoted).length, 1);
      const [counts] = await sql`select (select count(*)::int from work_item where title = ${item.title}) as items,
        (select count(*)::int from activity_entry where target_id = ${item.id} and action = 'idea.promoted') as activities,
        (select count(*)::int from work_item_link where source_id = ${item.id} or target_id = ${item.id}) as links`;
      assert.deepEqual(counts, { items: 1, activities: 1, links: 2 });
    });
  }

  if (mode === "all" || mode === "conditions") {
    const item = (await createWorkItem(actor, project.id, { type: "TASK", title: "condition-target", priority: "LOW" }))!;
    const yes = { field: "title", op: "eq", value: item.title };
    const no = { field: "title", op: "eq", value: "absent" };
    const cases = [
      { name: "all全部满足", conditions: { all: [yes, yes] }, expected: true },
      { name: "all任一失败", conditions: { all: [yes, no] }, expected: false },
      { name: "any任一满足", conditions: { any: [no, yes] }, expected: true },
      { name: "any全部失败", conditions: { any: [no, no] }, expected: false },
      { name: "all与any组合满足", conditions: { all: [yes], any: [no, yes] }, expected: true },
      { name: "all失败压过any", conditions: { all: [no], any: [yes] }, expected: false },
      { name: "空条件", conditions: {}, expected: true },
      { name: "空分组", conditions: { all: [], any: [] }, expected: true },
      { name: "空any不限制all", conditions: { all: [yes], any: [] }, expected: true },
    ];
    let minute = 0;
    for (const test of cases) {
      await check(`条件 ${test.name} 在预演、事件、定时保持一致`, async () => {
        const dry = await automation.testRule(actor, project.id, test, item.id);
        assert.equal(dry.matched, test.expected, "dry-run");
        for (const trigger of ["WORK_ITEM_UPDATED", "SCHEDULE"] as const) {
          const rule = await automation.createRule(actor, project.id, { name: test.name, trigger, conditions: test.conditions, actions: [{ type: "NOTIFY", memberIds: [] }], scheduleCron: "* * * * *", scheduleTimezone: "UTC" });
          if (trigger === "SCHEDULE") await automation.runScheduledAutomations(new Date(Date.UTC(2026, 10, 15, 12, minute++)));
          else await automation.triggerAutomation(trigger, item.id);
          const runs = await db.select().from(automationRun).where(and(eq(automationRun.ruleId, rule.id), eq(automationRun.workItemId, item.id)));
          assert.equal(runs.length, test.expected ? 1 : 0, trigger);
          await db.update(automationRule).set({ enabled: false }).where(eq(automationRule.id, rule.id));
        }
      });
    }
  }

  if (mode === "all" || mode === "schedule") {
    const p = await createProject(actor, { key: "PAGING", name: "多批次定时回归" });
    const seed = (await createWorkItem(actor, p.id, { type: "TASK", title: "page-seed" }))!;
    await sql`insert into work_item (project_id, number, key, type, title, workflow_id, status_id, reporter_id)
      select ${p.id}, n, 'PAGING-' || n, 'TASK', 'page-' || n, ${seed.workflowId}, ${seed.statusId}, ${actor.memberId}
      from generate_series(2, 1003) n`;
    const rule = await automation.createRule(actor, p.id, { name: "覆盖全部批次", trigger: "SCHEDULE", conditions: {}, actions: [{ type: "ADD_COMMENT", body: "paged-schedule-effect" }], scheduleCron: "* * * * *", scheduleTimezone: "UTC" });
    const now = new Date("2026-11-15T15:00:00.000Z");
    await check("定时分页公平覆盖1003项并发抢占不重复", async () => {
      const results = await Promise.all([automation.runScheduledAutomations(now), automation.runScheduledAutomations(now)]);
      assert.equal(results.reduce((n, result) => n + result.items, 0), 1003);
      const [counts] = await sql`select count(*)::int as total, count(distinct work_item_id)::int as unique_items from automation_run where rule_id = ${rule.id}`;
      assert.deepEqual(counts, { total: 1003, unique_items: 1003 });
      const [effects] = await sql`select count(*)::int as total, count(distinct target_id)::int as unique_items from comment where body = 'paged-schedule-effect'`;
      assert.deepEqual(effects, { total: 1003, unique_items: 1003 });
    });
    await check("同分钟晚于30秒重试不重复动作，下分钟覆盖所有批次", async () => {
      assert.equal((await automation.runScheduledAutomations(new Date(now.getTime() + 45_000))).items, 0);
      assert.equal((await automation.runScheduledAutomations(new Date(now.getTime() + 60_000))).items, 1003);
      const [counts] = await sql`select count(*)::int as total, count(distinct work_item_id)::int as unique_items from automation_run where rule_id = ${rule.id}`;
      assert.deepEqual(counts, { total: 2006, unique_items: 1003 });
      const [effects] = await sql`select count(*)::int as total, count(distinct target_id)::int as unique_items from comment where body = 'paged-schedule-effect'`;
      assert.deepEqual(effects, { total: 2006, unique_items: 1003 });
    });
    await check("批首动作失败不阻断剩余1002项且同分钟重试不重复成功动作", async () => {
      const [first] = await sql`select id from work_item where project_id = ${p.id} order by id limit 1`;
      await sql.unsafe(`create function remediation_comment_fail() returns trigger language plpgsql as $$
        begin if NEW.target_id = '${first!.id}' then raise exception 'injected action failure'; end if; return NEW; end $$;
        create trigger remediation_comment before insert on comment for each row execute function remediation_comment_fail();`);
      const next = new Date(now.getTime() + 120_000);
      try {
        assert.equal((await automation.runScheduledAutomations(next)).items, 1003);
        assert.equal((await automation.runScheduledAutomations(next)).items, 0);
      } finally { await sql.unsafe('drop trigger remediation_comment on comment; drop function remediation_comment_fail()'); }
      const [counts] = await sql`select count(*)::int as total, count(*) filter (where status = 'FAILED')::int as failed from automation_run where rule_id = ${rule.id}`;
      assert.deepEqual(counts, { total: 3009, failed: 1 });
      const [effects] = await sql`select count(*)::int as total from comment where body = 'paged-schedule-effect'`;
      assert.equal(effects!.total, 3008);
    });
  }
  console.log(`结果：${checks} 通过 / ${failures.length} 失败`);
  process.exitCode = failures.length ? 1 : 0;
} finally { await closeCache(); await sql.end(); }
