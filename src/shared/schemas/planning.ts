/** 计划实体（里程碑/迭代/版本/模块）的 Zod schema —— 前后端单一真相源 */
import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");

/** 四实体共用的「名称 + 描述」 */
const nameDesc = {
  name: z.string().min(1, "请输入名称").max(200),
  description: z.string().max(5000).nullable().optional(),
};

// ── 里程碑 ────────────────────────────────────────────────
export const createMilestoneSchema = z.object({
  ...nameDesc,
  startDate: dateStr.nullable().optional(),
  dueDate: dateStr.nullable().optional(),
  // 汇总策略可配置（第 4.8 节）
  progressMode: z.enum(["COUNT", "ESTIMATE_WEIGHTED", "MANUAL"]).default("COUNT"),
  // MANUAL 时必须给，其余模式必须为空（DB CHECK 兜底）
  progressValue: z.number().min(0).max(100).nullable().optional(),
});
export const updateMilestoneSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  startDate: dateStr.nullable().optional(),
  dueDate: dateStr.nullable().optional(),
  progressMode: z.enum(["COUNT", "ESTIMATE_WEIGHTED", "MANUAL"]).optional(),
  progressValue: z.number().min(0).max(100).nullable().optional(),
}).strict();

// ── 迭代（起止必填）──────────────────────────────────────
export const createIterationSchema = z.object({
  ...nameDesc,
  startDate: dateStr,
  endDate: dateStr,
  carryOver: z.boolean().optional(),
});
export const updateIterationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  carryOver: z.boolean().optional(),
}).strict();

// ── 版本 ──────────────────────────────────────────────────
export const createReleaseSchema = z.object({
  ...nameDesc,
  versionTag: z.string().max(100).nullable().optional(),
  releaseDate: dateStr.nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
});
export const updateReleaseSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  versionTag: z.string().max(100).nullable().optional(),
  releaseDate: dateStr.nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
}).strict();

// ── 模块（树形，parentId 可空）─────────────────────────────
export const createModuleSchema = z.object({
  ...nameDesc,
  parentId: z.string().uuid().nullable().optional(),
});
export const updateModuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
}).strict();

// ── 保存视图 ──────────────────────────────────────────────
export const createSavedViewSchema = z.object({
  name: z.string().min(1).max(120),
  viewType: z.enum(["LIST", "BOARD", "TABLE", "CALENDAR", "TIMELINE"]),
  scope: z.enum(["PERSONAL", "PROJECT_SHARED"]).default("PERSONAL"),
  projectId: z.string().uuid().nullable().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  sorts: z.array(z.unknown()).optional(),
});
