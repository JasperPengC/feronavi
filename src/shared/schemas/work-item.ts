/** 工作项相关的 Zod schema —— 前后端单一真相源 */
import { z } from "zod";

export const workItemTypeSchema = z.enum(["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"]);
export const prioritySchema = z.enum(["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"]);
/** S1–S4 仅对缺陷有意义（数据模型 3.1 的 CHECK 也会兜底） */
export const severitySchema = z.enum(["S1", "S2", "S3", "S4"]);

export const createWorkItemSchema = z.object({
  type: workItemTypeSchema,
  title: z.string().min(1, "请输入标题").max(500),
  description: z.string().max(20000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  severity: severitySchema.nullable().optional(),
  estimatePoints: z.number().min(0).max(99999).nullable().optional(),
  estimateHours: z.number().min(0).max(99999).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  // 计划实体关联（第十期补）：work_item 表本就有这四列、更新 schema 也接受，
  // 唯独创建 schema 没有 —— 客户端在创建时传它们会被 zod 静默丢弃（以为是"设了"其实没设）
  milestoneId: z.string().uuid().nullable().optional(),
  iterationId: z.string().uuid().nullable().optional(),
  releaseId: z.string().uuid().nullable().optional(),
  moduleId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
});
export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;

/**
 * 更新工作项 —— **必须带 `version`**（第 4.9 节乐观锁）。
 *
 * ⚠️ `version` 是必填而非可选：允许「不传就跳过校验」等于没有锁。
 */
export const updateWorkItemSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(20000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  severity: severitySchema.nullable().optional(),
  estimatePoints: z.number().min(0).max(99999).nullable().optional(),
  estimateHours: z.number().min(0).max(99999).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  // ── 计划实体关联（第二期 S3）──────────────────────────
  // 传 null 表示解除关联；四个字段都必须与工作项同项目（服务层校验）
  milestoneId: z.string().uuid().nullable().optional(),
  iterationId: z.string().uuid().nullable().optional(),
  releaseId: z.string().uuid().nullable().optional(),
  moduleId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  /**
   * 不可改字段用 strict() 拦住。
   * `number` / `key` / `projectId` / `type` 传了就 400 —— 与项目 key 同理，静默忽略会误导调用方。
   */
}).strict();

export const listWorkItemsQuerySchema = z.object({
  // 文档 REST 6 节：列表/表格/日历/时间线共用一个端点，看板是唯一例外（形状不同）
  view: z.enum(["list", "table", "calendar", "timeline"]).default("list"),
  // 日历窗口（view=calendar）：文档契约用 dateFrom/dateTo；month 是前端按月取的便捷糖
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().max(200).optional(),
  statusKey: z.string().max(40).optional(),
  assigneeId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  iterationId: z.string().uuid().optional(),
  releaseId: z.string().uuid().optional(),
  moduleId: z.string().uuid().optional(),
  type: workItemTypeSchema.optional(),
  priority: prioritySchema.optional(),
  sortBy: z.enum(["created_at", "updated_at", "due_date", "priority", "number"]).optional(),
  unscheduled: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  sort: z.enum(["created", "updated", "priority", "dueDate"]).default("created"),
});

export const boardQuerySchema = z.object({
  pageSizePerColumn: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  priority: prioritySchema.optional(),
  type: z.enum(["TASK", "REQUIREMENT", "DEFECT", "SUBTASK"]).optional(),
  workflowId: z.string().uuid().optional(),
});
