/** Loss-aware model projection; authorization evidence always uses the complete guarded result. */
function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys
      .filter((k) => row[k] !== undefined && row[k] !== null)
      .map((k) => [k, row[k]]),
  );
}
/** SQL date values have no instant; reject malformed or normalized impossible dates. */
function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
function lifecycleFlag(value: unknown): boolean | null {
  if (value === null) return false;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? true : null;
  return typeof value === "string" &&
    calendarDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
    ? true
    : null;
}
const planDateFields: Record<string, { key: string; deadline: string }> = {
  "plan.listMilestones": { key: "milestones", deadline: "dueDate" },
  "plan.listIterations": { key: "iterations", deadline: "endDate" },
  "plan.listReleases": { key: "releases", deadline: "releaseDate" },
};
export function projectAssistantToolResult(
  name: string,
  value: unknown,
  date = { asOfDate: new Date().toISOString().slice(0, 10), timeZone: "UTC" },
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  const plan = planDateFields[name];
  if (plan && Array.isArray(row[plan.key])) {
    return {
      ...row,
      [plan.key]: (row[plan.key] as Record<string, unknown>[]).map((node) => {
        const deadlineDate = calendarDate(node[plan.deadline]);
        const asOfDate = calendarDate(date.asOfDate);
        const relation =
          !deadlineDate || !asOfDate
            ? "unknown"
            : deadlineDate < asOfDate
              ? "past"
              : deadlineDate === asOfDate
                ? "today"
                : "future";
        const completed = lifecycleFlag(node.completedAt);
        const archived = lifecycleFlag(node.archivedAt);
        const nodeOverdue =
          relation === "unknown"
            ? null
            : relation === "today" || relation === "future"
              ? false
              : completed === true || archived === true
                ? false
                : completed === null || archived === null
                  ? null
                  : relation === "past";
        const completion =
          completed === null ? "unknown" : completed ? "completed" : "open";
        const archival =
          archived === null ? "unknown" : archived ? "archived" : "active";
        const completionLabel =
          completed === null ? "完成情况未知" : completed ? "已完成" : "未完成";
        const archivalLabel =
          archived === null ? "归档情况未知" : archived ? "已归档" : "未归档";
        const deadlineLabel =
          relation === "today"
            ? "今天到期，尚未逾期"
            : relation === "future"
              ? "未来到期"
              : relation === "unknown"
                ? "截止日期未知"
                : nodeOverdue === true
                  ? "截止日期已过，当前节点逾期"
                  : nodeOverdue === false
                    ? "截止日期已过，当前不计未结项逾期"
                    : "截止日期已过，当前节点是否逾期未知";
        const nodeName =
          typeof node.name === "string" && node.name.trim()
            ? node.name
            : "该节点";
        return {
          ...node,
          lifecycleFacts: {
            completion,
            archival,
            statement: `${nodeName}：${completionLabel}；${archivalLabel}；${deadlineLabel}。`,
          },
          dateFacts: {
            ...date,
            deadlineField: plan.deadline,
            deadlineDate,
            relation,
            completed,
            archived,
            nodeOverdue,
          },
        };
      }),
      scheduleAssessment: {
        ...date,
        scope: "node_only",
        projectBehindSchedule: "unknown",
        linkedWorkItemCoverage: "unverified",
        progressBaseline: "unverified",
        note: "完成、归档和日期是各节点独立维度；采用每个节点lifecycleFacts.statement，未逾期或今天到期绝不表示已完成/已闭环，归档也不等于完成。混合状态必须按节点分别陈述，不得将某迭代/版本的完成归给里程碑或其它节点。日期事实仅针对各节点。today为今天到期，尚未逾期；仅past且未完成、未归档可称当前节点逾期。已完成/归档不算当前未结项逾期，也不能据当前日期断言历史是否按时。节点逾期不等于关联任务或全项目整体落后；必须核验具体节点的工作项关联覆盖和明确的预期进度基准，不能把全项目终态数/完成率移用于某节点或直接断言整体落后。",
      },
    };
  }
  if (name === "project.get")
    return {
      ...pick(row, [
        "id",
        "key",
        "name",
        "department",
        "archivedAt",
        "createdAt",
        "updatedAt",
      ]),
      note: "项目元信息；工作项事实请查workitem.list，工作流详情请查meta.workflow。",
    };
  if (name === "workitem.get")
    return {
      ...row,
      note: "若workItem只有statusId而无状态名称/分类，应继续调用meta.workflow（以projectId查询，再按实际workflowId匹配返回的工作流）或workitem.list补齐；UUID不是可读状态，不可要求用户另查。补查失败须明确未知。",
    };
  if (name === "workitem.list" && Array.isArray(row.items)) {
    const items = row.items as Record<string, unknown>[];
    const known = items.filter((i) => typeof i.statusCategory === "string");
    const terminal = known.filter(
      (i) => i.statusCategory === "TERMINAL",
    ).length;
    return {
      ...pick(row, ["total", "page", "pageSize"]),
      items: items.map((i) =>
        pick(i, [
          "id",
          "key",
          "title",
          "type",
          "statusKey",
          "statusName",
          "statusCategory",
          "dueDate",
          "startDate",
          "version",
          "assigneeId",
          "parentId",
          "milestoneId",
          "iterationId",
        ]),
      ),
      planBaseline: {
        state: "unverified",
        projectBehindSchedule: "unknown",
        linkedWorkItemCoverage: "unverified",
        note: "工作项列表不能证明项目没有计划；全项目完成率不能证明某计划节点的关联覆盖或整体落后；讨论是否落后需另查plan.listMilestones、plan.listIterations、plan.listReleases及实际日期。",
      },
      statistics: {
        complete: row.page === 1 && row.total === items.length,
        terminalOnPage: terminal,
        unfinishedOnPage: known.length - terminal,
        unknownCategoryOnPage: items.length - known.length,
        overdueUnfinishedOnPage: known.filter(
          (i) =>
            i.statusCategory !== "TERMINAL" &&
            typeof i.dueDate === "string" &&
            i.dueDate < date.asOfDate,
        ).length,
        ...date,
      },
      note: "精简列表投影；统计仅覆盖本页，complete=true才覆盖全部匹配项。详细字段请workitem.get。",
    };
  }
  return value;
}

/** Resource identities follow each actual result shape, never the tool name alone. */
export function collectAssistantResources(
  name: string,
  value: unknown,
  projectId: string | null,
  seed: import("../../shared/rag.ts").RagBusinessEvidence["resources"] = [],
): import("../../shared/rag.ts").RagBusinessEvidence["resources"] {
  type Resource =
    import("../../shared/rag.ts").RagBusinessEvidence["resources"][number];
  const out: Resource[] = [...seed];
  if (!projectId) return out;
  const add = (kind: Resource["kind"], value: unknown, key = "id") => {
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (row.projectId !== undefined && row.projectId !== projectId)
      throw Error("工具返回资源范围不一致");
    const id = row[key];
    if (
      typeof id === "string" &&
      !out.some((r) => r.kind === kind && r.id === id)
    )
      out.push({ kind, id });
  };
  if (!value || typeof value !== "object") return out;
  const row = value as Record<string, unknown>;
  const list = (key: string, kind: Resource["kind"], idKey = "id") => {
    if (Array.isArray(row[key]))
      for (const item of row[key]) add(kind, item, idKey);
  };
  if (name === "project.context") {
    const sections: Record<string, string> = {
      workItems: "workitem.list",
      iterations: "plan.listIterations",
      milestones: "plan.listMilestones",
      releases: "plan.listReleases",
      modules: "plan.listModules",
    };
    for (const [key, tool] of Object.entries(sections))
      for (const resource of collectAssistantResources(
        tool,
        Array.isArray(row[key]) ? { [key]: row[key] } : row[key],
        projectId,
      )) {
        if (!out.some((r) => r.kind === resource.kind && r.id === resource.id))
          out.push(resource);
      }
  }
  if (name === "idea.list") list("items", "idea");
  if (name === "idea.get") {
    add("idea", row);
    if (typeof row.promotedWorkItemId === "string")
      add("workItem", { id: row.promotedWorkItemId });
  }
  if (name === "workitem.relations")
    for (const key of ["blocks", "blockedBy", "others"])
      list(key, "workItem", "relatedWorkItemId");
  if (name === "plan.milestoneDetail") {
    add("milestone", row.milestone);
    list("relatedWorkItems", "workItem");
  }
  if (name === "workitem.list") list("items", "workItem");
  if (name === "workitem.get") add("workItem", row.workItem);
  if (name === "workitem.children") {
    add("workItem", row.parent);
    list("children", "workItem");
  }
  if (name === "workitem.comments") list("comments", "comment");
  if (name === "plan.listMilestones") list("milestones", "milestone");
  if (name === "plan.listIterations") list("iterations", "iteration");
  if (name === "plan.listReleases") list("releases", "release");
  if (name === "plan.listModules") list("modules", "module");
  if (name === "plan.getIteration") add("iteration", row);
  if (name === "plan.getRelease") add("release", row);
  if (name === "plan.getModule") add("module", row);
  if (name === "plan.getMilestone") {
    add("milestone", row.milestone);
    list("workItems", "workItem");
  }
  if (name === "knowledge.search") list("hits", "page", "pageId");
  if (name === "page.get") add("page", row);
  if (name === "page.list") list("pages", "page");
  if (name === "page.revisions") list("revisions", "page", "pageId");
  return out;
}

/** 执行已复核全部记录；历史卡仅保存有界展示，截断不得冒充完整集合。 */
export function summarizeAssistantClosureValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).map(summarizeAssistantClosureValue);
    return value.length > 40
      ? { items, total: value.length, truncated: true }
      : items;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        summarizeAssistantClosureValue(item),
      ]),
    );
  if (typeof value === "string" && value.length > 4000)
    return `${value.slice(0, 4000)}…（内容已截断，请打开原始记录查看全文）`;
  return value;
}

export const ASSISTANT_CONTEXT_SECTIONS = {
  project: "project.get",
  members: "project.members",
  workflow: "meta.workflow",
  workflows: "meta.workflow",
  fields: "meta.fields",
  customFields: "customField.definitions",
  iterations: "plan.listIterations",
  milestones: "plan.listMilestones",
  releases: "plan.listReleases",
  modules: "plan.listModules",
  workItems: "workitem.list",
};
export const ASSISTANT_CONTEXT_READ_TOOLS = [...new Set(Object.values(
  ASSISTANT_CONTEXT_SECTIONS,
))];
export function assistantContextReadTools(value: unknown) {
  const row = value as Record<string, unknown>;
  return [...new Set(Object.entries(ASSISTANT_CONTEXT_SECTIONS).flatMap(
    ([section, name]) =>
      row &&
      row[section] !== undefined &&
      !(
        row[section] &&
        typeof row[section] === "object" &&
        (row[section] as { unavailable?: unknown }).unavailable === true
      )
        ? [name]
        : [],
  ))];
}
