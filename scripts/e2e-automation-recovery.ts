import "./_env.ts";
/** 真实PG日志故障与进程SIGKILL后恢复稀疏cron；只使用runner随机库。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { createProject } from "../src/server/services/project.service.ts";
import { createWorkItem } from "../src/server/services/work-item.service.ts";
import { createRule, runScheduledAutomations } from "../src/server/services/automation.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

if (process.argv.includes("--child")) {
  try { await runScheduledAutomations(new Date(process.argv.at(-1)!)); }
  finally { await closeCache(); await sql.end(); }
} else {
  let passed = 0;
  try {
    await ensureInitialized();
    const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
    const [admin] = await db.insert(member).values({ username: "recovery-admin", name: "恢复测试", passwordHash: "unused", status: "ACTIVE" }).returning();
    await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG" });
    const actor = (await loadActor(admin!.id))!;
    for (const mode of ["log-failure", "process-kill", "scan-failure"]) {
      const project = await createProject(actor, { key: mode === "log-failure" ? "LOGREC" : mode === "process-kill" ? "KILLREC" : "SCANREC", name: mode });
      const seed = (await createWorkItem(actor, project.id, { type: "TASK", title: "seed" }))!;
      await sql`insert into work_item (project_id, number, key, type, title, workflow_id, status_id, reporter_id)
        select ${project.id}, n, ${project.key} || '-' || n, 'TASK', 'recovery-' || n, ${seed.workflowId}, ${seed.statusId}, ${actor.memberId}
        from generate_series(2, 502) n`;
      const rule = await createRule(actor, project.id, { name: mode, trigger: "SCHEDULE", conditions: {}, actions: [{ type: "ADD_COMMENT", body: mode }], scheduleCron: "0 0 * * *", scheduleTimezone: "UTC" });
      const now = mode === "log-failure" ? "2026-11-15T00:00:00.000Z" : "2026-11-16T00:00:00.000Z";
      const [target] = await sql`select id from work_item where project_id=${project.id} order by id offset 500 limit 1`;
      if (mode === "scan-failure") await sql.unsafe("alter table work_item rename column title to injected_missing_title");
      else await sql.unsafe(`create function schedule_recovery_fault() returns trigger language plpgsql as $$ begin
        if NEW.work_item_id = '${target!.id}' then
          ${mode === "log-failure" ? "raise exception 'injected schedule log failure';" : "perform pg_advisory_xact_lock(987623); perform pg_sleep(30);"}
        end if; return NEW; end $$;
        create trigger schedule_recovery_fault before insert on automation_run for each row execute function schedule_recovery_fault();`);
      try {
        if (mode !== "process-kill") await runScheduledAutomations(new Date(now));
        else {
          const child = spawn(process.execPath, ["scripts/e2e-automation-recovery.ts", "--child", now], { env: process.env, stdio: "ignore" });
          const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
          try {
            let blocked = false;
            for (let n = 0; n < 200; n++) {
              const [lock] = await sql`select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid=l.pid
                where a.datname=current_database() and l.locktype='advisory' and l.objid=987623 and l.granted`;
              if (lock!.n) { blocked = true; break; }
              if (child.exitCode !== null) break;
              await delay(100);
            }
            assert.ok(blocked, "子进程须已提交首批并进入第二批注错点");
          } finally { child.kill("SIGKILL"); await exited; }
        }
      } finally {
        if (mode === "scan-failure") await sql.unsafe("alter table work_item rename column injected_missing_title to title");
        else await sql.unsafe("drop trigger schedule_recovery_fault on automation_run; drop function schedule_recovery_fault()");
      }
      const before = (await sql`select count(*)::int as n from comment where body=${mode}`)[0]!.n;
      // 次日午夜任务已过触发分钟；恢复只能来自持久进度，不能依赖cron再度命中。
      const child = spawn(process.execPath, ["scripts/e2e-automation-recovery.ts", "--child", now.replace("00:00:00", "00:01:00")], { env: process.env, stdio: "ignore" });
      const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
      assert.equal(code, 0);
      const [counts] = await sql`select count(*)::int as n, count(distinct target_id)::int as unique_items from comment where body=${mode}`;
      assert.deepEqual(counts, { n: 502, unique_items: 502 }, `${mode}：所有项完成且不重放已成功评论，故障前=${before}`);
      const [runs] = await sql`select count(*)::int as n from automation_run where rule_id=${rule.id} and work_item_id is not null`;
      assert.equal(runs!.n, 502, "动作与逐项日志必须共同提交");
      await runScheduledAutomations(new Date(now.replace("00:00:00", "00:02:00")));
      assert.equal((await sql`select count(*)::int as n from comment where body=${mode}`)[0]!.n, 502);
      await sql`update automation_rule set enabled=false where id=${rule.id}`;
      passed++; console.log(`PASS ${mode}: 稀疏cron次分钟进程恢复502项，动作/日志一致且不重复`);
    }
    const project = await createProject(actor, { key: "OUTBOX", name: "Webhook事务出站" });
    const item = (await createWorkItem(actor, project.id, { type: "TASK", title: "outbox-item" }))!;
    const [endpoint] = await sql`insert into webhook_endpoint (project_id,name,url,secret_encrypted,events)
      values (${project.id},'queued-only','https://example.invalid/never-contacted','unused','["automation.rule"]'::jsonb) returning id`;
    const rule = await createRule(actor, project.id, { name: "outbox", trigger: "SCHEDULE", conditions: {}, actions: [{ type: "CALL_WEBHOOK" }], scheduleCron: "0 0 * * *", scheduleTimezone: "UTC" });
    await sql.unsafe(`create function outbox_log_fault() returns trigger language plpgsql as $$ begin
      if NEW.work_item_id='${item.id}' then raise exception 'outbox log failure'; end if; return NEW; end $$;
      create trigger outbox_log_fault before insert on automation_run for each row execute function outbox_log_fault();`);
    try { await runScheduledAutomations(new Date("2026-11-17T00:00:00Z")); }
    finally { await sql.unsafe("drop trigger outbox_log_fault on automation_run; drop function outbox_log_fault()"); }
    assert.equal((await sql`select count(*)::int as n from webhook_delivery where endpoint_id=${endpoint!.id}`)[0]!.n, 0, "日志失败必须回滚投递记录");
    assert.equal((await sql`select count(*)::int as n from job where kind='webhook.attempt'`)[0]!.n, 0, "日志失败必须回滚待投递任务");
    await runScheduledAutomations(new Date("2026-11-17T00:01:00Z"));
    await runScheduledAutomations(new Date("2026-11-17T00:02:00Z"));
    const [delivery] = await sql`select id,status,attempts from webhook_delivery where endpoint_id=${endpoint!.id}`;
    assert.equal(delivery!.status, "PENDING"); assert.equal(delivery!.attempts, 0, "提交前不发外部HTTP");
    assert.equal((await sql`select count(*)::int as n from automation_run where rule_id=${rule.id} and work_item_id=${item.id}`)[0]!.n, 1);
    const jobs = await sql`select * from job where kind='webhook.attempt' and payload->>'deliveryId'=${delivery!.id}`;
    assert.equal(jobs.length, 1, "恢复后只建立一个持久出站任务");
    assert.equal((await sql`select count(*)::int as n from webhook_delivery where endpoint_id=${endpoint!.id}`)[0]!.n, 1);
    await sql`update webhook_delivery set status='SUCCEEDED', attempts=1, response_code=200 where id=${delivery!.id}`;
    const { attemptDelivery } = await import("../src/server/services/webhook.service.ts");
    let contacted = false;
    assert.equal((await attemptDelivery(delivery!.id, { fetchImpl: async () => { contacted = true; throw new Error("must not contact"); } })).ok, true);
    assert.equal(contacted, false, "成功投递回执重试不能重复联系外部接收端");
    passed++; console.log("PASS webhook outbox: 日志故障共同回滚，次分钟恢复唯一任务，成功回执重试不重发");
    console.log(`自动化持久恢复 ${passed}/4 通过`);
  } finally { await closeCache(); await sql.end(); }
}
