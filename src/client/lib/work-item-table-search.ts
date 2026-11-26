/** 表格地址与保存视图共用的状态；计划ID保留到API校验，非法条件不能退化成全部。 */
export const tablePlans = [
  { kind: "milestone", field: "milestoneId", label: "ms.kindMilestone" },
  { kind: "iteration", field: "iterationId", label: "ms.kindIteration" },
  { kind: "release", field: "releaseId", label: "ms.kindRelease" },
  { kind: "module", field: "moduleId", label: "ms.kindModule" },
] as const;
export type TablePlanField = typeof tablePlans[number]["field"];
export type PlanSection = "milestones" | "iteration" | "release" | "module";
export interface TableSearch extends Partial<Record<TablePlanField, string>> {
  page?: number; sortBy?: "number" | "priority" | "dueDate" | "created_at" | "updated_at";
  sortDir?: "asc" | "desc"; type?: string; priority?: string; unscheduled?: boolean;
  item?: string; fromPlan?: PlanSection; fromArchived?: boolean;
}
export function parsePlanningSearch(input: Record<string, unknown>): { section?: PlanSection; archived?: boolean } {
  const section = ["iteration", "release", "module"].includes(String(input.section)) ? input.section as PlanSection : undefined;
  return { ...(section ? { section } : {}), ...(input.archived === true || input.archived === "true" ? { archived: true } : {}) };
}
export function parseTableSearch(input: Record<string, unknown>): TableSearch {
  const result: TableSearch = {};
  const page = Number(input.page);
  if (Number.isSafeInteger(page) && page > 1 && page <= 1_000_000) result.page = page;
  if (["priority", "dueDate", "created_at", "updated_at"].includes(String(input.sortBy))) result.sortBy = input.sortBy as TableSearch["sortBy"];
  if (input.sortDir === "desc") result.sortDir = "desc";
  const type = input.type ?? input.typeF, priority = input.priority ?? input.prioF;
  if (["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"].includes(String(type))) result.type = String(type);
  if (["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(priority))) result.priority = String(priority);
  for (const { field } of tablePlans) {
    if (input[field] != null && input[field] !== "") result[field] = typeof input[field] === "string" ? input[field].slice(0, 128) : "invalid";
  }
  if (input.unscheduled === true || input.unscheduled === "true") result.unscheduled = true;
  if (typeof input.item === "string" && input.item) result.item = input.item;
  if (["milestones", "iteration", "release", "module"].includes(String(input.fromPlan))) result.fromPlan = input.fromPlan as PlanSection;
  if (input.fromArchived === true || input.fromArchived === "true") result.fromArchived = true;
  return result;
}

export function tableFilterState(search: TableSearch): TableSearch {
  const { item: _item, fromPlan: _fromPlan, fromArchived: _fromArchived, ...filters } = search;
  return filters;
}
