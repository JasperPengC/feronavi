import type { QueryClient } from "@tanstack/react-query";
import type { ResourceInvalidation, WorkspaceInvalidation } from "../../shared/resource-events.ts";

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
  requirementHistory: scopedKey("requirement-history"),
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
    queryKeys.requirementHistory(...scope),
    queryKeys.workItemSla(...scope), queryKeys.workItemApprovals(...scope),
    queryKeys.workItemChildren(), queryKeys.board(), queryKeys.table(),
    ["work-item-picker"],
    queryKeys.issues(), queryKeys.issueStats(), queryKeys.calendar(), queryKeys.calendarUnscheduled(),
    queryKeys.timeline(), queryKeys.workbench(), queryKeys.projectActivity(), queryKeys.activitySeries(),
    queryKeys.milestoneDetail(), queryKeys.milestones(), queryKeys.iterations(), queryKeys.projects(),
    queryKeys.project(), queryKeys.projectOverview(), queryKeys.planEntities(), queryKeys.iterationCapacity(),
    queryKeys.burndown(), queryKeys.cumulativeFlow(), queryKeys.widgetData(),
    ["portfolios"], ["portfolio"], ["portfolio-summary"],
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export async function invalidateCommentQueries(qc: QueryClient, targetType?: string, targetId?: string): Promise<void> {
  const scope = targetType && targetId ? [targetType, targetId] : [];
  await Promise.all([
    queryKeys.comments(...scope), queryKeys.projectActivity(), queryKeys.activitySeries(),
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/** 普通登录页面与协作页面共用；只重取已挂载且受影响的查询。 */
export async function invalidateResourceQueries(qc: QueryClient, event: ResourceInvalidation): Promise<void> {
  await invalidateResourceBatch(qc, [event]);
}

export async function invalidateResourceBatch(qc: QueryClient, events: ResourceInvalidation[]): Promise<void> {
  const keys = events.flatMap(resourceQueryKeys);
  await qc.invalidateQueries({ predicate: (query) => keys.some((key) => key.every((part, i) => query.queryKey[i] === part)) });
}

/** 服务端已经按成员定向；这里只定位当前账号的相关缓存。 */
export async function invalidateWorkspaceBatch(qc: QueryClient, events: WorkspaceInvalidation[]): Promise<void> {
  const currentMemberId = qc.getQueryData<{ memberId: string }>(["actor"])?.memberId;
  const keys = events.flatMap(event => workspaceQueryKeys(event, currentMemberId));
  await qc.invalidateQueries({ predicate: query => keys.some(key => key.every((part, i) => query.queryKey[i] === part)) });
}
function workspaceQueryKeys(event: WorkspaceInvalidation, currentMemberId?: string): unknown[][] {
  const { domain, projectId, resourceId, resourceType } = event;
  switch (domain) {
    case "ragConversation": return currentMemberId ? [["rag-conversations", currentMemberId], ["rag-conversation", currentMemberId, resourceId]] : [];
    case "todo": return [["todos"], ["workbench"]];
    case "focus": return [["time-blocks"], ["focus-sessions"], ["focus-today"], ["workbench"]];
    case "savedView": return [["saved-views", "personal"], ...(projectId ? [["saved-views", "shared", projectId]] : [])];
    case "portfolio": return [["portfolios"], ["portfolio", resourceId], ["portfolio-summary", resourceId]];
    case "dashboard": return [["dashboard", resourceId], ["widget-data"], ...(projectId ? [["dashboards", projectId]] : [["dashboards"]])];
    case "organization": return [["organization"], ["organization-public"]];
    case "projectTemplate": return [["project-templates"]];
    case "directory": return [["departments"], ["positions"], ["members"], ["teams"], ["team-members"], ["rbac", "members"], ["rbac", "scopes"], ...(resourceType === "MEMBER" ? [["member-permissions", resourceId], ["project-members"], ...(resourceId === currentMemberId ? [["actor"]] : [])] : [])];
    case "role": return [["rbac"], ["roles"], ["teams"], ["team-members"], ["member-permissions"]];
  }
}

function resourceQueryKeys(event: ResourceInvalidation): unknown[][] {
  const { domain, projectId: p, resourceType: type, resourceId: id } = event;
  const keys: unknown[][] = [["project-activity", p], ["activity-series", p]];
  const projectWork = () => keys.push(...[
    "board", "table", "calendar", "calendar-unscheduled", "timeline", "project-overview", "burndown", "cflow", "milestones", "iterations",
  ].map((name) => [name, p]), ["issues", p], ["issues", "global"], ["issue-stats", p], ["issue-stats", "global"], ["workbench"], ["widget-data"], ["portfolios"], ["portfolio"], ["portfolio-summary"]);
  switch (domain) {
    case "attachment": keys.push(["attachments", type, id]); break;
    case "comment": keys.push(["comments", type, id]); break;
    case "plan":
      keys.push(["plan-entities", type.toLowerCase(), p], ["iteration-capacity", id], ["milestone-detail", id], ["burndown", id], ["cflow", id], ["automation-options", p], ["changelog"]);
      projectWork();
      break;
    case "import": keys.push(["imports", p], ["import", id]); projectWork(); break;
    case "workitem":
      // 事件只有变更项ID，父项可能已变更；全部已挂载子列表按前缀失效。
      keys.push(["work-item-children"], ["work-item-picker", p]);
      keys.push(["requirement-changes", id], ["requirement-change", id], ["requirement-change-context", id]);
      keys.push(...["work-item-detail", "work-item-parent", "work-item-children", "work-item-sla", "work-item-approvals", "work-item-links", "work-item-transfers", "work-item-watchers", "work-item-collaborators", "work-item-progress", "work-item-time-logs", "work-item-relations"].map((name) => [name, id]));
      projectWork();
      break;
    case "wiki": keys.push(["wiki-tree", p], ["wiki-page", id], ["wiki-revisions", id], ["wiki-perms", id], ["knowledge-chunks", id], ["knowledge-jobs", id]); break;
    case "project": keys.push(["testing", p], ["requirement-change-context"], ["requirement-change"], ["projects"], ["project", p], ["project-overview", p], ["project-members", p], ["widget-data"], ["portfolios"], ["portfolio"], ["portfolio-summary"]); break;
    case "automation": keys.push(["automation-rules", p], ["automation-runs", p]); break;
    case "sla": keys.push(["sla-policies", p]); break;
    case "workflow": keys.push(["workflows", p], ["wf-states"], ["wf-transitions"], ["board", p]); break;
    case "field": keys.push(["custom-fields", p]); break;
    case "idea": keys.push(["ideas", p], ["idea", id]); break;
    case "intake": keys.push(["intake-forms", p], ["intake-subs", p], ["ideas", p]); break;
    case "report": keys.push(["reports", p], ["report", id]); break;
    case "insight": keys.push(["dashboards", p], ["dashboard"], ["widget-data"]); break;
  }
  return keys;
}
