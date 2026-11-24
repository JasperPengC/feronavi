export const WORKBENCH_GROUP_KEYS = ["assignedToMe", "createdByMe", "overdue", "dueSoon"] as const;
export type WorkbenchGroupKey = typeof WORKBENCH_GROUP_KEYS[number];

export const WORKBENCH_GROUP_LABELS: Record<WorkbenchGroupKey, string> = {
  assignedToMe: "workbench.groupAssigned", createdByMe: "workbench.groupCreated",
  overdue: "workbench.groupOverdue", dueSoon: "workbench.dueSoon",
};
