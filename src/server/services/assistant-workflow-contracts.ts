/** 纯值业务契约：描述授权读取、确认锁和写后复读，不执行查询或修改。 */
import { DomainError } from "../../shared/errors.ts";

type Args = Record<string, unknown>;
export interface AssistantWorkflowRead {
  toolName: string;
  parameters: Args;
}
export interface AssistantWorkflowLock {
  table: string;
  column: string;
  ids: string[];
}
export interface AssistantWorkflowContext {
  /** 由服务端执行 before 后保存的完整授权读取，不能从模型参数构造。 */
  before: (AssistantWorkflowRead & { value: unknown })[];
}
export interface AssistantWorkflowContract {
  title: string;
  scope: "project" | "personal" | "account" | "project-set";
  before(args: Args, projectId: string | null): AssistantWorkflowRead[];
  after(
    args: Args,
    raw: unknown,
    projectId: string | null,
    context?: AssistantWorkflowContext,
  ): AssistantWorkflowRead[];
  locks(args: Args, projectId: string | null): AssistantWorkflowLock[];
}

const read = (
  toolName: string,
  parameters: Args = {},
): AssistantWorkflowRead => ({ toolName, parameters });
const invalid = (field: string): never => {
  throw new DomainError("VALIDATION", `流程契约缺少真实${field}`, null);
};
const id = (args: Args, key: string): string =>
  typeof args[key] === "string" && args[key]
    ? (args[key] as string)
    : invalid(key);
const project = (args: Args, projectId: string | null) =>
  typeof args.projectId === "string" && args.projectId
    ? args.projectId
    : projectId || invalid("projectId");
const byId = (name: string, key: string) => (a: Args) => [
  read(name, { [key]: id(a, key) }),
];
const projectList =
  (name: string, extra: Args = {}) =>
  (a: Args, p: string | null) => [
    read(name, { projectId: project(a, p), ...extra }),
  ];
const members = () => read("member.list");
const lock =
  (table: string, key: string, column = "id") =>
  (a: Args): AssistantWorkflowLock[] => [{ table, column, ids: [id(a, key)] }];
const projectLock = (a: Args, p: string | null): AssistantWorkflowLock[] => [
  { table: "project", column: "id", ids: [project(a, p)] },
];
const combineLocks =
  (...functions: ((a: Args, p: string | null) => AssistantWorkflowLock[])[]) =>
  (a: Args, p: string | null) =>
    functions.flatMap((f) => f(a, p));
const unwrap = (raw: unknown): Args => {
  let value = raw;
  for (let depth = 0; depth < 8; depth++) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const row = value as Args;
    if (
      row.result &&
      typeof row.result === "object" &&
      !Array.isArray(row.result)
    )
      value = row.result;
    else return row;
  }
  return invalid("写入结果");
};
const createdId = (raw: unknown, key = "id", nested?: string) => {
  const row = unwrap(raw);
  return id(nested ? unwrap(row[nested]) : row, key);
};
function observation(
  context: AssistantWorkflowContext | undefined,
  toolName: string,
  key: string,
  value: string,
): Args {
  const result = context?.before.find(
    (r) => r.toolName === toolName && r.parameters[key] === value,
  );
  return result ? unwrap(result.value) : invalid("服务端授权读取快照");
}
const contracts: Record<string, AssistantWorkflowContract> = {};
function define(
  name: string,
  title: string,
  scope: AssistantWorkflowContract["scope"],
  before: AssistantWorkflowContract["before"],
  after: AssistantWorkflowContract["after"],
  locks: AssistantWorkflowContract["locks"] = () => [],
) {
  contracts[name] = { title, scope, before, after, locks };
}
function collection(
  name: string,
  title: string,
  scope: AssistantWorkflowContract["scope"],
  reads: AssistantWorkflowContract["before"],
  locks?: AssistantWorkflowContract["locks"],
) {
  define(name, title, scope, reads, (a, _raw, p) => reads(a, p), locks);
}

// 创建项目不要求存在项目；创建身份只从真实写结果读取。
define(
  "project.create",
  "创建项目",
  "account",
  (a) => [
    read("project.list", { page: 1, pageSize: 100 }),
    ...(typeof a.templateId === "string"
      ? [read("projectTemplate.get", { templateId: a.templateId })]
      : []),
  ],
  (_a, raw) => [read("project.get", { projectId: createdId(raw) })],
);
for (const [name, title] of [
  ["update", "修改项目"],
  ["archive", "归档项目"],
  ["unarchive", "恢复项目"],
  ["status", "调整项目状态"],
])
  collection(
    `project.${name}`,
    title!,
    "project",
    projectList("project.get"),
    projectLock,
  );
for (const [name, title] of [
  ["add", "添加项目成员和角色"],
  ["remove", "移除项目成员"],
]) {
  define(
    `project.member.${name}`,
    title!,
    "project",
    (a, p) => [
      read("project.members", { projectId: project(a, p) }),
      // 添加需要账号候选目录；移除只核验已存在的本项目成员。
      ...(name === "add" ? [members(), read("role.list")] : []),
    ],
    (a, _raw, p) => [read("project.members", { projectId: project(a, p) })],
    combineLocks(
      projectLock,
      lock("project_membership", "memberId", "member_id"),
    ),
  );
}
define(
  "projectTemplate.createProject",
  "从模板创建项目",
  "account",
  (a) => [read("projectTemplate.get", { templateId: id(a, "templateId") })],
  (_a, raw) => [
    read("project.get", { projectId: createdId(raw, "id", "project") }),
  ],
  lock("project_template", "templateId"),
);
define(
  "projectTemplate.create",
  "创建项目模板",
  "account",
  () => [read("projectTemplate.list")],
  (_a, raw) => [read("projectTemplate.get", { templateId: createdId(raw) })],
);
collection(
  "projectTemplate.update",
  "修改项目模板",
  "account",
  byId("projectTemplate.get", "templateId"),
  lock("project_template", "templateId"),
);
define(
  "projectTemplate.delete",
  "删除项目模板",
  "account",
  byId("projectTemplate.get", "templateId"),
  () => [read("projectTemplate.list")],
  lock("project_template", "templateId"),
);

// 工作流子记录由所属工作流授权读取；删除后复读仍存活的父集合。
collection(
  "workflow.create",
  "创建项目工作流",
  "project",
  projectList("workflow.list"),
  projectLock,
);
collection(
  "workflow.update",
  "修改项目工作流",
  "project",
  projectList("workflow.list"),
  lock("workflow", "workflowId"),
);
for (const [suffix, title, childKey, table, query] of [
  ["addState", "添加工作流状态", undefined, undefined, "workflow.states"],
  [
    "updateState",
    "修改工作流状态",
    "stateId",
    "workflow_state",
    "workflow.states",
  ],
  [
    "archiveState",
    "归档工作流状态",
    "stateId",
    "workflow_state",
    "workflow.states",
  ],
  [
    "addTransition",
    "添加工作流迁移",
    undefined,
    undefined,
    "workflow.transitions",
  ],
  [
    "updateTransition",
    "修改工作流迁移审批",
    "transitionId",
    "workflow_transition",
    "workflow.transitions",
  ],
  [
    "removeTransition",
    "删除工作流迁移",
    "transitionId",
    "workflow_transition",
    "workflow.transitions",
  ],
] as const) {
  const before = (a: Args) => [
    read(query, { workflowId: id(a, "workflowId") }),
    ...(query === "workflow.transitions"
      ? [read("workflow.states", { workflowId: id(a, "workflowId") })]
      : []),
  ];
  define(
    `workflow.${suffix}`,
    title,
    "project",
    before,
    (a) => [read(query, { workflowId: id(a, "workflowId") })],
    childKey && table
      ? combineLocks(lock("workflow", "workflowId"), lock(table, childKey))
      : lock("workflow", "workflowId"),
  );
}

for (const [name, title] of [
  ["createRule", "创建自动化规则"],
  ["updateRule", "修改自动化规则"],
  ["deleteRule", "删除自动化规则"],
])
  collection(
    `automation.${name}`,
    title!,
    "project",
    projectList("automation.listRules"),
    name === "createRule"
      ? projectLock
      : combineLocks(projectLock, lock("automation_rule", "ruleId")),
  );
const batchRead = (a: Args) => [
  read("import.get", {
    batchId: id(a, "batchId"), offset: 0, limit: 100, errorOffset: 0, errorLimit: 100,
  }),
];
define(
  "import.create",
  "创建导入批次",
  "project",
  projectList("import.list"),
  (_a, raw) => batchRead({ batchId: createdId(raw, "batchId") }),
  projectLock,
);
for (const [name, title] of [
  ["setMapping", "保存导入映射"],
  ["dryRun", "预演导入并保存报告"],
  ["confirm", "执行已预演导入"],
  ["rollback", "回滚导入批次"],
])
  collection(
    `import.${name}`,
    title!,
    "project",
    batchRead,
    lock("import_batch", "batchId"),
  );

define(
  "intake.createForm",
  "创建需求收集表单",
  "project",
  projectList("intake.listForms"),
  (a, raw, p) => [
    read("intake.getForm", {
      projectId: project(a, p),
      formId: createdId(raw, "id", "form"),
    }),
  ],
  projectLock,
);
collection(
  "intake.updateForm",
  "修改需求收集表单",
  "project",
  (a, p) => [
    read("intake.getForm", {
      projectId: project(a, p),
      formId: id(a, "formId"),
    }),
  ],
  lock("intake_form", "formId"),
);
define(
  "intake.deleteForm",
  "删除需求收集表单",
  "project",
  (a, p) => [
    read("intake.getForm", {
      projectId: project(a, p),
      formId: id(a, "formId"),
    }),
  ],
  (a, _raw, p) => projectList("intake.listForms")(a, p),
  lock("intake_form", "formId"),
);
define(
  "intake.convertSubmission",
  "将需求提交转为想法",
  "project",
  projectList("intake.listSubmissions"),
  (a, raw, p) => [
    read("intake.listSubmissions", { projectId: project(a, p) }),
    read("idea.get", { ideaId: createdId(raw, "id", "idea") }),
  ],
  lock("intake_submission", "submissionId"),
);
collection(
  "intake.rejectSubmission",
  "驳回需求提交",
  "project",
  projectList("intake.listSubmissions"),
  lock("intake_submission", "submissionId"),
);

// 本人数据：scope 与 projectId 解耦，精确 getter 不受“今天”或列表上限影响。
collection("todo.create", "创建本人待办", "personal", () => [
  read("todo.list"),
]);
for (const [name, title] of [
  ["update", "更新本人待办"],
  ["delete", "删除本人待办"],
])
  collection(
    `todo.${name}`,
    title!,
    "personal",
    () => [read("todo.list")],
    lock("todo", "todoId"),
  );
define(
  "focus.createBlock",
  "创建本人时间块",
  "personal",
  (a) => [
    read("focus.blocks", { from: id(a, "startAt"), to: id(a, "endAt") }),
    ...(typeof a.workItemId === "string"
      ? [read("workitem.get", { workItemId: a.workItemId })]
      : []),
    ...(typeof a.projectId === "string"
      ? [read("project.get", { projectId: a.projectId })]
      : []),
  ],
  (_a, raw) => [read("focus.getBlock", { timeBlockId: createdId(raw) })],
);
collection(
  "focus.updateBlock",
  "修改本人时间块",
  "personal",
  byId("focus.getBlock", "timeBlockId"),
  lock("time_block", "timeBlockId"),
);
define(
  "focus.deleteBlock",
  "删除本人时间块",
  "personal",
  byId("focus.getBlock", "timeBlockId"),
  () => [read("focus.blocks")],
  lock("time_block", "timeBlockId"),
);
define(
  "focus.recordSession",
  "记录本人专注会话",
  "personal",
  byId("focus.getBlock", "timeBlockId"),
  (_a, raw) => [read("focus.getSession", { focusSessionId: createdId(raw) })],
  lock("time_block", "timeBlockId"),
);
collection(
  "focus.updateSession",
  "修改本人专注会话",
  "personal",
  byId("focus.getSession", "focusSessionId"),
  lock("focus_session", "focusSessionId"),
);

collection("attachment.upload", "上传业务附件", "project", (a) => [
  read("attachment.list", typeof a.workItemId === "string" ? { workItemId: a.workItemId } : {
    targetType: id(a, "targetType"),
    targetId: id(a, "targetId"),
  }),
]);
define(
  "attachment.remove",
  "移除业务附件",
  "project",
  byId("attachment.get", "attachmentId"),
  (a, _raw, _p, c) => {
    const parent = observation(
      c,
      "attachment.get",
      "attachmentId",
      id(a, "attachmentId"),
    );
    return [
      read("attachment.list", {
        targetType: id(parent, "targetType"),
        targetId: id(parent, "targetId"),
      }),
    ];
  },
  lock("attachment", "attachmentId"),
);
for (const [name, title] of [
  ["create", "创建自定义字段"],
  ["update", "修改自定义字段"],
  ["archive", "归档自定义字段"],
])
  collection(
    `customField.${name}`,
    title!,
    "project",
    projectList("customField.definitions", { includeArchived: true }),
    name === "create"
      ? projectLock
      : combineLocks(projectLock, lock("custom_field_def", "fieldId")),
  );
for (const [name, title] of [
  ["createPolicy", "创建SLA策略"],
  ["updatePolicy", "修改SLA策略"],
  ["deletePolicy", "删除SLA策略"],
])
  collection(
    `sla.${name}`,
    title!,
    "project",
    projectList("sla.listPolicies"),
    name === "createPolicy"
      ? projectLock
      : combineLocks(projectLock, lock("sla_policy", "policyId")),
  );

// project-set 表示可涉及个人/共享视图或多个项目，实际边界由资源 resolver 检查。
define(
  "savedView.create",
  "创建保存视图",
  "project-set",
  (a) => [
    read(
      "savedView.list",
      typeof a.projectId === "string" ? { projectId: a.projectId } : {},
    ),
  ],
  (_a, raw) => [read("savedView.get", { savedViewId: createdId(raw) })],
);
collection(
  "savedView.update",
  "更新保存视图",
  "project-set",
  byId("savedView.get", "savedViewId"),
  lock("saved_view", "savedViewId"),
);
define(
  "savedView.delete",
  "删除保存视图",
  "project-set",
  byId("savedView.get", "savedViewId"),
  (a, _raw, _p, c) => {
    const row = observation(
      c,
      "savedView.get",
      "savedViewId",
      id(a, "savedViewId"),
    );
    return [
      read(
        "savedView.list",
        typeof row.projectId === "string" ? { projectId: row.projectId } : {},
      ),
    ];
  },
  lock("saved_view", "savedViewId"),
);
const viewIds = (a: Args) =>
  Array.isArray(a.ids) &&
  a.ids.every((v) => typeof v === "string")
    ? (a.ids as string[])
    : invalid("ids");
collection(
  "savedView.reorder",
  "重新排列本人保存视图",
  "project-set",
  (a) =>
    viewIds(a).map((savedViewId) => read("savedView.get", { savedViewId })),
  (a) => [{ table: "saved_view", column: "id", ids: viewIds(a) }],
);

const dashboard = (a: Args, p: string | null) => [
  read("dashboard.get", {
    projectId: project(a, p),
    dashboardId: id(a, "dashboardId"),
  }),
];
define(
  "dashboard.create",
  "创建项目仪表盘",
  "project",
  projectList("dashboard.list"),
  (a, raw, p) =>
    dashboard({ projectId: project(a, p), dashboardId: createdId(raw) }, p),
  projectLock,
);
collection(
  "dashboard.update",
  "修改项目仪表盘",
  "project",
  dashboard,
  lock("dashboard", "dashboardId"),
);
define(
  "dashboard.delete",
  "删除项目仪表盘",
  "project",
  dashboard,
  (a, _raw, p) => projectList("dashboard.list")(a, p),
  lock("dashboard", "dashboardId"),
);
for (const [name, title] of [
  ["create", "添加仪表盘组件"],
  ["update", "修改仪表盘组件"],
  ["delete", "移除仪表盘组件"],
]) {
  define(
    `dashboard.widgets.${name}`,
    title!,
    "project",
    dashboard,
    (a, raw, p) => [
      ...dashboard(a, p),
      ...(name === "delete"
        ? []
        : [
            read("dashboard.widgets.data", {
              projectId: project(a, p),
              dashboardId: id(a, "dashboardId"),
              widgetId: name === "create" ? createdId(raw) : id(a, "widgetId"),
            }),
          ]),
    ],
    name === "create"
      ? lock("dashboard", "dashboardId")
      : combineLocks(
          lock("dashboard", "dashboardId"),
          lock("dashboard_widget", "widgetId"),
        ),
  );
}

define(
  "portfolio.create",
  "创建项目组合",
  "account",
  () => [read("portfolio.list")],
  (_a, raw) => [read("portfolio.get", { portfolioId: createdId(raw) })],
);
collection(
  "portfolio.update",
  "修改项目组合",
  "account",
  byId("portfolio.get", "portfolioId"),
  lock("portfolio", "portfolioId"),
);
define(
  "portfolio.delete",
  "删除项目组合分组",
  "account",
  byId("portfolio.get", "portfolioId"),
  () => [read("portfolio.list")],
  lock("portfolio", "portfolioId"),
);
for (const [name, title] of [
  ["addProject", "将项目加入组合"],
  ["removeProject", "将项目移出组合"],
])
  collection(
    `portfolio.${name}`,
    title!,
    "project-set",
    (a) => [
      read("portfolio.get", { portfolioId: id(a, "portfolioId") }),
      read("project.get", { projectId: id(a, "projectId") }),
    ],
    combineLocks(
      lock("portfolio", "portfolioId"),
      lock("portfolio_project", "portfolioId", "portfolio_id"),
      projectLock,
    ),
  );

define(
  "integration.create",
  "创建项目外部集成",
  "project",
  projectList("integration.list"),
  (a, raw, p) => [
    read("integration.syncStatus", {
      projectId: project(a, p),
      integrationId: createdId(raw),
    }),
  ],
  projectLock,
);
const integrationRead = (a: Args, p: string | null) => [
  read("integration.syncStatus", {
    projectId: project(a, p),
    integrationId: id(a, "integrationId"),
  }),
];
collection(
  "integration.update",
  "修改项目外部集成",
  "project",
  integrationRead,
  lock("integration", "integrationId"),
);
collection(
  "integration.sync",
  "同步项目外部集成",
  "project",
  integrationRead,
  lock("integration", "integrationId"),
);
define(
  "integration.delete",
  "删除项目外部集成",
  "project",
  integrationRead,
  (a, _raw, p) => projectList("integration.list")(a, p),
  lock("integration", "integrationId"),
);
for (const [name, title] of [
  ["create", "创建Webhook订阅"],
  ["update", "修改Webhook订阅"],
  ["delete", "删除Webhook订阅"],
])
  collection(
    `webhook.${name}`,
    title!,
    "project",
    projectList("webhook.list"),
    name === "create" ? projectLock : lock("webhook_endpoint", "endpointId"),
  );
collection(
  "webhook.replay",
  "重放Webhook投递",
  "project",
  (a, p) => [
    read("webhook.deliveries", {
      projectId: project(a, p),
      endpointId: id(a, "endpointId"),
    }),
  ],
  combineLocks(
    lock("webhook_endpoint", "endpointId"),
    lock("webhook_delivery", "deliveryId"),
  ),
);

for (const [name, title] of [
  ["create", "创建组织角色"],
  ["update", "修改组织角色"],
  ["delete", "删除组织角色"],
]) {
  define(
    `role.${name}`,
    title!,
    "account",
    () => [
      read("role.list"),
      ...(name === "delete" ? [] : [read("role.permissions")]),
    ],
    () => [read("role.list")],
    name === "create"
      ? undefined
      : combineLocks(
          lock("role", "roleId"),
          lock("role_permission", "roleId", "role_id"),
        ),
  );
}
const scopeOptions = (a: Args) =>
  ["TEAM", "PROJECT", "DEPARTMENT"].includes(String(a.scopeType))
    ? [read("role.scopeOptions", { scopeType: a.scopeType })]
    : [];
define(
  "role.assign",
  "指派成员组织角色",
  "account",
  (a) => [
    members(),
    read("role.list"),
    read("role.assignments", { memberId: id(a, "memberId") }),
    ...scopeOptions(a),
  ],
  (a) => [read("role.assignments", { memberId: id(a, "memberId") })],
  combineLocks(
    lock("member", "memberId"),
    lock("role_assignment", "memberId", "member_id"),
  ),
);
define(
  "role.updateAssignment",
  "修改成员角色指派",
  "account",
  (a) => [
    read("role.getAssignment", { assignmentId: id(a, "assignmentId") }),
    read("role.list"),
    ...scopeOptions(a),
  ],
  (a) => [read("role.getAssignment", { assignmentId: id(a, "assignmentId") })],
  lock("role_assignment", "assignmentId"),
);
define(
  "role.revoke",
  "撤销成员角色指派",
  "account",
  byId("role.getAssignment", "assignmentId"),
  (a, _raw, _p, c) => {
    const row = observation(
      c,
      "role.getAssignment",
      "assignmentId",
      id(a, "assignmentId"),
    );
    return [read("role.assignments", { memberId: id(row, "memberId") })];
  },
  lock("role_assignment", "assignmentId"),
);
for (const [kind, table, query, key, label] of [
  [
    "Department",
    "department",
    "organization.departments",
    "departmentId",
    "部门",
  ],
  ["Position", "position", "organization.positions", "positionId", "职位"],
] as const)
  for (const [verb, title] of [
    ["create", "创建"],
    ["update", "修改"],
    ["archive", "归档"],
  ])
    collection(
      `organization.${verb}${kind}`,
      `${title}${label}`,
      "account",
      () => [
        read(query),
        ...(kind === "Position" ? [read("organization.departments")] : []),
      ],
      verb === "create" ? undefined : lock(table, key),
    );
collection(
  "organization.assignMember",
  "调整成员部门与职位",
  "account",
  (a) => [
    members(),
    read("member.get", { memberId: id(a, "memberId") }),
    read("organization.departments"),
    read("organization.positions"),
  ],
  lock("member", "memberId"),
);
collection("organization.applyTemplate", "应用组织架构模板", "account", () => [
  read("organization.departments"),
  read("organization.positions"),
]);
for (const [verb, title] of [
  ["create", "创建团队"],
  ["update", "修改团队"],
  ["delete", "删除团队"],
])
  collection(
    `team.${verb}`,
    title!,
    "account",
    () => [read("team.list")],
    verb === "create" ? undefined : lock("team", "teamId"),
  );

export const ASSISTANT_WORKFLOW_CONTRACTS: Readonly<
  Record<string, AssistantWorkflowContract>
> = contracts;
/** 精确读取名单；download须由助手投影为授权端点，不能把base64注入模型。 */
export const ASSISTANT_WORKFLOW_READ_TOOLS: string[] = [
  "project.context",
  "project.list",
  "project.get",
  "project.members",
  "member.list",
  "member.get",
  "role.list",
  "projectTemplate.list",
  "projectTemplate.get",
  "workitem.list",
  "workitem.children",
  "workitem.get",
  "workitem.relations",
  "workitem.collaborators",
  "workitem.transfers",
  "workitem.progressUpdates",
  "plan.listIterations",
  "plan.listMilestones",
  "plan.listReleases",
  "plan.getIteration",
  "plan.getRelease",
  "plan.milestoneDetail",
  "idea.list",
  "idea.get",
  "page.list",
  "page.get",
  "page.revisions",
  "knowledge.search",
  "meta.fields",
  "meta.workflow",
  "automation.listRules",
  "automation.testRule",
  "automation.listRuns",
  "import.list",
  "import.get",
  "import.suggestions",
  "intake.listForms",
  "intake.getForm",
  "intake.listSubmissions",
  "insight.burnDown",
  "insight.cumulativeFlow",
  "project.report",
  "workflow.list",
  "workflow.states",
  "workflow.transitions",
  "todo.list",
  "workbench.get",
  "focus.blocks",
  "focus.getBlock",
  "focus.getSession",
  "focus.sessions",
  "focus.today",
  "timeLog.list",
  "attachment.list",
  "attachment.get",
  "attachment.download",
  "customField.definitions",
  "customField.getValues",
  "savedView.list",
  "savedView.get",
  "sla.listPolicies",
  "sla.get",
  "approval.list",
  "dashboard.list",
  "dashboard.get",
  "dashboard.widgets.list",
  "dashboard.widgets.data",
  "portfolio.list",
  "portfolio.get",
  "portfolio.summary",
  "integration.list",
  "integration.syncStatus",
  "webhook.list",
  "webhook.deliveries",
  "organization.departments",
  "organization.positions",
  "team.list",
  "team.members",
  "role.permissions",
  "role.scopeOptions",
  "role.assignments",
  "role.getAssignment",
];

export function assistantWorkflowReads(
  name: string,
  args: Args,
  projectId: string | null,
  raw?: unknown,
  context?: AssistantWorkflowContext,
): AssistantWorkflowRead[] | undefined {
  const contract = contracts[name];
  if (!contract) return undefined;
  return raw === undefined
    ? contract.before(args, projectId)
    : contract.after(args, raw, projectId, context);
}
