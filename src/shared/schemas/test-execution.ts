import { z } from "zod";
import type { TestCaseRevision } from "./test-management.ts";
export const testPlanStatus = z.enum([
  "DRAFT",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
]);
export const testResultStatus = z.enum([
  "PASSED",
  "FAILED",
  "BLOCKED",
  "SKIPPED",
]);
export const testRunStatus = z.enum([
  "IN_PROGRESS",
  "PASSED",
  "FAILED",
  "BLOCKED",
  "SKIPPED",
  "CANCELLED",
]);
export const testSource = z.enum(["MANUAL", "AGENT", "AUTOMATION"]);
const pinnedCase = z
  .object({ caseId: z.uuid(), revisionId: z.uuid() })
  .strict();
const pinnedCases = z
  .array(pinnedCase)
  .max(500)
  .refine(
    (v) => new Set(v.map((c) => c.caseId)).size === v.length,
    "用例不能重复",
  );
export const createTestPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    build: z.string().trim().min(1).max(200),
    environment: z.string().trim().min(1).max(300),
    cases: pinnedCases.default([]),
  })
  .strict();
export const updateTestPlanSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(300).optional(),
    build: z.string().trim().min(1).max(200).optional(),
    environment: z.string().trim().min(1).max(300).optional(),
    cases: pinnedCases.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, "至少修改一项");
export const transitionTestPlanSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum(["START", "COMPLETE", "CANCEL"]),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export const startTestRunSchema = z
  .object({
    planCaseId: z.uuid(),
    retestOf: z.uuid().optional(),
    build: z.string().trim().min(1).max(200).optional(),
    environment: z.string().trim().min(1).max(300).optional(),
    source: testSource.default("MANUAL"),
    sourceReference: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const evidenceUrl = z
  .url()
  .max(2000)
  .refine(
    (value) =>
      /^https?:\/\//iu.test(value) &&
      !new URL(value).username &&
      !new URL(value).password,
    "证据须为可访问的http(s)链接，不得使用本地路径或URL凭据",
  );
export const testStepResultSchema = z
  .object({
    stepIndex: z.number().int().min(0).max(99),
    status: testResultStatus,
    actual: z.string().trim().min(1).max(10000),
    evidence: z.array(evidenceUrl).max(20).default([]),
  })
  .strict();
export const recordTestRunSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    results: z
      .array(testStepResultSchema)
      .min(1)
      .max(100)
      .refine(
        (v) => new Set(v.map((s) => s.stepIndex)).size === v.length,
        "步骤结果不能重复",
      ),
  })
  .strict();
export const completeTestRunSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const createTestRunDefectSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    priority: z
      .enum(["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"])
      .default("HIGH"),
    severity: z.enum(["S1", "S2", "S3", "S4"]).default("S3"),
  })
  .strict();
export const linkTestRunDefectSchema = z
  .object({ defectId: z.uuid() })
  .strict();
export const testPlanListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.coerce.number().int().positive().optional(),
    status: testPlanStatus.optional(),
  })
  .strict();
export type TestStepResult = z.infer<typeof testStepResultSchema>;
export type TestRunState = z.infer<typeof testRunStatus>;
export interface TestPlanCase {
  id: string;
  caseId: string;
  key: string;
  revisionId: string;
  revisionNo: number;
  title: string;
  position: number;
  latestRun: { id: string; status: TestRunState; attempt: number } | null;
}
export interface TestPlanSummary {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  build: string;
  environment: string;
  status: z.infer<typeof testPlanStatus>;
  version: number;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelReason: string | null;
  canManage: boolean;
  canExecute: boolean;
}
export interface TestPlanDetail extends TestPlanSummary {
  cases: TestPlanCase[];
}
export interface TestPlanPage {
  items: TestPlanSummary[];
  nextCursor: number | null;
  canManage: boolean;
}
export interface TestRunDefectRef {
  id: string;
  key: string;
  title: string;
  statusKey: string;
  statusName: string;
  statusCategory: string;
  generated: boolean;
  inherited: boolean;
}
export interface TestRunDetail {
  id: string;
  projectId: string;
  planId: string;
  planCaseId: string;
  caseId: string;
  caseKey: string;
  planTitle: string;
  build: string;
  environment: string;
  attempt: number;
  retestOf: string | null;
  status: TestRunState;
  version: number;
  source: z.infer<typeof testSource>;
  sourceReference: string | null;
  sourceVerification: "SELF_REPORTED";
  executorId: string | null;
  executorName: string | null;
  startedAt: string;
  finishedAt: string | null;
  cancelReason: string | null;
  results: TestStepResult[];
  revision: TestCaseRevision;
  defects: TestRunDefectRef[];
  canExecute: boolean;
  canRetest: boolean;
  canCreateDefect: boolean;
  canLinkDefect: boolean;
}
export interface TestRunDefectResult {
  runId: string;
  defect: {
    id: string;
    key: string;
    title: string;
    type: string;
    projectId: string;
  };
}
export interface TestPlanReport {
  plan: TestPlanSummary;
  totalCases: number;
  totalAttempts: number;
  latestResults: Record<TestRunState | "NOT_RUN", number>;
  allAttempts: Record<TestRunState, number>;
  passed: boolean;
  testedBuild: string | null;
  testedEnvironment: string | null;
  cases: Array<{
    planCaseId: string;
    caseId: string;
    key: string;
    title: string;
    revisionId: string;
    revisionNo: number;
    latestStatus: TestRunState | "NOT_RUN";
    runs: TestRunDetail[];
  }>;
  generatedAt: string;
}
export function summarizeTestResults(
  results: TestStepResult[],
): "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED" {
  if (results.some((s) => s.status === "FAILED")) return "FAILED";
  if (results.some((s) => s.status === "BLOCKED")) return "BLOCKED";
  if (results.some((s) => s.status === "SKIPPED")) return "SKIPPED";
  return "PASSED";
}
