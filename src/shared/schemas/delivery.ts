import { z } from "zod";
export const deliveryKind = z.enum([
  "COMMIT",
  "PULL_REQUEST",
  "CI",
  "BUILD",
  "DEPLOYMENT",
]);
export const deliveryStatus = z.enum([
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
export const deliveryUrl = z
  .url()
  .max(2000)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "使用不含凭据的HTTP链接");
export const deliverySha = z.string().regex(/^([a-f0-9]{40}|[a-f0-9]{64})$/u);
export const deliveryRepository = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
  .max(300)
  .refine((v) => !v.split("/").some((s) => s === "." || s === ".."));
export const deliveryItemIds = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length, "工作项不能重复");
export const configureDeliverySourceSchema = z
  .object({
    integrationId: z.uuid(),
    sourceId: z.uuid().optional(),
    expectedVersion: z.number().int().min(0),
    webhookSecret: z
      .string()
      .min(24)
      .max(200)
      .refine((v) => !v.startsWith("enc:"), "请输入原始密钥")
      .optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
export const createDeliveryEvidenceSchema = z
  .object({
    kind: deliveryKind,
    title: z.string().trim().min(1).max(300),
    repository: deliveryRepository,
    commitSha: deliverySha,
    build: z.string().trim().min(1).max(200),
    environment: z.string().trim().min(1).max(300).optional(),
    status: deliveryStatus,
    url: deliveryUrl,
    summary: z.string().trim().max(4000).optional(),
    workItemIds: deliveryItemIds,
  })
  .strict();
export const deliveryListSchema = z
  .object({
    workItemId: z.uuid().optional(),
    kind: deliveryKind.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.uuid().optional(),
  })
  .strict();
export interface DeliverySourceView {
  id: string;
  projectId: string;
  integrationId: string | null;
  name: string;
  repository: string;
  apiBaseUrl: string;
  version: number;
  enabled: boolean;
  configCurrent: boolean;
  hasWebhookSecret: boolean;
  updatedAt: string;
}
export interface DeliveryEvidenceView {
  id: string;
  projectId: string;
  sourceId: string | null;
  sourceVersion: number | null;
  kind: z.infer<typeof deliveryKind>;
  title: string;
  repository: string;
  commitSha: string;
  build: string;
  environment: string | null;
  status: z.infer<typeof deliveryStatus>;
  verification: "SELF_REPORTED" | "PROVIDER_API";
  externalId: string;
  attempt: number;
  providerUpdatedAt: string | null;
  url: string;
  details: Record<string, string | number | boolean | null>;
  createdBy: string | null;
  receivedAt: string;
  sourceCurrent: boolean;
  workItems: { id: string; key: string; title: string }[];
}
export interface DeliveryEvidencePage {
  items: DeliveryEvidenceView[];
  nextCursor: string | null;
}
export interface DeliveryReceiptResult {
  evidenceId: string;
  replayed: boolean;
}
