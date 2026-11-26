import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
}).strict();
export const productVersionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const updateProductSchema = productVersionSchema.extend({
  name: createProductSchema.shape.name.optional(),
  description: createProductSchema.shape.description,
  archived: z.boolean().optional(),
}).strict().refine(input => input.name !== undefined || input.description !== undefined || input.archived !== undefined, "未指定修改内容");
export const linkProductSchema = productVersionSchema.extend({ targetProjectId: z.string().uuid() }).strict();

export interface ProductSummary {
  id: string; name: string; description: string | null; version: number;
  archivedAt: string | null; createdAt: string; updatedAt: string;
  canManage: boolean; canUnlink: boolean; requirementCount: number;
}
