/** 项目相关的 Zod schema —— 前后端单一真相源 */
import { z } from "zod";

/**
 * 项目 key（A45）：2–10 字符、大写字母开头、只含大写字母与数字。
 * **创建后不可修改** —— 它是工作项编号的前缀，改了会让已发出的编号失效。
 */
export const projectKeySchema = z
  .string()
  .min(2, "项目标识至少 2 个字符")
  .max(10, "项目标识最多 10 个字符")
  .regex(/^[A-Z][A-Z0-9]*$/, "项目标识必须以大写字母开头，只能包含大写字母与数字");

export const createProjectSchema = z.object({
  key: projectKeySchema,
  name: z.string().min(1, "请输入项目名称").max(200),
  description: z.string().max(5000).nullable().optional(),
  /** 省略 = 三套模板全复制（默认）；指定则只复制那一套 */
  template: z.string().max(40).optional(),
  /** 归属部门（Round 72）：可空；必须是未归档部门 */
  departmentId: z.string().uuid().nullable().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * 更新项目：**刻意不含 key**（A45）。
 * 用 `.strict()` 让传了 key 的请求直接失败，而不是被静默忽略 ——
 * 静默忽略会让调用方以为改成功了。
 */
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  // 负责人（第 26 轮）：可设为某成员，也可置空（null = 未指定）——**不编造默认值**
  leadMemberId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
}).strict();

export const transitionProjectStatusSchema = z.object({
  statusKey: z.string().min(1).max(40),
});

export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  archived: z.enum(["true", "false"]).default("false"),
});
