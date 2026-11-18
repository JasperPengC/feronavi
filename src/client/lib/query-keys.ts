import type { QueryClient } from "@tanstack/react-query";

const scopedKey = <Name extends string>(name: Name) => (...scope: unknown[]) => [name, ...scope] as const;

/** 页面查询、写后刷新和 SSE 共同使用；空参数表示该业务下所有筛选/分页。 */
export const queryKeys = {
  board: scopedKey("board"),
  table: scopedKey("table"),
  issues: scopedKey("issues"),
  issueStats: scopedKey("issue-stats"),
  calendar: scopedKey("calendar"),
  calendarUnscheduled: scopedKey("calendar-unscheduled"),
  timeline: scopedKey("timeline"),
  workbench: scopedKey("workbench"),
  workItemDetail: scopedKey("work-item-detail"),
  workItemParent: scopedKey("work-item-parent"),
  workItemChildren: scopedKey("work-item-children"),
  workItemSla: scopedKey("work-item-sla"),
  workItemApprovals: scopedKey("work-item-approvals"),
  projectActivity: scopedKey("project-activity"),
  activitySeries: scopedKey("activity-series"),
  milestoneDetail: scopedKey("milestone-detail"),
  milestones: scopedKey("milestones"),
  iterations: scopedKey("iterations"),
  projects: scopedKey("projects"),
  project: scopedKey("project"),
  projectOverview: scopedKey("project-overview"),
  planEntities: scopedKey("plan-entities"),
  iterationCapacity: scopedKey("iteration-capacity"),
  burndown: scopedKey("burndown"),
  cumulativeFlow: scopedKey("cflow"),
  widgetData: scopedKey("widget-data"),
  comments: scopedKey("comments"),
  notifications: scopedKey("notifications"),
  presence: scopedKey("presence"),
};

/** 事件只携带工作项 id，没有项目/旧父项信息，因此聚合视图按业务前缀刷新。 */
export async function invalidateWorkItemQueries(qc: QueryClient, id?: string): Promise<void> {
  const scope = id ? [id] : [];
  await Promise.all([
    queryKeys.workItemDetail(...scope), queryKeys.workItemParent(...scope),
    queryKeys.workItemSla(...scope), queryKeys.workItemApprovals(...scope),
    queryKeys.workItemChildren(), queryKeys.board(), queryKeys.table(),
    queryKeys.issues(), queryKeys.issueStats(), queryKeys.calendar(), queryKeys.calendarUnscheduled(),
    queryKeys.timeline(), queryKeys.workbench(), queryKeys.projectActivity(), queryKeys.activitySeries(),
    queryKeys.milestoneDetail(), queryKeys.milestones(), queryKeys.iterations(), queryKeys.projects(),
    queryKeys.project(), queryKeys.projectOverview(), queryKeys.planEntities(), queryKeys.iterationCapacity(),
    queryKeys.burndown(), queryKeys.cumulativeFlow(), queryKeys.widgetData(),
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export async function invalidateCommentQueries(qc: QueryClient, targetType?: string, targetId?: string): Promise<void> {
  const scope = targetType && targetId ? [targetType, targetId] : [];
  await Promise.all([
    queryKeys.comments(...scope), queryKeys.projectActivity(), queryKeys.activitySeries(),
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
}
