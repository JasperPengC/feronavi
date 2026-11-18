/**
 * 运维状态聚合（Round 25 长任务第 27 项）
 *
 * 把散落在各轮的后台能力搬到系统页：webhook 死信/待重试、保留期、集成、功能开关、MCP 客户端与
 * 三个调度器的当前间隔。**只读聚合**，不提供任何会改变状态的按钮。
 */
import { gte, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { activityEntry, auditEntry, featureFlag, integration, knowledgeQueryLog, mcpClient, mcpToolPolicy, webhookDelivery, webhookEndpoint } from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { exportPackageStats, resolveRetentionConfig } from "./retention.service.ts";
import { listJobCounts } from "./job.service.ts";

function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

export async function operationsStatus(actor: Actor) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();

  const since30d = new Date(Date.now() - 30 * 86_400_000);
  const [deliveryRows, endpointCount, integrationRows, flagRows, mcpRows, policyCount, auditCount, activityCount, knowledgeRows, retention, exportStats, jobs] = await Promise.all([
    db.select({ status: webhookDelivery.status, n: sql<number>`count(*)::int` }).from(webhookDelivery).groupBy(webhookDelivery.status),
    db.select({ n: sql<number>`count(*)::int` }).from(webhookEndpoint),
    db.select({ isActive: integration.isActive, n: sql<number>`count(*)::int` }).from(integration).groupBy(integration.isActive),
    db.select({ enabled: featureFlag.enabled, n: sql<number>`count(*)::int` }).from(featureFlag).groupBy(featureFlag.enabled),
    db.select({ clients: sql<number>`count(*)::int`, calls: sql<number>`coalesce(sum(${mcpClient.callCount}), 0)::int` }).from(mcpClient),
    db.select({ n: sql<number>`count(*)::int` }).from(mcpToolPolicy),
    db.select({ n: sql<number>`count(*)::int` }).from(auditEntry),
    db.select({ n: sql<number>`count(*)::int` }).from(activityEntry),
    db.select({ n: sql<number>`count(*)::int` }).from(knowledgeQueryLog).where(gte(knowledgeQueryLog.createdAt, since30d)),
    resolveRetentionConfig(),
    exportPackageStats(),
    listJobCounts(),
  ]);
  const delivery = (status: string) => deliveryRows.find((r) => r.status === status)?.n ?? 0;
  const integrations = integrationRows.reduce((s, r) => s + r.n, 0);
  const flags = flagRows.reduce((s, r) => s + r.n, 0);

  return {
    generatedAt: new Date().toISOString(),
    webhooks: {
      endpoints: endpointCount[0]?.n ?? 0,
      pending: delivery("PENDING"),
      retrying: delivery("RETRYING"),
      dead: delivery("DEAD"),
      succeeded: delivery("SUCCEEDED"),
    },
    retention: {
      auditDays: retention.auditDays, activityDays: retention.activityDays, auditRows: auditCount[0]?.n ?? 0, activityRows: activityCount[0]?.n ?? 0,
      exportHours: retention.exportHours, exportFiles: exportStats.files, exportBytes: exportStats.bytes,
    },
    integrations: { total: integrations, active: integrationRows.find((r) => r.isActive)?.n ?? 0 },
    featureFlags: { total: flags, enabled: flagRows.find((r) => r.enabled)?.n ?? 0 },
    mcp: { clients: mcpRows[0]?.clients ?? 0, calls: mcpRows[0]?.calls ?? 0, policies: policyCount[0]?.n ?? 0 },
    knowledge: { queries30d: knowledgeRows[0]?.n ?? 0 },
    jobs,
    schedulers: {
      snapshotIntervalMs: envMs("SNAPSHOT_INTERVAL_MS", 3_600_000),
      retentionSweepIntervalMs: envMs("RETENTION_SWEEP_INTERVAL_MS", 86_400_000),
      webhookRetryIntervalMs: envMs("WEBHOOK_RETRY_INTERVAL_MS", 30_000),
      integrationSyncIntervalMs: envMs("INTEGRATION_SYNC_INTERVAL_MS", 21_600_000),
      jobWorkerIntervalMs: envMs("JOB_WORKER_INTERVAL_MS", 5_000),
    },
  };
}

