import { z } from "zod";

const projectIdsSchema = z.array(z.string().uuid()).min(1).max(20).optional();
const limitSchema = z.number().int().min(1).max(10).optional();
export const ragReferencesShape = {
  artifactIds: z.array(z.string().uuid()).max(10).optional(),
  credentialRefs: z.array(z.string().uuid()).max(10).optional(),
};
export interface RagReferences {artifactIds?: string[];credentialRefs?: string[]}

export const ragSearchSchema = z
  .object({
    q: z.string().trim().min(1).max(1000),
    projectIds: projectIdsSchema,
    limit: limitSchema,
  })
  .strict();

export const ragChatSchema = z
  .object({
    ...ragReferencesShape,
    question: z.string().trim().min(1).max(1000),
    projectIds: projectIdsSchema,
    limit: limitSchema,
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(12)
      .optional(),
  })
  .strict();

export type RagSearchInput = z.infer<typeof ragSearchSchema>;
export type RagChatInput = z.infer<typeof ragChatSchema>;
export interface RagProject {
  archived?: boolean;
  id: string;
  key: string;
  name: string;
}
export interface RagScope {
  projectIds: string[];
  projectCount: number;
}
export interface RagCitation {
  pageId: string;
  projectId: string;
  projectName: string;
  title: string;
  headingPath: string | null;
  snippet: string;
}
export interface RagHit extends RagCitation {
  chunkId: string;
  score: number;
  mode: "vector" | "keyword";
}
export interface RagSearchResult {
  mode: "vector" | "keyword";
  hits: RagHit[];
  note?: string;
  scope: RagScope;
}
export interface RagChatResult {
  evidence?: RagBusinessEvidence[];
  actions?: RagActionProposal[];
  ok: boolean;
  answer: string | null;
  citations: RagCitation[];
  mode: "vector" | "keyword" | "none";
  note?: string;
  scope: RagScope;
}

/** Server-owned references; revalidated before delivery, history and confirmation. */
export type RagResourceKind =
  | "workItem"
  | "milestone"
  | "iteration"
  | "release"
  | "module"
  | "page"
  | "comment"
  | "idea";
export interface RagResourceRef {
  kind: RagResourceKind;
  id: string;
}
export interface RagBusinessEvidence {
  id: string;
  toolName: string;
  projectId: string | null;
  scope?: RagBusinessScope;
  verificationReads?: RagVerificationRead[];
  observedAt: string;
  resources: RagResourceRef[];
  summary: string;
  readTools?: string[];
}
export type RagBusinessScope =
  | {kind: "project" | "project-set"; projectIds: string[]}
  | {kind: "personal" | "account"; ownerId: string};
export interface RagVerificationRead {toolName: string; parameters: Record<string, unknown>}
export interface RagActionProposal {
  id: string;
  toolName: string;
  projectId: string | null;
  scope?: RagBusinessScope;
  verificationReads?: RagVerificationRead[];
  targetId: string | null;
  parameters: Record<string, unknown>;
  expectedVersion: number | null;
  /** Optional for persisted work-item proposals created before generic resource confirmation. */
  target?: RagResourceRef & {
    fingerprint: string;
    preview?: Record<string, string | number | null>;
  };
  resources?: RagResourceRef[];
  observations?: {
    toolName: string;
    parameters: Record<string, unknown>;
    fingerprint: string;
  }[];
  presentation?: { title: string; fields: { label: string; value: string }[] };
  result?: {
    verificationReads?: RagVerificationRead[];
    projectIds?: string[];
    observedAt: string;
    resources: RagResourceRef[];
    value: Record<string, unknown>;
    outcome?: "approval_pending";
    approval?: { status: "PENDING" };
  };
  status: "pending" | "confirmed" | "rejected" | "expired" | "queued" | "running" | "failed" | "uncertain";
  createdAt: string;
  expiresAt: string;
}
