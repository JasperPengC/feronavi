import { z } from "zod";

export const testCaseStatusSchema = z.enum(["DRAFT", "READY", "ARCHIVED"]);
export const testPrioritySchema = z.enum([
  "LOWEST",
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);
export const testStepSchema = z
  .object({
    action: z.string().trim().min(1).max(4000),
    expected: z.string().trim().min(1).max(4000),
  })
  .strict();
const requirementRef = z
  .object({ workItemId: z.uuid(), revisionId: z.uuid() })
  .strict();
const requirementsSchema = z
  .array(requirementRef)
  .max(20)
  .refine(
    (rows) => new Set(rows.map((r) => r.workItemId)).size === rows.length,
    "需求关联不能重复",
  );
export const createTestSuiteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(4000).default(""),
  })
  .strict();
export const updateTestSuiteSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(4000).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, "至少修改一项");
export const createTestCaseSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    preconditions: z.string().max(10000).default(""),
    steps: z.array(testStepSchema).max(100).default([]),
    requirements: requirementsSchema.default([]),
    suiteId: z.uuid().nullable().default(null),
    ownerId: z.uuid().nullable().optional(),
    priority: testPrioritySchema.default("MEDIUM"),
    status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
  })
  .strict();
export const updateTestCaseSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(300).optional(),
    preconditions: z.string().max(10000).optional(),
    steps: z.array(testStepSchema).max(100).optional(),
    requirements: requirementsSchema.optional(),
    suiteId: z.uuid().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    priority: testPrioritySchema.optional(),
    status: testCaseStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, "至少修改一项");
export const testCaseListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.coerce.number().int().positive().optional(),
    status: testCaseStatusSchema.optional(),
    suiteId: z.uuid().optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export type TestStep = z.infer<typeof testStepSchema>;
export interface TestRequirementRef {
  workItemId: string;
  revisionId: string;
  key: string;
  title: string;
  revisionNo: number;
}
export interface TestCaseRevision {
  id: string;
  caseId: string;
  revisionNo: number;
  title: string;
  preconditions: string;
  steps: TestStep[];
  requirements: TestRequirementRef[];
  createdBy: string | null;
  authorName: string | null;
  createdAt: string;
}
export interface TestSuite {
  id: string;
  projectId: string;
  name: string;
  description: string;
  version: number;
  archivedAt: string | null;
  activeCaseCount: number;
  canManage: boolean;
}
export interface TestCaseSummary {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  status: z.infer<typeof testCaseStatusSchema>;
  priority: z.infer<typeof testPrioritySchema>;
  version: number;
  currentRevisionId: string;
  revisionNo: number;
  suiteId: string | null;
  suiteName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: string;
  canManage: boolean;
}
export interface TestCaseDetail extends TestCaseSummary {
  revision: TestCaseRevision;
}
export interface TestCasePage {
  items: TestCaseSummary[];
  nextCursor: number | null;
  canManage: boolean;
}
