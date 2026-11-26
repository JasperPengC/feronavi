import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { deliverySource, integration } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import {
  configureDeliverySourceSchema,
  deliveryRepository,
  type DeliverySourceView,
} from "../../shared/schemas/delivery.ts";
import type { Actor } from "../permission/actor.ts";
import { encryptSecret } from "./crypto.service.ts";
import {
  readDeliveryProject,
  parseDelivery,
  withDeliveryWrite,
} from "./delivery-access.ts";
import { recordBusinessEvent } from "./event-log.ts";
export type DeliverySourceRow = typeof deliverySource.$inferSelect;
export type DeliveryIntegrationRow = typeof integration.$inferSelect;
export function deliverySourceIsCurrent(
  s: DeliverySourceRow,
  i: DeliveryIntegrationRow | undefined,
) {
  return (
    !!i &&
    s.enabled &&
    !!s.webhookSecretEncrypted &&
    i.isActive &&
    i.kind === "GITHUB" &&
    i.projectId === s.projectId &&
    i.updatedAt.getTime() === s.integrationUpdatedAt.getTime() &&
    i.baseUrl.replace(/\/+$/u, "") === s.apiBaseUrl &&
    (i.config as { repo?: string })?.repo === s.repository
  );
}
function view(
  s: DeliverySourceRow,
  i: DeliveryIntegrationRow | undefined,
): DeliverySourceView {
  return {
    id: s.id,
    projectId: s.projectId,
    integrationId: s.integrationId,
    name: i?.name ?? "",
    repository: s.repository,
    apiBaseUrl: s.apiBaseUrl,
    version: s.version,
    enabled: s.enabled,
    configCurrent: deliverySourceIsCurrent(s, i),
    hasWebhookSecret: !!s.webhookSecretEncrypted,
    updatedAt: s.updatedAt.toISOString(),
  };
}
export async function listDeliverySources(
  actor: Actor,
  projectId: string,
): Promise<DeliverySourceView[]> {
  await readDeliveryProject(actor, projectId);
  const rows = await db
    .select({ source: deliverySource, integration })
    .from(deliverySource)
    .leftJoin(integration, eq(deliverySource.integrationId, integration.id))
    .where(eq(deliverySource.projectId, projectId));
  return rows.map((r) => view(r.source, r.integration ?? undefined));
}
export async function configureDeliverySource(
  actor: Actor,
  projectId: string,
  raw: unknown,
): Promise<DeliverySourceView> {
  const input = parseDelivery(configureDeliverySourceSchema, raw);
  return withDeliveryWrite(actor, projectId, "integration:manage", async () => {
    const [i] = await db
      .select()
      .from(integration)
      .where(
        and(
          eq(integration.id, input.integrationId),
          eq(integration.projectId, projectId),
        ),
      )
      .for("update");
    if (!i) throw forbidden();
    if (i.kind !== "GITHUB")
      throw new DomainError("VALIDATION", "当前交付核验支持GitHub集成", null);
    const repository = parseDelivery(
        deliveryRepository,
        (i.config as { repo?: unknown })?.repo,
      ),
      apiBaseUrl = i.baseUrl.replace(/\/+$/u, "");
    const u = new URL(apiBaseUrl);
    if (u.username || u.password || u.search || u.hash)
      throw new DomainError(
        "VALIDATION",
        "集成API地址不能包含凭据、查询或片段",
        null,
      );
    const [old] = await db
      .select()
      .from(deliverySource)
      .where(
        input.sourceId
          ? and(
              eq(deliverySource.id, input.sourceId),
              eq(deliverySource.projectId, projectId),
            )
          : eq(deliverySource.integrationId, i.id),
      )
      .for("update");
    if (input.sourceId && !old) throw forbidden();
    const [bound] = await db
      .select({ id: deliverySource.id })
      .from(deliverySource)
      .where(eq(deliverySource.integrationId, i.id));
    if (bound && bound.id !== old?.id)
      throw new DomainError(
        "CONFLICT",
        "该集成已绑定其它交付来源，请选择未绑定的集成",
        null,
      );
    if ((old?.version ?? 0) !== input.expectedVersion)
      throw new DomainError(
        "VERSION_CONFLICT",
        "交付来源已更新，请重新读取",
        null,
      );
    if (
      input.enabled &&
      (!i.isActive || (!input.webhookSecret && !old?.webhookSecretEncrypted))
    )
      throw new DomainError(
        "VALIDATION",
        "启用来源需要有效集成及Webhook密钥",
        null,
      );
    const values = {
      integrationId: i.id,
      repository,
      apiBaseUrl,
      integrationUpdatedAt: i.updatedAt,
      enabled: input.enabled,
      version: (old?.version ?? 0) + 1,
      updatedAt: new Date(),
      ...(input.webhookSecret
        ? { webhookSecretEncrypted: encryptSecret(input.webhookSecret) }
        : {}),
    };
    const [row] = old
      ? await db
          .update(deliverySource)
          .set(values)
          .where(eq(deliverySource.id, old.id))
          .returning()
      : await db
          .insert(deliverySource)
          .values({
            ...values,
            projectId,
            integrationId: i.id,
            createdBy: actor.memberId,
          })
          .returning();
    await recordBusinessEvent({
      actor,
      projectId,
      action: "delivery.source.configured",
      targetType: "DELIVERY_SOURCE",
      targetId: row!.id,
      summary: `${actor.name} 更新了交付来源「${i.name}」`,
      changes: { version: row!.version, enabled: row!.enabled },
    });
    return view(row!, i);
  });
}

export async function assertDeliverySourceTarget(
  actor: Actor,
  projectId: string,
  integrationId: string,
  sourceId?: string,
) {
  await readDeliveryProject(actor, projectId);
  const [i] = await db
    .select({ id: integration.id })
    .from(integration)
    .where(
      and(
        eq(integration.id, integrationId),
        eq(integration.projectId, projectId),
      ),
    );
  if (!i) throw forbidden();
  if (sourceId) {
    const [s] = await db
      .select({ id: deliverySource.id })
      .from(deliverySource)
      .where(
        and(
          eq(deliverySource.id, sourceId),
          eq(deliverySource.projectId, projectId),
        ),
      );
    if (!s) throw forbidden();
  }
}
export async function assertDeliverySourceId(
  actor: Actor,
  projectId: string,
  sourceId: string,
) {
  await readDeliveryProject(actor, projectId);
  const [s] = await db
    .select({ id: deliverySource.id })
    .from(deliverySource)
    .where(
      and(
        eq(deliverySource.id, sourceId),
        eq(deliverySource.projectId, projectId),
      ),
    );
  if (!s) throw forbidden();
}
