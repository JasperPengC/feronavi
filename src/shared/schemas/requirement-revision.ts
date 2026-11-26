import { z } from "zod";

export const revisionQuerySchema = z.object({
  before: z.coerce.number().int().min(1).max(2147483647).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const revisionParamsSchema = z.object({ id: z.uuid(), revisionId: z.uuid().optional() });

export interface RequirementRevisionSummary {
  id: string;
  workItemId: string;
  revisionNo: number;
  workItemVersion: number;
  title: string;
  authorId: string | null;
  authorName: string | null;
  source: "INITIAL" | "EDIT" | "BASELINE";
  createdAt: string;
}
export interface RequirementRevision extends RequirementRevisionSummary { description: string | null }
export interface RequirementRevisionPage { items: RequirementRevisionSummary[]; nextCursor: number | null }
