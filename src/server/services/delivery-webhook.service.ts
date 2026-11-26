import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import {
  deliverySource,
  deliveryReceipt,
  deliveryEvidence,
  integration,
  project,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { DeliveryReceiptResult } from "../../shared/schemas/delivery.ts";
import { decryptSecret } from "./crypto.service.ts";
import {
  deliverySourceIsCurrent,
  type DeliverySourceRow,
  type DeliveryIntegrationRow,
} from "./delivery-source.service.ts";
import {
  fetchGitHubDelivery,
  type DeliveryFetchDeps,
} from "./delivery-github.ts";
import { lockProjectTree } from "./project-tree.ts";
const headersSchema = z.object({
  "x-github-event": z.enum([
    "workflow_run",
    "pull_request",
    "push",
    "deployment_status",
  ]),
  "x-github-delivery": z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/u),
  "x-hub-signature-256": z.string().regex(/^sha256=[a-f0-9]{64}$/u),
});
const pingHeadersSchema = headersSchema.extend({
  "x-github-event": z.literal("ping"),
});
async function current(sourceId: string) {
  const [row] = await db
    .select({ source: deliverySource, integration, project })
    .from(deliverySource)
    .innerJoin(integration, eq(deliverySource.integrationId, integration.id))
    .innerJoin(project, eq(deliverySource.projectId, project.id))
    .where(eq(deliverySource.id, sourceId));
  if (
    !row ||
    !deliverySourceIsCurrent(row.source, row.integration) ||
    row.project.archivedAt ||
    row.project.lifecycleLock
  )
    throw forbidden();
  return row;
}
async function previous(
  sourceId: string,
  deliveryId: string,
  hash: string,
  event: string,
): Promise<DeliveryReceiptResult | null> {
  const [r] = await db
    .select()
    .from(deliveryReceipt)
    .where(
      and(
        eq(deliveryReceipt.sourceId, sourceId),
        eq(deliveryReceipt.deliveryId, deliveryId),
      ),
    );
  if (!r) return null;
  if (r.payloadHash !== hash || r.eventType !== event)
    throw new DomainError("CONFLICT", "交付事件ID已用于不同内容", null);
  return { evidenceId: r.evidenceId, replayed: true };
}
function sameSource(
  before: DeliverySourceRow,
  after: DeliverySourceRow,
  i: DeliveryIntegrationRow,
) {
  return (
    before.version === after.version &&
    before.integrationUpdatedAt.getTime() ===
      after.integrationUpdatedAt.getTime() &&
    deliverySourceIsCurrent(after, i)
  );
}
async function authenticateGitHubWebhook(
  sourceId: string,
  headers: Record<string, unknown>,
  rawBody: Buffer,
  ping: boolean,
) {
  const parsed = (ping ? pingHeadersSchema : headersSchema).safeParse(headers);
  if (
    !parsed.success ||
    !Buffer.isBuffer(rawBody) ||
    rawBody.byteLength > 1_048_576
  )
    throw forbidden();
  const h = parsed.data,
    initial = await current(sourceId);
  const signature = Buffer.from(h["x-hub-signature-256"].slice(7), "hex"),
    expected = createHmac(
      "sha256",
      decryptSecret(initial.source.webhookSecretEncrypted!),
    )
      .update(rawBody)
      .digest();
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  )
    throw forbidden();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new DomainError("VALIDATION", "Webhook内容不是有效JSON", null);
  }
  const repository = z
    .object({ repository: z.object({ full_name: z.string() }) })
    .safeParse(payload);
  if (
    !repository.success ||
    repository.data.repository.full_name.toLowerCase() !==
      initial.source.repository.toLowerCase()
  )
    throw forbidden();
  return { initial, h, payload };
}

/** 连接探测复用签名与仓库校验，但不能产生交付证据或满足发布门禁。 */
export async function receiveGitHubPing(
  sourceId: string,
  headers: Record<string, unknown>,
  rawBody: Buffer,
): Promise<{ event: "ping"; accepted: true }> {
  await authenticateGitHubWebhook(sourceId, headers, rawBody, true);
  return { event: "ping", accepted: true };
}

export async function receiveGitHubDelivery(
  sourceId: string,
  headers: Record<string, unknown>,
  rawBody: Buffer,
  deps: DeliveryFetchDeps = {},
): Promise<DeliveryReceiptResult> {
  const { initial, h, payload } = await authenticateGitHubWebhook(
    sourceId,
    headers,
    rawBody,
    false,
  );
  const hash = createHash("sha256").update(rawBody).digest("hex"),
    event = h["x-github-event"],
    deliveryId = h["x-github-delivery"];
  const prior = await previous(sourceId, deliveryId, hash, event);
  if (prior) return prior;
  const verified = await fetchGitHubDelivery(
    initial.source,
    initial.integration,
    event,
    payload,
    deps,
  );
  return db.transaction(async () => {
    await lockProjectTree(initial.source.projectId);
    // 与来源配置使用相同锁顺序，且网络请求已结束。
    await db
      .select({ id: integration.id })
      .from(integration)
      .where(eq(integration.id, initial.integration.id))
      .for("update");
    await db
      .select({ id: deliverySource.id })
      .from(deliverySource)
      .where(eq(deliverySource.id, sourceId))
      .for("update");
    const [source] = await db
        .select()
        .from(deliverySource)
        .where(eq(deliverySource.id, sourceId)),
      [i] = await db
        .select()
        .from(integration)
        .where(eq(integration.id, initial.integration.id));
    if (!source || !i || !sameSource(initial.source, source, i))
      throw new DomainError(
        "CONFLICT",
        "交付来源在核验期间已变化，请重新发送",
        null,
      );
    await current(sourceId);
    const duplicate = await previous(sourceId, deliveryId, hash, event);
    if (duplicate) return duplicate;
    const [e] = await db
      .insert(deliveryEvidence)
      .values({
        ...verified,
        projectId: source.projectId,
        sourceId,
        sourceVersion: source.version,
        verification: "PROVIDER_API",
        receivedAt: new Date(),
      })
      .returning();
    await db.insert(deliveryReceipt).values({
      sourceId,
      sourceVersion: source.version,
      deliveryId,
      payloadHash: hash,
      eventType: event,
      evidenceId: e!.id,
      receivedAt: new Date(),
    });
    return { evidenceId: e!.id, replayed: false };
  });
}
