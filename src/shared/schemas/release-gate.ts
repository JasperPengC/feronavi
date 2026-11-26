import { z } from "zod";
import { deliverySha, deliveryUrl } from "./delivery.ts";
const ids = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine((a) => new Set(a).size === a.length);
export const createReleaseCandidateSchema = z
  .object({
    sourceId: z.uuid(),
    commitSha: deliverySha,
    build: z.string().trim().min(1).max(200),
    environment: z.string().trim().min(1).max(300),
    workflowIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(30)
      .refine((a) => new Set(a).size === a.length),
    testPlanIds: ids,
    expectedCandidateNumber: z.number().int().min(0),
  })
  .strict();
export const releaseFeedbackSchema = z
  .object({
    workItemId: z.uuid(),
    sourceUrl: deliveryUrl,
    conclusion: z.string().trim().min(1).max(4000),
    outcome: z.enum(["RESOLVED", "FOLLOW_UP"]),
  })
  .strict();
export interface ReleaseScopeItem {
  id: string;
  key: string;
  title: string;
  version: number;
}
export interface ReleaseCandidateView {
  id: string;
  projectId: string;
  releaseId: string;
  number: number;
  sourceId: string;
  sourceVersion: number;
  repository: string;
  commitSha: string;
  build: string;
  environment: string;
  workflowIds: number[];
  testPlanIds: string[];
  workItems: ReleaseScopeItem[];
  createdBy: string | null;
  createdAt: string;
}
export interface ReleaseGateCheck {
  key: string;
  passed: boolean;
  message: string;
  evidenceIds: string[];
  testPlanId?: string;
  testRunIds?: string[];
}
export interface ReleaseGateSnapshot {
  candidateId: string;
  candidateNumber: number;
  commitSha: string;
  build: string;
  environment: string;
  sourceId: string;
  sourceVersion: number;
  repository: string;
  passed: boolean;
  checks: ReleaseGateCheck[];
  checkedAt: string;
}
export interface ReleaseFeedbackView {
  id: string;
  projectId: string;
  releaseId: string;
  workItemId: string;
  sourceUrl: string;
  conclusion: string;
  outcome: "RESOLVED" | "FOLLOW_UP";
  createdBy: string | null;
  createdAt: string;
}
export interface ReleaseGateView {
  releaseId: string;
  completedAt: string | null;
  candidate: ReleaseCandidateView | null;
  passed: boolean;
  checks: ReleaseGateCheck[];
  verification: ReleaseGateSnapshot | null;
  feedback: ReleaseFeedbackView[];
}
