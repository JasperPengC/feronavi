import type { Actor } from "../permission/actor.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import { revisionParamsSchema, revisionQuerySchema, type RequirementRevision, type RequirementRevisionPage } from "../../shared/schemas/requirement-revision.ts";
import { getWorkItem } from "./work-item.service.ts";
import * as revisions from "../repos/requirement-revision.repo.ts";

async function assertRequirement(actor: Actor, id: string) {
  const parsed = revisionParamsSchema.safeParse({ id });
  if (!parsed.success) throw new DomainError("VALIDATION", "需求标识不合法", null);
  const item = await getWorkItem(actor, id);
  if (item.type !== "REQUIREMENT") throw new DomainError("VALIDATION", "正文历史仅适用于需求", null);
}

export async function listRequirementRevisions(actor: Actor, id: string, query: unknown = {}): Promise<RequirementRevisionPage> {
  await assertRequirement(actor, id);
  const parsed = revisionQuerySchema.safeParse(query);
  if (!parsed.success) throw new DomainError("VALIDATION", "历史分页参数不合法", parsed.error.issues);
  const { limit, before } = parsed.data;
  const rows = await revisions.listRevisions(id, limit, before);
  return {
    items: rows.slice(0, limit).map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > limit ? rows[limit - 1]!.revisionNo : null,
  };
}

export async function getRequirementRevision(actor: Actor, id: string, revisionId: string): Promise<RequirementRevision> {
  await assertRequirement(actor, id);
  if (!revisionParamsSchema.safeParse({ id, revisionId }).success) throw new DomainError("VALIDATION", "版本标识不合法", null);
  const row = await revisions.findRevision(id, revisionId);
  if (!row) throw forbidden();
  return { ...row, createdAt: row.createdAt.toISOString() };
}
