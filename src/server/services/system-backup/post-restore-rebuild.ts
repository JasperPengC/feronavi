import { z } from "zod";
import { db, sql } from "../../../db/index.ts";
import { DomainError } from "../../../shared/errors.ts";
import type { PostRestoreRebuildSummary } from "../../../shared/schemas/system-backup.ts";
import { enqueue } from "../job.service.ts";
import { loadActor } from "../../auth/actor-loader.ts";
import {
  activeGeneration,
  loadAiConfig,
  reindexPage,
  withKnowledgeIndexLock,
} from "../knowledge.service.ts";
import { snapshotIteration } from "../insight.service.ts";

const messages = {
  NOT_STARTED: "数据已恢复，索引重建尚未开始",
  PENDING: "数据已恢复，索引重建等待中",
  RUNNING: "数据已恢复，索引重建中",
  SUCCEEDED: "数据已恢复，索引重建完成",
  FAILED: "数据已恢复，索引重建失败",
} as const;
const missing = () => new DomainError("NOT_FOUND", "恢复重建记录不存在", null);

/** 只有精确匹配目标提交证明的包才能重建；不以任意initialized推断恢复成功。 */
async function committedRestore(packageId: string, lock = false) {
  z.string().uuid().parse(packageId);
  const rows =
    await sql`select r.id, r.rebuild_job_id, r.rebuild_completed_at from system_restore r
    where r.package_id=${packageId} and r.status='SUCCEEDED'
      and exists (select 1 from setup_state s where s.initialized_at is not null and s.restored_package_id=r.package_id)
    order by r.completed_at desc limit 1 ${lock ? sql`for update of r` : sql``}`;
  if (!rows[0]) throw missing();
  return rows[0] as {
    id: string;
    rebuild_job_id: string | null;
    rebuild_completed_at: Date | null;
  };
}

export async function getPostRestoreRebuildSummary(
  packageId: string,
): Promise<PostRestoreRebuildSummary> {
  const record = await committedRestore(packageId);
  const [row] = record.rebuild_job_id
    ? await sql`select status from job where id=${record.rebuild_job_id} and kind='restore.rebuild' and payload=jsonb_build_object('packageId',${packageId}::text)`
    : [];
  const status: PostRestoreRebuildSummary["status"] =
    record.rebuild_completed_at
      ? "SUCCEEDED"
      : !row
        ? "NOT_STARTED"
        : row.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : row.status === "PENDING"
            ? "PENDING"
            : row.status === "RUNNING"
              ? "RUNNING"
              : "FAILED";
  return {
    status,
    message: messages[status],
    canRetry: status === "NOT_STARTED" || status === "FAILED",
  };
}

/** Exposes only the package proved committed by this instance's setup marker. */
export async function getCurrentPostRestoreRebuild(): Promise<{
  packageId: string;
  rebuild: PostRestoreRebuildSummary;
} | null> {
  const [current] = await sql`
    select s.restored_package_id as "packageId"
    from setup_state s
    join system_restore r on r.package_id=s.restored_package_id and r.status='SUCCEEDED'
    where s.initialized_at is not null and s.restored_package_id is not null
    order by s.initialized_at desc
    limit 1
  `;
  if (!current) return null;
  return {
    packageId: current.packageId,
    rebuild: await getPostRestoreRebuildSummary(current.packageId),
  };
}

async function enqueueRebuild(
  packageId: string,
  retry: boolean,
): Promise<void> {
  // 活跃重建持有恢复行锁；已有任务只读即可，避免阻塞其他worker的启动协调。
  const existing = await committedRestore(packageId);
  if (existing.rebuild_completed_at) return;
  if (existing.rebuild_job_id) {
    if (!retry || !(await getPostRestoreRebuildSummary(packageId)).canRetry)
      return;
  }
  await db.transaction(async () => {
    const record = await committedRestore(packageId, true);
    if (record.rebuild_completed_at) return;
    if (record.rebuild_job_id) {
      const current = await getPostRestoreRebuildSummary(packageId);
      if (!retry || !current.canRetry) return;
    }
    const queued = await enqueue({
      kind: "restore.rebuild",
      payload: { packageId },
      dedupeKey: `restore.rebuild:${packageId}`,
      maxAttempts: 1,
    });
    if (!queued) throw new Error("RESTORE_REBUILD_FAILED");
    await sql`update system_restore set rebuild_job_id=${queued.id},updated_at=now() where id=${record.id}`;
  });
}

export async function enqueuePostRestoreRebuilds(
  packageId: string,
): Promise<void> {
  await enqueueRebuild(packageId, false);
}
export async function retryPostRestoreRebuilds(
  packageId: string,
): Promise<PostRestoreRebuildSummary> {
  await enqueueRebuild(packageId, true);
  return getPostRestoreRebuildSummary(packageId);
}

/** 已提交数据不再进入恢复失败分支；补队失败仅固定告警，启动/管理员可重试。 */
export async function ensurePostRestoreRebuilds(
  packageId: string,
): Promise<void> {
  try {
    await enqueuePostRestoreRebuilds(packageId);
  } catch {
    console.error("系统恢复重建入队失败", { code: "RESTORE_REBUILD_FAILED" });
  }
}

export async function runPostRestoreRebuild(
  payload: Record<string, unknown>,
  jobId: string,
): Promise<void> {
  const { packageId } = z
    .strictObject({ packageId: z.string().uuid() })
    .parse(payload);
  try {
    // 完成证明与派生结果同事务提交，队列回执失败或处理器重入不能重复计费。
    if ((await committedRestore(packageId)).rebuild_completed_at) return;
    await withKnowledgeIndexLock(() =>
      db.transaction(async () => {
        const record = await committedRestore(packageId, true);
        if (record.rebuild_completed_at || record.rebuild_job_id !== jobId)
          return;
        const [admin] =
          await sql`select m.id from member m join role_assignment a on a.member_id=m.id
        join role r on r.id=a.role_id where m.status='ACTIVE' and m.anonymized_at is null
          and a.scope_type='ORG' and a.scope_id is null and r.key='ADMIN' order by m.id limit 1`;
        const actor = admin && (await loadActor(admin.id));
        if (!actor) throw new Error("RESTORE_REBUILD_FAILED");
        // 从目标派生数据选择新代，不信任包中源generation控制值。
        const [last] =
          await sql`select coalesce(max(generation),0)::int as n from page_chunk`;
        const generation = Math.max(await activeGeneration(), last!.n) + 1;
        const aiEnabled = !!(await loadAiConfig());
        const pages =
          await sql`select id from page where deleted_at is null and current_revision_id is not null order by id`;
        for (const page of pages) {
          const result = await reindexPage(actor, page.id, "FULL", {
            generation,
            activate: false,
            // safe 恢复会停用 AI；关键词分块仍应成功，不应被来源 embedding 配额阻断。
            skipEmbedding: !aiEnabled,
          });
          if (
            result.failed ||
            (aiEnabled && result.embedded !== result.inserted)
          )
            throw new Error("RESTORE_REBUILD_FAILED");
          await sql`update page p set search_vector=to_tsvector('chinese_zh',p.title || E'\n' || r.content) from page_revision r where p.id=${page.id} and r.id=p.current_revision_id`;
        }
        for (const iteration of await sql`select id from iteration order by id`)
          await snapshotIteration(iteration.id);
        await sql`update index_job set activated_at=now() where generation=${generation} and status='SUCCEEDED'`;
        await sql`insert into setting(key,value,is_secret) values ('knowledge.active_generation',${JSON.stringify(generation)}::jsonb,false)
        on conflict(key) do update set value=excluded.value,updated_at=now()`;
        await sql`update system_restore set rebuild_completed_at=now(),updated_at=now() where id=${record.id}`;
      }),
    );
  } catch {
    throw new Error("RESTORE_REBUILD_FAILED");
  }
}
