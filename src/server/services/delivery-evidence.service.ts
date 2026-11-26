import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  deliveryEvidence,
  deliveryEvidenceLink,
  deliverySource,
  integration,
  workItem,
} from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import {
  createDeliveryEvidenceSchema,
  deliveryItemIds,
  deliveryListSchema,
  type DeliveryEvidencePage,
  type DeliveryEvidenceView,
} from "../../shared/schemas/delivery.ts";
import type { Actor } from "../permission/actor.ts";
import {
  parseDelivery,
  readDeliveryProject,
  withDeliveryWrite,
} from "./delivery-access.ts";
import { deliverySourceIsCurrent } from "./delivery-source.service.ts";
import { recordBusinessEvent } from "./event-log.ts";
type EvidenceRow = typeof deliveryEvidence.$inferSelect;
async function validateItems(projectId: string, ids: string[]) {
  const rows = await db
    .select({ id: workItem.id })
    .from(workItem)
    .where(
      and(
        eq(workItem.projectId, projectId),
        inArray(workItem.id, ids),
        isNull(workItem.deletedAt),
      ),
    );
  if (rows.length !== ids.length) throw forbidden();
}
export async function assertDeliveryItems(
  actor: Actor,
  projectId: string,
  ids: string[],
) {
  await readDeliveryProject(actor, projectId);
  await validateItems(projectId, ids);
}
async function views(rows: EvidenceRow[]): Promise<DeliveryEvidenceView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id),
    sourceIds = [
      ...new Set(rows.flatMap((r) => (r.sourceId ? [r.sourceId] : []))),
    ];
  const links = await db
    .select({
      evidenceId: deliveryEvidenceLink.evidenceId,
      id: workItem.id,
      key: workItem.key,
      title: workItem.title,
      projectId: workItem.projectId,
    })
    .from(deliveryEvidenceLink)
    .innerJoin(workItem, eq(deliveryEvidenceLink.workItemId, workItem.id))
    .where(
      and(
        inArray(deliveryEvidenceLink.evidenceId, ids),
        isNull(workItem.deletedAt),
      ),
    );
  const sources = sourceIds.length
    ? await db
        .select({ source: deliverySource, integration })
        .from(deliverySource)
        .leftJoin(integration, eq(deliverySource.integrationId, integration.id))
        .where(inArray(deliverySource.id, sourceIds))
    : [];
  return rows.map((row) => {
    const s = sources.find((v) => v.source.id === row.sourceId);
    return {
      ...row,
      providerUpdatedAt: row.providerUpdatedAt?.toISOString() ?? null,
      receivedAt: row.receivedAt.toISOString(),
      sourceCurrent:
        !!s &&
        row.sourceVersion === s.source.version &&
        deliverySourceIsCurrent(s.source, s.integration ?? undefined),
      workItems: links
        .filter((l) => l.evidenceId === row.id && l.projectId === row.projectId)
        .map(({ id, key, title }) => ({ id, key, title })),
    };
  });
}
export async function getDeliveryEvidence(
  actor: Actor,
  projectId: string,
  id: string,
): Promise<DeliveryEvidenceView> {
  await readDeliveryProject(actor, projectId);
  const [row] = await db
    .select()
    .from(deliveryEvidence)
    .where(
      and(
        eq(deliveryEvidence.id, id),
        eq(deliveryEvidence.projectId, projectId),
      ),
    );
  if (!row) throw forbidden();
  return (await views([row]))[0]!;
}
export async function listDeliveryEvidence(
  actor: Actor,
  projectId: string,
  raw: unknown = {},
): Promise<DeliveryEvidencePage> {
  await readDeliveryProject(actor, projectId);
  const q = parseDelivery(deliveryListSchema, raw);
  if (q.workItemId) await validateItems(projectId, [q.workItemId]);
  if (q.before) await getDeliveryEvidence(actor, projectId, q.before);
  const rows = await db
    .select()
    .from(deliveryEvidence)
    .where(
      and(
        eq(deliveryEvidence.projectId, projectId),
        q.kind ? eq(deliveryEvidence.kind, q.kind) : undefined,
        q.workItemId
          ? sql`exists(select 1 from delivery_evidence_link l where l.evidence_id=${deliveryEvidence.id} and l.work_item_id=${q.workItemId})`
          : undefined,
        q.before
          ? sql`(${deliveryEvidence.receivedAt},${deliveryEvidence.id}) < (select received_at,id from delivery_evidence where id=${q.before} and project_id=${projectId})`
          : undefined,
      ),
    )
    .orderBy(desc(deliveryEvidence.receivedAt), desc(deliveryEvidence.id))
    .limit(q.limit + 1);
  return {
    items: await views(rows.slice(0, q.limit)),
    nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
  };
}
export async function createDeliveryEvidence(
  actor: Actor,
  projectId: string,
  raw: unknown,
): Promise<DeliveryEvidenceView> {
  const input = parseDelivery(createDeliveryEvidenceSchema, raw);
  return withDeliveryWrite(
    actor,
    projectId,
    "work_item:update_any",
    async () => {
      await validateItems(projectId, input.workItemIds);
      const { workItemIds, summary, ...data } = input;
      const [row] = await db
        .insert(deliveryEvidence)
        .values({
          ...data,
          projectId,
          verification: "SELF_REPORTED",
          externalId: randomUUID(),
          details: { summary: summary ?? "" },
          createdBy: actor.memberId,
          receivedAt: new Date(),
        })
        .returning();
      await db
        .insert(deliveryEvidenceLink)
        .values(
          workItemIds.map((workItemId) => ({
            evidenceId: row!.id,
            workItemId,
            createdBy: actor.memberId,
          })),
        );
      await recordBusinessEvent({
        actor,
        projectId,
        action: "delivery.evidence.created",
        targetType: "DELIVERY_EVIDENCE",
        targetId: row!.id,
        summary: `${actor.name} 登记了交付证据「${row!.title}」`,
        changes: { verification: "SELF_REPORTED", kind: row!.kind },
      });
      return getDeliveryEvidence(actor, projectId, row!.id);
    },
  );
}
export async function linkDeliveryEvidence(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<DeliveryEvidenceView> {
  const ids = parseDelivery(deliveryItemIds, raw);
  return withDeliveryWrite(
    actor,
    projectId,
    "work_item:update_any",
    async () => {
      await getDeliveryEvidence(actor, projectId, id);
      await validateItems(projectId, ids);
      const added = await db
        .insert(deliveryEvidenceLink)
        .values(
          ids.map((workItemId) => ({
            evidenceId: id,
            workItemId,
            createdBy: actor.memberId,
          })),
        )
        .onConflictDoNothing()
        .returning();
      if (added.length)
        await recordBusinessEvent({
          actor,
          projectId,
          action: "delivery.evidence.linked",
          targetType: "DELIVERY_EVIDENCE",
          targetId: id,
          summary: `${actor.name} 关联了${added.length}个交付工作项`,
        });
      return getDeliveryEvidence(actor, projectId, id);
    },
  );
}
