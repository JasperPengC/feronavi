/** 连接工具的项目归属与最小响应：凭据既不输出，也不进入幂等响应缓存。 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { webhookDelivery } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as integrations from "./integration.service.ts";
import * as sync from "./integration-sync.service.ts";
import * as webhook from "./webhook.service.ts";

export function integrationStatus(row: integrations.IntegrationView) {
  const {
    id,
    projectId,
    kind,
    name,
    isActive,
    hasToken,
    createdAt,
    updatedAt,
  } = row;
  return {
    id,
    projectId,
    kind,
    name,
    isActive,
    hasToken,
    createdAt,
    updatedAt,
  };
}
export async function assertIntegration(
  actor: Actor,
  projectId: string,
  integrationId: string,
) {
  const found = (await integrations.listIntegrations(actor, projectId)).find(
    (i) => i.id === integrationId,
  );
  if (!found) throw new DomainError("NOT_FOUND", "资源不存在", null);
  return found;
}
export async function createIntegration(
  actor: Actor,
  input: Parameters<typeof integrations.createIntegration>[1],
) {
  return integrationStatus(await integrations.createIntegration(actor, input));
}
export async function updateIntegration(
  actor: Actor,
  projectId: string,
  integrationId: string,
  input: Parameters<typeof integrations.updateIntegration>[2],
) {
  await assertIntegration(actor, projectId, integrationId);
  // projectId 是资源边界，更新不开放移动归属。
  const { projectId: _projectId, ...patch } = input;
  return integrationStatus(
    await integrations.updateIntegration(actor, integrationId, patch),
  );
}
export async function deleteIntegration(
  actor: Actor,
  projectId: string,
  integrationId: string,
) {
  await assertIntegration(actor, projectId, integrationId);
  await integrations.deleteIntegration(actor, integrationId);
  return { ok: true };
}
export async function syncStatus(
  actor: Actor,
  projectId: string,
  integrationId: string,
) {
  const row = await assertIntegration(actor, projectId, integrationId);
  const cursor = await sync.getSyncCursor(actor, integrationId);
  return {
    integrationId,
    projectId,
    isActive: row.isActive,
    hasToken: row.hasToken,
    entity: cursor?.entity ?? null,
    lastSyncedAt: cursor?.lastSyncedAt ?? null,
  };
}
export async function syncIntegration(
  actor: Actor,
  projectId: string,
  integrationId: string,
) {
  await assertIntegration(actor, projectId, integrationId);
  const result = await sync.syncIntegration(actor, integrationId);
  // 不回显外部游标、仓库配置或服务原始响应。
  const { fetched, synced, skipped, pulls, reviews, members } = result;
  return {
    integrationId,
    projectId,
    fetched,
    synced,
    skipped,
    pulls,
    reviews,
    members,
  };
}
export async function assertEndpoint(
  actor: Actor,
  projectId: string,
  endpointId: string,
) {
  const found = (await webhook.listEndpoints(actor, projectId)).find(
    (e) => e.id === endpointId,
  );
  if (!found) throw new DomainError("NOT_FOUND", "资源不存在", null);
  return found;
}
export async function updateEndpoint(
  actor: Actor,
  projectId: string,
  endpointId: string,
  patch: Parameters<typeof webhook.updateEndpoint>[2],
) {
  await assertEndpoint(actor, projectId, endpointId);
  return webhook.updateEndpoint(actor, endpointId, patch);
}
export async function deleteEndpoint(
  actor: Actor,
  projectId: string,
  endpointId: string,
) {
  await assertEndpoint(actor, projectId, endpointId);
  await webhook.deleteEndpoint(actor, endpointId);
  return { ok: true };
}
export async function deliveries(
  actor: Actor,
  projectId: string,
  endpointId: string,
  status?: string,
) {
  await assertEndpoint(actor, projectId, endpointId);
  return (await webhook.listDeliveries(actor, endpointId, { status })).map(
    ({
      id,
      endpointId,
      event,
      status,
      attempts,
      responseCode,
      nextRetryAt,
      createdAt,
      finishedAt,
    }) => ({
      id,
      endpointId,
      event,
      status,
      attempts,
      responseCode,
      nextRetryAt,
      createdAt,
      finishedAt,
    }),
  );
}
export async function replay(
  actor: Actor,
  projectId: string,
  endpointId: string,
  deliveryId: string,
) {
  await assertEndpoint(actor, projectId, endpointId);
  const [d] = await db
    .select({ id: webhookDelivery.id })
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.id, deliveryId),
        eq(webhookDelivery.endpointId, endpointId),
      ),
    )
    .limit(1);
  if (!d) throw new DomainError("NOT_FOUND", "资源不存在", null);
  const result = await webhook.replayDelivery(actor, deliveryId);
  // 网络错误可能包含 URL；只提供可用于重试决策的状态。
  return {
    deliveryId,
    endpointId,
    ok: result.ok,
    ...("attempts" in result ? { attempts: result.attempts } : {}),
    ...("status" in result ? { responseCode: result.status } : {}),
    ...("dead" in result ? { dead: result.dead } : {}),
  };
}
