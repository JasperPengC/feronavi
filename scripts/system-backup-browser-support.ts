import "./_env.ts";
import assert from "node:assert/strict";
import { sql } from "../src/db/index.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";

// 仅浏览器验收调用：真实worker与目标派生写故障，不替代任何HTTP响应。
try {
  registerBuiltinJobHandlers();
  if (process.argv[2] === "rebuild-failure") {
    await sql`update job set max_attempts=1 where kind='restore.rebuild' and status='PENDING'`;
    await sql.unsafe(
      `CREATE FUNCTION browser_rebuild_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_REBUILD_FAULT'; END $$`,
    );
    await sql.unsafe(
      `CREATE TRIGGER browser_rebuild_fault BEFORE INSERT ON page_chunk FOR EACH ROW EXECUTE FUNCTION browser_rebuild_fault()`,
    );
    try {
      await runJobWorkerOnce("browser-acceptance", 1);
      const [job] =
        await sql`select status from job where kind='restore.rebuild' order by created_at desc limit 1`;
      assert.equal(job!.status, "DEAD");
      console.log(
        "PASS real rebuild fault: derived transaction failed; retryable terminal job",
      );
    } finally {
      await sql.unsafe(`DROP TRIGGER browser_rebuild_fault ON page_chunk`);
      await sql.unsafe(`DROP FUNCTION browser_rebuild_fault()`);
    }
  } else {
    const result = await runJobWorkerOnce(
      "browser-acceptance",
      process.argv[2] === "backup" ? 10 : 1,
    );
    console.log(`PASS real worker: ${JSON.stringify(result)}`);
    if (process.argv[2] === "backup") {
      const rows = await sql`
        select mode, status, bytes, download_count
        from system_backup order by created_at desc limit 5
      `;
      console.log(`BACKUP_WORKER_RECORDS ${JSON.stringify(rows)}`);
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
