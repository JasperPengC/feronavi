import { z } from "zod";

export const organizePageSchema = z.object({
  expectedStructureVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(300).optional(),
  parentId: z.string().uuid().nullable().optional(),
  archived: z.boolean().optional(),
}).strict().refine(value => value.title !== undefined || value.parentId !== undefined || value.archived !== undefined, "请选择整理操作")
  .refine(value => value.archived === undefined || (value.title === undefined && value.parentId === undefined), "归档或恢复需单独操作");

export type OrganizePageInput = z.infer<typeof organizePageSchema>;
