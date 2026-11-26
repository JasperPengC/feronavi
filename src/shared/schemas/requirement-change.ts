import { z } from "zod";
import type { RequirementRevision } from "./requirement-revision.ts";

export const changeStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "APPLIED",
]);
export const impactKindSchema = z.enum([
  "WORK_ITEM",
  "MILESTONE",
  "ITERATION",
  "RELEASE",
  "TEST_CASE",
]);
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
export type ImpactKind = z.infer<typeof impactKindSchema>;
export const createRequirementChangeSchema = z
  .object({
    baseRevisionId: z.uuid(),
    expectedWorkItemVersion: z.number().int().positive(),
    impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20000).nullable(),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
export const changeVersionSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const decideRequirementChangeSchema = changeVersionSchema
  .extend({
    decision: z.enum(["APPROVE", "REJECT", "CANCEL"]),
    note: z.string().trim().max(4000).optional(),
  })
  .strict();
export const applyRequirementChangeSchema = changeVersionSchema
  .extend({ expectedWorkItemVersion: z.number().int().positive() })
  .strict();
export const acknowledgeImpactSchema = changeVersionSchema
  .extend({ impactId: z.uuid(), note: z.string().trim().max(4000).optional() })
  .strict();
export const changeListSchema = z
  .object({
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export interface RequirementImpactSnapshot {
  kind: ImpactKind;
  targetId: string;
  title: string;
  key: string | null;
  ownerId: string | null;
  sourceVersion: string;
}
export interface RequirementImpact extends RequirementImpactSnapshot {
  id: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  note: string | null;
  canAcknowledge: boolean;
  available: boolean;
}
export interface RequirementChangeSummary {
  id: string;
  workItemId: string;
  projectId: string;
  number: number;
  status: ChangeStatus;
  version: number;
  proposedTitle: string;
  reason: string;
  requestedBy: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedBy: string | null;
  appliedAt: string | null;
}
export interface RequirementChangeDetail extends RequirementChangeSummary {
  baseRevision: RequirementRevision;
  proposedDescription: string | null;
  requestedWorkItemVersion: number;
  reviewNote: string | null;
  appliedRevisionId: string | null;
  impacts: RequirementImpact[];
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
  participants: Array<{ id: string; name: string }>;
  canReview: boolean;
  canApply: boolean;
  canCancel: boolean;
  stale: boolean;
}
export interface RequirementChangeContext {
  workItemId: string;
  projectId: string;
  workItemVersion: number;
  baseRevision: RequirementRevision;
  impactFingerprint: string;
  impacts: RequirementImpactSnapshot[];
  canCreate: boolean;
}
export interface RequirementChangePage {
  items: RequirementChangeSummary[];
  nextCursor: number | null;
}
