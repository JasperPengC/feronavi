/**
 * Feronavi · 数据库 Schema（Drizzle）
 *
 * 本文件是 `docs/数据模型-完整定义.md` 的代码化。当前覆盖第 1 节（身份与权限）、
 * 第 2 节（项目状态定义）与第 3.2 节（工作流）；其余表按第 11 节建表顺序分批补齐。
 *
 * 约定（与数据模型第 0 节一致）：
 *   - 主键：多数表用 uuid + `gen_random_uuid()`；`permission` 例外，主键就是 `key`
 *   - 时间戳一律 `timestamptz`，应用层写 UTC
 *   - 不使用数组与自定义 enum（C-21）；禁用值域用 `CHECK` 手工补（drizzle 表达不了）
 *   - 表名/列名一律 snake_case；TypeScript 侧由 Drizzle 映射为驼峰
 */
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, date, numeric, time, primaryKey, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const now = sql`now()`;

// ══ 1.1 组织（单行）════════════════════════════════════════════

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  defaultLocale: text("default_locale").notNull().default("zh-CN"),
  defaultTimezone: text("default_timezone").notNull().default("Asia/Shanghai"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

// ══ 1.2 团队（数据范围的 TEAM 承载）══════════════════════════════

export const team = pgTable("team", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),                        // NULL = 顶级；自引用 FK 见手写补丁
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  // 同级不重名。PG 默认 NULL 互不相等，故顶级团队（parent_id IS NULL）不受此约束 —— 由应用层保证。
  uniqueIndex("team_parent_name_key").on(t.parentId, t.name),
  index("team_parent_idx").on(t.parentId),
]);

// ══ 1.2b 部门 / 职位（Round 66 对标 YouQu 组织架构）════════════════
// 与 team 的分工：team 用于权限/协作范围；department 是**组织架构**（可挂职位、成员归属），
// 两者都可树形，但不互相替代（参考应用同样同时有部门与项目成员）。
export const department = pgTable("department", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),                        // NULL = 顶级（自引用 FK 见迁移手册）
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("department_parent_name_key").on(t.parentId, t.name),
  index("department_parent_idx").on(t.parentId),
]);

export const position = pgTable("position", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code"),                                  // 可选工号/职位编码
  departmentId: uuid("department_id").references(() => department.id, { onDelete: "set null" }),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("position_name_key").on(t.name),
  index("position_department_idx").on(t.departmentId),
]);

// ══ 1.3 成员 ═══════════════════════════════════════════════════

export const member = pgTable("member", {
  /** SSO 绑定键：`(external_idp, external_subject)` 唯一 —— sub 才是稳定标识（邮箱会改） */
  externalIdp: text("external_idp"),
  externalSubject: text("external_subject"),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // 存小写，3–32 字符；`deleted-` 前缀由正则保留给匿名化（C-26）
  username: text("username").notNull(),
  email: text("email"),                               // 匿名化时置 NULL，故可空
  name: text("name").notNull(),
  status: text("status").notNull(),                   // ACTIVE / DISABLED / LOCKED / ANONYMIZED
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
  passwordHash: text("password_hash").notNull(),      // Argon2id
  timezone: text("timezone"),                         // IANA；仅影响显示
  locale: text("locale").notNull().default("zh-CN"),
  // 组织架构（Round 66）：成员归属部门与职位；删除/归档时置空（不级联删成员）
  departmentId: uuid("department_id").references(() => department.id, { onDelete: "set null" }),
  positionId: uuid("position_id").references(() => position.id, { onDelete: "set null" }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // 历史列名：表示需修改初始密码，管理员直建的普通账号同样使用。
  isInitialAdmin: boolean("is_initial_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("member_username_key").on(t.username),
  // 普通 UNIQUE（不是部分索引）：PG 的 UNIQUE 本就不比较 NULL，匿名化后 email=NULL 不冲突
  uniqueIndex("member_email_key").on(t.email),
]);

// ══ 1.4 角色 / 权限 ════════════════════════════════════════════

export const role = pgTable("role", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull(),                         // ADMIN / PM / MEMBER / GUEST / custom:<slug>
  name: text("name").notNull(),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex("role_key_key").on(t.key)]);

export const permission = pgTable("permission", {
  // 主键就是 key：权限是平台固定的 47 个动作，没有独立标识的必要
  key: text("key").primaryKey(),
  group: text("group").notNull(),                     // 展示分组
  description: text("description").notNull(),
});

export const rolePermission = pgTable("role_permission", {
  roleId: uuid("role_id").notNull().references(() => role.id, { onDelete: "cascade" }),
  permissionKey: text("permission_key").notNull().references(() => permission.key, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })]);

// ══ 1.5 角色分配 ═══════════════════════════════════════════════

export const roleAssignment = pgTable("role_assignment", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => role.id, { onDelete: "cascade" }),
  scopeType: text("scope_type").notNull(),            // ORG / TEAM / PROJECT
  scopeId: uuid("scope_id"),                          // scope_type='ORG' 时必须为 NULL
}, (t) => [
  index("role_assignment_member_idx").on(t.memberId),
  // UNIQUE 里 scope_id 的 NULL 语义由应用层补齐（见数据模型 1.5 的说明）
  uniqueIndex("role_assignment_unique_key").on(t.memberId, t.roleId, t.scopeType, t.scopeId),
]);

// ══ 1.6 会话 / 1.7 API 令牌 ════════════════════════════════════

export const session = pgTable("session", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  // SHA-256（不用 Argon2id：会话校验是高频查询，慢哈希会拖垮每个请求）
  tokenHash: text("token_hash").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("session_token_hash_key").on(t.tokenHash),
  index("session_member_idx").on(t.memberId),
  index("session_expires_idx").on(t.expiresAt),
]);

export const apiToken = pgTable("api_token", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),            // SHA-256 / HMAC-SHA-256
  tokenPrefix: text("token_prefix").notNull(),        // 列表页显示 fero_...abcd
  tier: text("tier").notNull(),                       // READ_ONLY / READ_WRITE / ADMIN
  projectWhitelist: jsonb("project_whitelist").notNull().default(sql`'[]'::jsonb`),
  allowedIpCidrs: jsonb("allowed_ip_cidrs").notNull().default(sql`'[]'::jsonb`),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("api_token_hash_key").on(t.tokenHash),
  index("api_token_member_idx").on(t.memberId),
  // 规范 1.7：档位只有三档，DB 层兜底（应用层也校验）
  check("api_token_tier_allowed", sql`${t.tier} IN ('READ_ONLY','READ_WRITE','ADMIN')`),
]);

// ══ 3.2 工作流 ═════════════════════════════════════════════════

export const workflow = pgTable("workflow", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // ⚠️ 必须 CASCADE（规范 3.2 明确要求）：否则删项目会留下孤儿工作流副本。
  //    实测踩到：漏建外键后测试删项目不级联，workflow_state 累积到 374。
  projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  appliesToType: text("applies_to_type").notNull(),   // REQUIREMENT / TASK / DEFECT / SUBTASK
  isDefault: boolean("is_default").notNull().default(false),
  isBuiltin: boolean("is_builtin").notNull().default(false),
}, (t) => [
  // 项目内：每种类型恰好一个默认工作流
  uniqueIndex("workflow_default_per_type_key")
    .on(t.projectId, t.appliesToType)
    .where(sql`${t.isDefault}`),
  // 平台级：每个 applies_to_type 只有一套内置模板。
  // ⚠️ 不能靠上面那条兜住 —— PG 的 NULL 互不相等，`project_id IS NULL` 的行在上面不受约束，
  //    重复执行种子会插出第二套模板（实测踩到，workflow_state 从 22 涨到 44）。
  uniqueIndex("workflow_platform_template_key")
    .on(t.appliesToType)
    .where(sql`${t.projectId} is null`),
]);

export const workflowState = pgTable("workflow_state", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id").notNull().references(() => workflow.id, { onDelete: "cascade" }),
  key: text("key").notNull(),                         // 稳定标识，不改名（MCP meta.workflow 依赖）
  name: text("name").notNull(),                       // 可改名
  category: text("category").notNull(),               // NOT_STARTED / IN_PROGRESS / TERMINAL
  color: text("color").notNull(),                     // 中性色 token 键，非 hex
  /** 看板列 WIP 上限：NULL = 不限制；软提醒，不硬阻止流转 */
  wipLimit: integer("wip_limit"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("workflow_state_key_key").on(t.workflowId, t.key),
  index("workflow_state_wf_category_idx").on(t.workflowId, t.category),
]);

export const workflowTransition = pgTable("workflow_transition", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id").notNull().references(() => workflow.id, { onDelete: "cascade" }),
  fromStateId: uuid("from_state_id").notNull().references(() => workflowState.id, { onDelete: "cascade" }),
  toStateId: uuid("to_state_id").notNull().references(() => workflowState.id, { onDelete: "cascade" }),
  allowedRoleIds: jsonb("allowed_role_ids").notNull().default(sql`'[]'::jsonb`),  // 空 = 不限制
  requiredFields: jsonb("required_fields").notNull().default(sql`'[]'::jsonb`),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approverRoleKeys: jsonb("approver_role_keys").notNull().default(sql`'[]'::jsonb`),
  label: text("label"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  uniqueIndex("workflow_transition_edge_key").on(t.workflowId, t.fromStateId, t.toStateId),
  index("workflow_transition_from_idx").on(t.fromStateId),
]);

/** 审批请求：流转配置 requiresApproval 时，先落一条待审批记录，不直接改状态。 */
export const approvalRequest = pgTable("approval_request", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workItemId: uuid("work_item_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflow.id, { onDelete: "cascade" }),
  fromStateId: uuid("from_state_id").notNull().references(() => workflowState.id, { onDelete: "cascade" }),
  toStateId: uuid("to_state_id").notNull().references(() => workflowState.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").references(() => member.id, { onDelete: "set null" }),
  approverRoleKeys: jsonb("approver_role_keys").notNull().default(sql`'[]'::jsonb`),
  transitionFields: jsonb("transition_fields").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("PENDING"),
  comment: text("comment"),
  decidedBy: uuid("decided_by").references(() => member.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("approval_request_item_idx").on(t.workItemId, t.status),
  check("approval_request_status_allowed", sql`${t.status} IN ('PENDING','APPROVED','REJECTED','CANCELLED')`),
]);

// ══ 2.2 项目状态定义 ═══════════════════════════════════════════

export const projectStatusDef = pgTable("project_status_def", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),               // 终态判定读它，不读 key
  color: text("color").notNull().default("neutral"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [uniqueIndex("project_status_def_key_key").on(t.key)]);

// ══ 2.1 项目 ══════════════════════════════════════════════════

export const project = pgTable("project", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // 工作项编号前缀来源。**创建后不可改**（A45）——改了会让已发出的编号失效
  key: text("key").notNull(),
  // 项目级编号计数器（Jira pcounter 模式）。分配用原子 UPDATE，禁止 SELECT max()+1
  nextIssueNumber: integer("next_issue_number").notNull().default(1),
  name: text("name").notNull(),
  description: text("description"),
  statusId: uuid("status_id").references(() => projectStatusDef.id, { onDelete: "set null" }),
  // 置 true 时禁止一切写操作（建/改/删工作项等）
  lifecycleLock: boolean("lifecycle_lock").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => member.id, { onDelete: "restrict" }),
  /** 负责人（第 24 轮新增）：项目的第一责任人；与 createdBy（创建人）是两个概念 */
  leadMemberId: uuid("lead_member_id"),
  /** 归属部门（Round 72 组织架构增强）：删除部门置空，不影响项目本身 */
  departmentId: uuid("department_id").references(() => department.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex("project_key_key").on(t.key)]);

// ══ 2.3 项目成员 ══════════════════════════════════════════════

export const projectMembership = pgTable("project_membership", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  // ⚠️ 对角色是 RESTRICT：删除被项目使用的角色会被数据库拒绝（第 5.2 节三级行为）
  roleId: uuid("role_id").notNull().references(() => role.id, { onDelete: "restrict" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("project_membership_unique_key").on(t.projectId, t.memberId),
  // 「我参与的项目」数据范围的命中路径
  index("project_membership_member_idx").on(t.memberId),
]);

// ══ 3.1 工作项（最核心）═══════════════════════════════════════

export const workItem = pgTable("work_item", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  // 项目内序号，从 1 连续递增。**软删不复用**（编号是外部引用）
  number: integer("number").notNull(),
  // 冗余存储 `${project.key}-${number}`，列表查询无需 JOIN
  key: text("key").notNull(),
  type: text("type").notNull(),                        // REQUIREMENT / TASK / DEFECT / SUBTASK
  title: text("title").notNull(),
  description: text("description"),                    // Markdown
  workflowId: uuid("workflow_id").notNull().references(() => workflow.id, { onDelete: "restrict" }),
  statusId: uuid("status_id").notNull().references(() => workflowState.id, { onDelete: "restrict" }),
  parentId: uuid("parent_id"),                         // 自引用（子任务），FK 见手写补丁
  // ── 计划实体关联（第二期）───────────────────────────────
  // ⚠️ 全部 ON DELETE SET NULL：归档/删除计划实体不应连带删工作项
  milestoneId: uuid("milestone_id").references(() => milestone.id, { onDelete: "set null" }),
  iterationId: uuid("iteration_id").references(() => iteration.id, { onDelete: "set null" }),
  releaseId: uuid("release_id").references(() => release.id, { onDelete: "set null" }),
  moduleId: uuid("module_id").references(() => module.id, { onDelete: "set null" }),
  assigneeId: uuid("assignee_id").references(() => member.id, { onDelete: "set null" }),  // NULL = 未指派
  reporterId: uuid("reporter_id").notNull().references(() => member.id, { onDelete: "restrict" }),
  priority: text("priority"),                          // LOWEST / LOW / MEDIUM / HIGH / URGENT
  severity: text("severity"),                          // S1–S4，仅 DEFECT 有效
  estimatePoints: numeric("estimate_points", { precision: 6, scale: 1 }),
  estimateHours: numeric("estimate_hours", { precision: 6, scale: 2 }),
  startDate: date("start_date"),                       // 无时区
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),  // 终态进入/离开时写入/清空
  version: integer("version").notNull().default(1),    // 乐观锁
  deletedAt: timestamp("deleted_at", { withTimezone: true }),      // 软删
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("work_item_project_number_key").on(t.projectId, t.number),   // 编号唯一范围 = 项目内
  uniqueIndex("work_item_key_key").on(t.key),
  index("work_item_status_idx").on(t.statusId),        // 看板聚合主路径
  index("work_item_assignee_idx").on(t.assigneeId),
  // 软删过滤后列表按项目分页
  index("work_item_project_created_idx").on(t.projectId, t.createdAt),
]);

// ══ 8.3 设置与初始化状态 ══════════════════════════════════════

export const setting = pgTable("setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  // true 时 value 存信封加密后的密文；查询接口**一律不可回显**
  isSecret: boolean("is_secret").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

/** 安装向导的状态机落点：**恰好一行** */
export const setupState = pgTable("setup_state", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  initializedAt: timestamp("initialized_at", { withTimezone: true }),
  currentStep: integer("current_step"),
  restoredPackageId: uuid("restored_package_id"),
});

// ══ 1.8 一次性令牌（重置密码 / 邀请）══════════════════════════

/** 密码重置令牌：**15 分钟、单次有效、绝不写日志**（第 5.11 节） */
export const passwordResetToken = pgTable("password_reset_token", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  // NULL = 用户自助；非 NULL = 管理员/CLI 生成（第 5.11 节两条路径共用本表）
  issuedByMemberId: uuid("issued_by_member_id").references(() => member.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("password_reset_token_hash_key").on(t.tokenHash),
  index("password_reset_token_member_idx").on(t.memberId),
]);

/** 邀请：**7 天、单次使用** */
export const invite = pgTable("invite", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  /** 邀请时可选绑定项目：接受后成为项目成员并按 projectRoleIds 授项目级角色（Round 54） */
  projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
  projectRoleIds: jsonb("project_role_ids").notNull().default(sql`'[]'::jsonb`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  invitedByMemberId: uuid("invited_by_member_id").references(() => member.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("invite_token_hash_key").on(t.tokenHash),
  index("invite_email_idx").on(t.email),
]);

// ══ 4.1 里程碑 ════════════════════════════════════════════════

export const milestone = pgTable("milestone", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // ⚠️ date 而非 timestamptz：日期没有时刻概念，混用会让时区 bug 从第一天就存在
  startDate: date("start_date"),
  dueDate: date("due_date"),
  // 可配置的汇总策略（第 4.8 节）
  progressMode: text("progress_mode").notNull().default("COUNT"),
  progressValue: numeric("progress_value", { precision: 5, scale: 2 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [index("milestone_project_idx").on(t.projectId)]);

// ══ 4.2 迭代 ══════════════════════════════════════════════════

export type PlanCompletionResult = import("../shared/schemas/planning.ts").PlanCompletionResult;

export const iteration = pgTable("iteration", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // 迭代必须有起止日期（否则燃尽图画不出来）
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completionResult: jsonb("completion_result").$type<PlanCompletionResult>(),
  // 未完成项是否结转到下个迭代
  carryOver: boolean("carry_over").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("iteration_project_idx").on(t.projectId)]);

/** 迭代容量：与 iteration 是 1:N（A43）—— 换人时不能丢历史 */
export const iterationCapacity = pgTable("iteration_capacity", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  iterationId: uuid("iteration_id").notNull().references(() => iteration.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  capacityPoints: numeric("capacity_points", { precision: 6, scale: 1 }),
  capacityHours: numeric("capacity_hours", { precision: 6, scale: 2 }),
  // 燃尽图数据源，变更即写
  loggedPoints: numeric("logged_points", { precision: 6, scale: 1 }).notNull().default("0"),
}, (t) => [
  uniqueIndex("iteration_capacity_unique_key").on(t.iterationId, t.memberId),
]);

// ══ 4.4 版本 / 模块 ═══════════════════════════════════════════

export const release = pgTable("release", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  versionTag: text("version_tag"),
  releaseDate: date("release_date"),
  // 用户可见更新说明（Round 67 对标 YouQu 更新日志）：为空表示不进入 changelog
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completionResult: jsonb("completion_result").$type<PlanCompletionResult>(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  uniqueIndex("release_project_name_key").on(t.projectId, t.name),
]);

export const module = pgTable("module", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),                        // 树形，FK 见手写补丁
  // 文档 4.4：模块负责人（可空）
  leadMemberId: uuid("lead_member_id").references(() => member.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  // 文档 4.4：UNIQUE (project_id, parent_id, name) —— 同项目同级不重名。
  // ⚠️ PG 的 NULL 不参与唯一比较：顶级模块（parent_id NULL）之间不判重，
  //    与文档口径一致；如需强判重需表达式索引，属规范演进项。
  uniqueIndex("module_parent_name_key").on(t.projectId, t.parentId, t.name),
  index("module_project_idx").on(t.projectId),
]);

// ══ 2.5 保存视图 ══════════════════════════════════════════════

export const savedView = pgTable("saved_view", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: uuid("owner_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  // PERSONAL = 纯个人视图（project_id 可空）；PROJECT_SHARED = 项目内共享（必填）
  scope: text("scope").notNull(),
  projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
  viewType: text("view_type").notNull(),             // LIST / BOARD / TABLE / CALENDAR / TIMELINE
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
  sorts: jsonb("sorts").notNull().default(sql`'[]'::jsonb`),
  isPinned: boolean("is_pinned").notNull().default(false),
  /** 拖拽排序（Round 37 补列）：越小越靠前；列表按它排序，POST /saved-views/reorder 批量写入 */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [index("saved_view_owner_idx").on(t.ownerId)]);

// ══ 个人待办（第二期 S5）═════════════════════════════════════

export const todo = pgTable("todo", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueDate: date("due_date"),
  done: boolean("done").notNull().default(false),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  // 工作台主查询：我的未完成待办，按创建时间
  index("todo_member_done_idx").on(t.memberId, t.done, t.createdAt),
]);

// ══ 7.1 评论（多态，一套顶多套）═══════════════════════════════

export const comment = pgTable("comment", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // 多态：刻意不加 FK（不同 target 类型无法共用一个外键）
  targetType: text("target_type").notNull(),          // WORK_ITEM / IDEA / PAGE
  targetId: uuid("target_id").notNull(),
  // RESTRICT：成员删除走匿名化（行保留、status 变更），不物理删 member
  authorId: uuid("author_id").notNull().references(() => member.id, { onDelete: "restrict" }),
  body: text("body").notNull(),                       // Markdown
  parentId: uuid("parent_id"),                        // 自引用，FK 见手写补丁
  // NULL = 未编辑过
  editedAt: timestamp("edited_at", { withTimezone: true }),
  // 软删：**保留线程结构**，不把回复变成孤儿
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("comment_target_idx").on(t.targetType, t.targetId, t.createdAt),
]);

// ══ 7.2 订阅 / @提及 ══════════════════════════════════════════

/** 关注者：只订阅变更通知，**无编辑权**（与协作者的分工） */
export const subscription = pgTable("subscription", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  // IN_APP / EMAIL —— 同一对象可按渠道分行
  notifyChannel: text("notify_channel").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("subscription_unique_key").on(t.memberId, t.targetType, t.targetId, t.notifyChannel),
  // 「谁关注了它」—— 通知扇出时必走
  index("subscription_target_idx").on(t.targetType, t.targetId),
]);

/** @提及：**永不聚合、实时送达**（第 5.5 节），此表是聚合逻辑的豁免依据 */
export const mention = pgTable("mention", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceType: text("source_type").notNull(),          // WORK_ITEM / PAGE / IDEA / COMMENT
  sourceId: uuid("source_id").notNull(),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("mention_unique_key").on(t.sourceType, t.sourceId, t.memberId),
]);

// ══ 7.3 附件 ══════════════════════════════════════════════════

export const attachment = pgTable("attachment", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  targetType: text("target_type").notNull(),          // WORK_ITEM / PAGE / IDEA / COMMENT
  targetId: uuid("target_id").notNull(),
  uploaderId: uuid("uploader_id").notNull().references(() => member.id, { onDelete: "restrict" }),
  originalName: text("original_name").notNull(),
  // UUID 命名，不可预测（L1 要求：不能让人猜到别人的文件地址）
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  // ⚠️ 文档 7.3 规定 bigint（不是 integer）：上限虽是 1GB 在 int 范围内，
  //    但列类型属于数据契约，跟着文档走，避免未来调上限时再改类型。
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  // 秒传 + 去重
  contentHash: text("content_hash").notNull(),
  /** 上传时的存储后端；切换配置后旧附件仍按原后端读取 */
  storageBackend: text("storage_backend").notNull().default("local"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("attachment_target_idx").on(t.targetType, t.targetId),
  index("attachment_hash_idx").on(t.contentHash),
  check("attachment_storage_backend_allowed", sql`${t.storageBackend} IN ('local','s3')`),
]);

// ══ 7.4 通知 / 免打扰偏好 ══════════════════════════════════════

export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  recipientId: uuid("recipient_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  // 公告群发可为 NULL
  actorId: uuid("actor_id").references(() => member.id, { onDelete: "set null" }),
  // 领域事件名，**不硬编码枚举**（第 4.8 节决策 6）
  type: text("type").notNull(),
  category: text("category").notNull(),              // MENTION/ASSIGN/TRANSITION/FIELD_CHANGE/ANNOUNCEMENT
  title: text("title").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  // 用时间戳而非 boolean：天然表示顺序
  readAt: timestamp("read_at", { withTimezone: true }),
  // 聚合窗口内同一对象同一操作归一组
  groupKey: text("group_key"),
  itemCount: integer("item_count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("notification_recipient_idx").on(t.recipientId, t.readAt, t.createdAt),
  index("notification_group_idx").on(t.groupKey),
]);

/**
 * 免打扰偏好。
 * ⚠️ `dnd_timezone` 按**用户**时区，与第 5.4 节的组织时区是两件事。
 * ⚠️ `dnd_start` / `dnd_end` 用 `time` 且可 NULL；**跨天由 start > end 表达**（22:00–08:00）。
 */
export const notificationPreference = pgTable("notification_preference", {
  memberId: uuid("member_id").primaryKey().references(() => member.id, { onDelete: "cascade" }),
  categoryPrefs: jsonb("category_prefs").notNull().default(sql`'{}'::jsonb`),
  dndStart: time("dnd_start"),
  dndEnd: time("dnd_end"),
  dndTimezone: text("dnd_timezone").notNull().default("Asia/Shanghai"),
  digestFrequency: text("digest_frequency").notNull().default("OFF"),   // OFF / DAILY / WEEKLY
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

// ══ 8.1 活动与审计（第四期 W3）═════════════════════════════════

/** 活动时间线：用户可见，summary 是**预渲染中文文案**（避免前端拼装） */
export const activityEntry = pgTable("activity_entry", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
  // SET NULL：成员匿名化后活动仍在，只是"谁做的"不可考
  actorId: uuid("actor_id").references(() => member.id, { onDelete: "set null" }),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("activity_project_idx").on(t.projectId, t.createdAt),
  index("activity_target_idx").on(t.targetType, t.targetId),
]);

/** 审计：**只读、不可删**（无任何 UPDATE/DELETE 端点），severity 决定保留期 */
export const auditEntry = pgTable("audit_entry", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // 可 NULL 且**不级联**（C-18：成员永不物理删，审计不断链）
  actorId: uuid("actor_id"),
  // 匿名化后保留展示名（非 PII，如"已注销成员#a1f3"）
  actorSnapshot: text("actor_snapshot"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  // ⚠️ 只允许字段名 + 枚举/状态码 + 不可逆 ID（白名单由审计服务统一过滤）
  changes: jsonb("changes"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  // SECURITY 保留 1 年 / BUSINESS 保留 90 天
  severity: text("severity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("audit_created_idx").on(t.createdAt),
  index("audit_actor_idx").on(t.actorId, t.createdAt),
  index("audit_severity_idx").on(t.severity, t.createdAt),
]);

// ══ 第五期 B 线：关系 / 协作者 / 工时 / 个人偏好 ═════════════════

/** 阻塞/关联关系。⚠️ 不允许环（C-13）：保存前应用层跑递归检测 */
export const workItemRelation = pgTable("work_item_relation", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // 冗余 project_id：项目级查询不用 join 工作项
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  // BLOCKED_BY 是 BLOCKS 的反向视角，写入时归一成 BLOCKS
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("work_item_relation_unique_key").on(t.sourceId, t.targetId, t.type),
  index("work_item_relation_target_idx").on(t.targetId, t.type),
]);

/** 协作者：对工作项有编辑权（C-23：区别于只收通知的关注者） */
export const workItemCollaborator = pgTable("work_item_collaborator", {
  workItemId: uuid("work_item_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  primaryKey({ columns: [t.workItemId, t.memberId] }),
  // 「我参与协作的工作项」—— 工作台主查询路径
  index("work_item_collaborator_member_idx").on(t.memberId),
]);

/** 工时：只记录不计费（第 3.2 节 Non-goals） */
export const timeLog = pgTable("time_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workItemId: uuid("work_item_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "restrict" }),
  minutes: integer("minutes").notNull(),
  // 业务日期而非 timestamptz（第 5.4 节：记工时按日历日）
  loggedDate: date("logged_date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("time_log_item_idx").on(t.workItemId),
  index("time_log_member_date_idx").on(t.memberId, t.loggedDate),
]);

/** 个人偏好：外观/语言/时区/信息密度（REST 7e） */
export const memberPreference = pgTable("member_preference", {
  memberId: uuid("member_id").primaryKey().references(() => member.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("system"),      // dark / light / system
  locale: text("locale").notNull().default("zh-CN"),
  timezone: text("timezone"),
  density: text("density").notNull().default("comfortable"), // comfortable / compact
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

// ══ CRDT 协作房间（文本协作与业务协同上下文的共同边界）════════════

/** 协作房间：PAGE 使用 TEXT_CRDT，其余资源先作为 COMMAND 上下文。 */
export const collabRoom = pgTable("collab_room", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  baseRevisionId: uuid("base_revision_id").references(() => pageRevision.id, { onDelete: "set null" }),
  snapshotSequence: bigint("snapshot_sequence", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("collab_room_resource_key").on(t.resourceType, t.resourceId),
  index("collab_room_project_idx").on(t.projectId),
  check("collab_room_type_allowed", sql`${t.resourceType} IN ('PAGE','WORK_ITEM','COMMENT','PLAN','APPROVAL','AUTOMATION')`),
  check("collab_room_mode_allowed", sql`${t.mode} IN ('TEXT_CRDT','COMMAND')`),
]);

/** 房间成员与客户端心跳；历史操作不依赖此表。 */
export const collabMember = pgTable("collab_member", {
  roomId: uuid("room_id").notNull().references(() => collabRoom.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  connected: boolean("connected").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  primaryKey({ columns: [t.roomId, t.memberId, t.clientId] }),
  index("collab_member_member_idx").on(t.memberId, t.lastSeenAt),
]);

/** Yjs update 的 base64 表示；operationId 保证客户端重试不会重复追加。 */
export const collabUpdate = pgTable("collab_update", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  roomId: uuid("room_id").notNull().references(() => collabRoom.id, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  actorId: uuid("actor_id").notNull().references(() => member.id, { onDelete: "restrict" }),
  clientId: text("client_id").notNull(),
  operationId: text("operation_id").notNull(),
  updateBase64: text("update_base64").notNull(),
  stateVectorHash: text("state_vector_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("collab_update_room_sequence_key").on(t.roomId, t.sequence),
  uniqueIndex("collab_update_operation_key").on(t.roomId, t.actorId, t.clientId, t.operationId),
  index("collab_update_room_created_idx").on(t.roomId, t.createdAt),
]);

/** 压缩后的 Yjs 状态；旧快照永不覆盖，便于恢复与审计。 */
export const collabSnapshot = pgTable("collab_snapshot", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  roomId: uuid("room_id").notNull().references(() => collabRoom.id, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  stateBase64: text("state_base64").notNull(),
  baseRevisionId: uuid("base_revision_id").references(() => pageRevision.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("collab_snapshot_room_sequence_key").on(t.roomId, t.sequence),
  index("collab_snapshot_room_sequence_idx").on(t.roomId, t.sequence),
  index("collab_snapshot_room_created_idx").on(t.roomId, t.createdAt),
]);

// ══ 3.4 自定义字段（第八期）════════════════════════════════════

/** 字段定义：项目级，UNIQUE (project_id, key) */
export const customFieldDef = pgTable("custom_field_def", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),                 // 取值由 CHECK 兜底
  // 单选/多选选项 [{value,label,color}]
  options: jsonb("options").notNull().default(sql`'[]'::jsonb`),
  // 在哪些状态下必填（状态 key 列表）
  requiredStates: jsonb("required_states").notNull().default(sql`'[]'::jsonb`),
  isRequired: boolean("is_required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("custom_field_def_project_key").on(t.projectId, t.key),
  index("custom_field_def_project_idx").on(t.projectId),
  check("custom_field_def_type_allowed",
    sql`${t.type} IN ('TEXT','NUMBER','DATE','SINGLE_SELECT','MULTI_SELECT','PERSON')`),
]);

/**
 * 字段值：宽表 + JSONB（避免每加一字段就改表）。
 * ⚠️ 规范明确：jsonb 无法约束「fieldDefId → type」，**类型校验必须在应用层做**，
 *    每次读写都经领域服务层，不得直查本表。
 */
export const customFieldValue = pgTable("custom_field_value", {
  workItemId: uuid("work_item_id").primaryKey().references(() => workItem.id, { onDelete: "cascade" }),
  values: jsonb("values").notNull().default(sql`'{}'::jsonb`),   // { "<fieldDefId>": 值 }
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

// ══ 5.4 导入（第九期）════════════════════════════════════════

/** 导入批次：试运行 → 确认 → 写入 → 可整批回滚 */
export const importBatch = pgTable("import_batch", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  filename: text("filename"),
  status: text("status").notNull(),
  // 字段映射 + 用户映射（禅道用户名 → memberId）的人工确认结果
  mappingConfig: jsonb("mapping_config").notNull().default(sql`'{}'::jsonb`),
  totalRows: integer("total_rows").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  /** 原始行数据（dry-run 与 confirm 都要用；确认后仍保留以支持 retry-failed） */
  rows: jsonb("rows").notNull().default(sql`'[]'::jsonb`),
  errorReport: jsonb("error_report"),
  createdBy: uuid("created_by").notNull().references(() => member.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("import_batch_project_status_idx").on(t.projectId, t.status),
  index("import_batch_status_created_idx").on(t.status, t.createdAt),
  check("import_batch_source_allowed", sql`${t.source} IN ('CSV','EXCEL','ZENTAO_API','JIRA_API')`),
  check("import_batch_status_allowed",
    sql`${t.status} IN ('DRY_RUN','PENDING_CONFIRM','RUNNING','SUCCEEDED','PARTIAL','FAILED','ROLLED_BACK')`),
]);

/**
 * 外部 ID ↔ 内部 ID 映射（**幂等的载体**）
 *
 * ⚠️ 规范列清单漏写 `project_id`，但 UNIQUE 写的是 `(entity, external_id, project_id)`
 *    （v1.38 更正：全局唯一会把「同一外部 ID 导入到第二个项目」误判成重复）——
 *    本期补列并同步文档，记为修正。
 */
export const importMapping = pgTable("import_mapping", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: uuid("batch_id").notNull().references(() => importBatch.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  externalId: text("external_id").notNull(),
  internalId: uuid("internal_id").notNull(),
  /** 回滚后置 false 而**不删除** —— 删了再次导入会生成新数据，直接破坏幂等 */
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("import_mapping_entity_external_project").on(t.entity, t.externalId, t.projectId),
  index("import_mapping_batch_entity_idx").on(t.batchId, t.entity),
  check("import_mapping_entity_allowed",
    sql`${t.entity} IN ('WORK_ITEM','MILESTONE','ITERATION','RELEASE','MODULE','USER')`),
]);

// ══ 8.1b 指标快照 / 8.2 仪表盘（第十期）═════════════════════════

/**
 * 燃尽/累积流的数据源。**不单独暴露 CRUD 端点**（规范：由 worker 定时写入，
 * 避免出现"手改指标"的入口）。
 */
export const metricSnapshot = pgTable("metric_snapshot", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  iterationId: uuid("iteration_id").notNull().references(() => iteration.id, { onDelete: "cascade" }),
  /** NULL = 全项目（规范的部分唯一索引语义） */
  memberId: uuid("member_id").references(() => member.id, { onDelete: "cascade" }),
  snapshotDate: date("snapshot_date").notNull(),
  scopePoints: numeric("scope_points", { precision: 8, scale: 1 }).notNull().default("0"),
  donePoints: numeric("done_points", { precision: 8, scale: 1 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("metric_snapshot_iteration_member_date").on(t.iterationId, t.memberId, t.snapshotDate),
  /**
   * ⚠️ 规范豁免清单第 3 处的**部分唯一索引**：`member_id IS NULL` 表示"全项目"，
   * 而 SQL 里 NULL 不等于 NULL —— 只建上面的普通唯一索引时，同一天能插入任意多行
   * （实测踩到：重复写快照后同一天出现 2 行）。
   */
  uniqueIndex("metric_snapshot_project_scope_uniq").on(t.iterationId, t.snapshotDate).where(sql`${t.memberId} IS NULL`),
  index("metric_snapshot_iteration_date_idx").on(t.iterationId, t.snapshotDate),
]);

export const dashboard = pgTable("dashboard", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** NULL = 全局仪表盘 */
  projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("dashboard_owner_idx").on(t.ownerId),
  index("dashboard_project_idx").on(t.projectId),
]);

export const dashboardWidget = pgTable("dashboard_widget", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  dashboardId: uuid("dashboard_id").notNull().references(() => dashboard.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  /** 挂件配置：迭代/项目范围、栅格位置等 */
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("dashboard_widget_dashboard_idx").on(t.dashboardId, t.sortOrder),
  check("dashboard_widget_type_allowed",
    sql`${t.type} IN ('BURNDOWN','CUMULATIVE_FLOW','ACTIVITY_HEATMAP','PIE','LIST','COUNT')`),
]);

// ══ 5.1/5.2 想法与投票（第十一期）══════════════════════════════

export const idea = pgTable("idea", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("NEW"),
  /** NULL = 外部提交（Intake，无账号） */
  submittedByMemberId: uuid("submitted_by_member_id").references(() => member.id, { onDelete: "set null" }),
  submitterDisplay: text("submitter_display"),
  /** 转工作项后回填 */
  promotedWorkItemId: uuid("promoted_work_item_id").references(() => workItem.id, { onDelete: "set null" }),
  /** ⚠️ 热度排序**缓存**，不是真相源；真相是 idea_vote 的加权和（规范 v1.38） */
  score: numeric("score", { precision: 10, scale: 2 }).notNull().default("0"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("idea_project_status_score_idx").on(t.projectId, t.status, t.score),
  check("idea_status_allowed", sql`${t.status} IN ('NEW','UNDER_REVIEW','PLANNED','REJECTED')`),
  check("idea_has_submitter", sql`${t.submittedByMemberId} IS NOT NULL OR ${t.submitterDisplay} IS NOT NULL`),
]);

/** PK (idea_id, member_id) —— 天然幂等：重复投票即更新权重 */
export const ideaVote = pgTable("idea_vote", {
  ideaId: uuid("idea_id").notNull().references(() => idea.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  weight: integer("weight").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  primaryKey({ columns: [t.ideaId, t.memberId] }),
  index("idea_vote_member_idx").on(t.memberId),
  check("idea_vote_weight_range", sql`${t.weight} BETWEEN -1 AND 5`),
]);

// ══ 5.3 需求收集 Intake（第十一期）══════════════════════════════

/** 内外部提交入口。外部提交靠**匿名链接**：令牌只存 SHA-256（等值查找即鉴权，C-28） */
export const intakeForm = pgTable("intake_form", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** 字段定义数组 [{key,label,type,required}] */
  schema: jsonb("schema").notNull().default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  submitTokenHash: text("submit_token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("intake_form_submit_token_key").on(t.submitTokenHash),
  index("intake_form_project_idx").on(t.projectId),
]);

export const intakeSubmission = pgTable("intake_submission", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** ⚠️ RESTRICT：有提交记录时不允许删表单（否则提交成孤儿） */
  formId: uuid("form_id").notNull().references(() => intakeForm.id, { onDelete: "restrict" }),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  /** 转成想法后回填 */
  convertedIdeaId: uuid("converted_idea_id").references(() => idea.id, { onDelete: "set null" }),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("intake_submission_form_idx").on(t.formId, t.createdAt),
  check("intake_submission_status_allowed", sql`${t.status} IN ('PENDING','CONVERTED','REJECTED')`),
]);

// ══ 7.5 Webhook 出站（第十一期）═══════════════════════════════

export const webhookEndpoint = pgTable("webhook_endpoint", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** NULL = 全局端点（管理员） */
  projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** ⚠️ 出站 URL 必须过统一的 URL 安全校验（SSRF，C-17/C-27） */
  url: text("url").notNull(),
  /** HMAC 签名密钥（信封加密存储，与 SMTP 密码同一套） */
  secretEncrypted: text("secret_encrypted").notNull(),
  events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("webhook_endpoint_project_idx").on(t.projectId),
]);

/** 投递记录 —— **死信队列由本表承载**（规范 4.6） */
export const webhookDelivery = pgTable("webhook_delivery", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoint.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  responseCode: integer("response_code"),
  error: text("error"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("webhook_delivery_endpoint_idx").on(t.endpointId, t.createdAt),
  index("webhook_delivery_status_idx").on(t.status, t.nextRetryAt),
  check("webhook_delivery_status_allowed", sql`${t.status} IN ('PENDING','RETRYING','SUCCEEDED','DEAD')`),
]);

// ══ 3.5 时间块与今日聚焦（第十一期）════════════════════════════

/** 时间块：日历上预先划定的计划块。**用时刻而非日期**（跨时区协作时"上午 9 点"必须唯一确定） */
export const timeBlock = pgTable("time_block", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  /** NULL = 个人块 */
  projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
  workItemId: uuid("work_item_id").references(() => workItem.id, { onDelete: "set null" }),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("time_block_member_start_idx").on(t.memberId, t.startAt),
  index("time_block_project_start_idx").on(t.projectId, t.startAt),
  check("time_block_range_valid", sql`${t.endAt} > ${t.startAt}`),
]);

/** 今日聚焦的实际执行记录（**进行中的会话不落库**，规范：放 Valkey） */
export const focusSession = pgTable("focus_session", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  timeBlockId: uuid("time_block_id").notNull().references(() => timeBlock.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  actualMinutes: integer("actual_minutes").notNull(),
  note: text("note"),
}, (t) => [
  uniqueIndex("focus_session_block_started").on(t.timeBlockId, t.startedAt),
  index("focus_session_member_started_idx").on(t.memberId, t.startedAt),
  check("focus_session_range_valid", sql`${t.endedAt} > ${t.startedAt}`),
  check("focus_session_minutes_valid", sql`${t.actualMinutes} >= 0`),
]);

// ══ 项目集与组合（第十一期，按数据模型第 1477 行登记表落地）══════

/** 项目集：只做「分组 + 汇总视图」，**不做跨项目依赖**（规范明确避免范围膨胀） */
export const portfolio = pgTable("portfolio", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("portfolio_owner_idx").on(t.ownerId),
]);

export const portfolioProject = pgTable("portfolio_project", {
  portfolioId: uuid("portfolio_id").notNull().references(() => portfolio.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.portfolioId, t.projectId] }),
  index("portfolio_project_project_idx").on(t.projectId),
]);

// ══ 6.1–6.3 Wiki 文档（第十二期）══════════════════════════════

/**
 * 页面。⚠️ 两条规范要点：
 *   1 UNIQUE `(project_id, slug)` **不含 deleted_at** → 软删必须改写 slug（否则"删掉再用同名建"直接撞唯一键）
 *   2 `search_vector` 是**派生列**（正文在 page_revision）→ 保存新 revision 的同一事务内更新
 */
export const page = pgTable("page", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => page.id, { onDelete: "set null" }),
  visibility: text("visibility").notNull().default("PROJECT"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** tsvector 派生列（GIN 索引在迁移里手写补，见 0020） */
  searchVector: text("search_vector"),
  /** 循环 FK，指向最新 revision；drizzle 的惰性回调可安全前向引用 */
  currentRevisionId: uuid("current_revision_id").references((): AnyPgColumn => pageRevision.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("page_project_slug_key").on(t.projectId, t.slug),
  index("page_project_parent_idx").on(t.projectId, t.parentId),
  check("page_visibility_allowed", sql`${t.visibility} IN ('PROJECT','RESTRICTED')`),
]);

/** 页面级 ACL：仅 `visibility='RESTRICTED'` 时生效 */
export const pagePermission = pgTable("page_permission", {
  pageId: uuid("page_id").notNull().references(() => page.id, { onDelete: "cascade" }),
  principalType: text("principal_type").notNull(),
  principalId: uuid("principal_id").notNull(),
  canRead: boolean("can_read").notNull().default(false),
  canWrite: boolean("can_write").notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.pageId, t.principalType, t.principalId] }),
  // 查"我能读哪些受限页"必走
  index("page_permission_principal_idx").on(t.principalType, t.principalId),
  check("page_permission_principal_allowed", sql`${t.principalType} IN ('MEMBER','TEAM','ROLE')`),
]);

/** 版本历史：**只增不改不删**（append-only，无 updated_at，不提供 DELETE） */
export const pageRevision = pgTable("page_revision", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: uuid("page_id").notNull().references(() => page.id, { onDelete: "cascade" }),
  revisionNo: integer("revision_no").notNull(),
  content: text("content").notNull(),
  changeSummary: text("change_summary"),
  /** RESTRICT：作者不可级联删除，否则历史断链 */
  authorId: uuid("author_id").notNull().references(() => member.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("page_revision_page_no_key").on(t.pageId, t.revisionNo),
]);

// ══ 6.4/6.5 知识索引（第十三期）════════════════════════════════

/** 页面切片：`generation` 是**生效代** —— 检索只取当前生效代（规范 C-16） */
export const pageChunk = pgTable("page_chunk", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: uuid("page_id").notNull().references(() => page.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id").notNull().references(() => pageRevision.id, { onDelete: "cascade" }),
  /** `H1 > H2` */
  headingPath: text("heading_path"),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull(),
  /** 增量索引判重 */
  contentHash: text("content_hash").notNull(),
  generation: integer("generation").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("page_chunk_page_generation_idx").on(t.pageId, t.generation),
  index("page_chunk_hash_idx").on(t.contentHash),
]);

/**
 * 切片向量。⚠️ 维度**固定 1024**（规范第 5.7 节写死）：
 * 非 1024 维的 embedding 模型必须在配置阶段就被拒绝，否则写库时才炸。
 * drizzle 没有 vector 类型 → 这里先声明为 text，由手写迁移改成 `vector(1024)`。
 */
export const chunkEmbedding = pgTable("chunk_embedding", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  chunkId: uuid("chunk_id").notNull().references(() => pageChunk.id, { onDelete: "cascade" }),
  /** 含维度标识，如 `bge-m3-1024` */
  model: text("model").notNull(),
  vector: text("vector").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("chunk_embedding_chunk_idx").on(t.chunkId),
]);

/** 索引任务：可重入、可重试、长任务用心跳续租（规范 4.6） */
export const indexJob = pgTable("index_job", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** NULL = 全项目重索引 */
  pageId: uuid("page_id").references(() => page.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("PENDING"),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  /** 本任务产出的代号；成功后在单事务内切换生效代（原子切换） */
  generation: integer("generation").notNull().default(1),
  errorMessage: text("error_message"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("index_job_status_idx").on(t.status, t.createdAt),
  index("index_job_page_idx").on(t.pageId),
  index("index_job_page_active_generation_idx").on(t.pageId, t.generation.desc()).where(sql`${t.activatedAt} is not null and ${t.status} = 'SUCCEEDED'`),
  check("index_job_mode_allowed", sql`${t.mode} IN ('INCREMENTAL','FULL','REEMBED')`),
  check("index_job_status_allowed", sql`${t.status} IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')`),
]);

// ══ 9.1/9.2 AI 供应商与用量（第十三期）══════════════════════════

/** BYOK 供应商配置：base_url 必须过统一 SSRF 校验；**仅接受 1024 维 embedding 模型** */
export const aiProviderConfig = pgTable("ai_provider_config", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  /** LLM = 对话供应商；EMBEDDING = 向量供应商；BOTH = 旧版兼容 */
  purpose: text("purpose").notNull().default("BOTH"),
  /** 多供应商场景的备注，例如“生产 / 测试 / 内部 Ollama” */
  note: text("note"),
  /** 信封加密；Ollama 等本地部署可为空 */
  apiKeyEncrypted: text("api_key_encrypted"),
  scope: text("scope").notNull().default("PAGE"),
  isDefault: boolean("is_default").notNull().default(false),
  /** 是否可被新索引/检索使用（停用后保留配置） */
  isActive: boolean("is_active").notNull().default(true),
  /** 最近一次按用途进行的模型调用测试；Ollama使用目录连接探测 */
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  lastTestError: text("last_test_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  check("ai_provider_allowed", sql`${t.provider} IN ('OPENAI_COMPAT','OLLAMA')`),
  check("ai_provider_purpose_allowed", sql`${t.purpose} IN ('BOTH','LLM','EMBEDDING')`),
  check("ai_provider_scope_allowed", sql`${t.scope} = 'PAGE'`),
]);

/**
 * 用量计数：UNIQUE `(member_id, period, period_start)` 是**累加的幂等键** ——
 * 写入一律 `ON CONFLICT DO UPDATE SET x = x + excluded.x`（原子累加，不做读改写）。
 */
export const aiUsageCounter = pgTable("ai_usage_counter", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  /** 业务日期、无时区 */
  periodStart: date("period_start").notNull(),
  embeddingTokens: bigint("embedding_tokens", { mode: "number" }).notNull().default(0),
  embeddingCalls: integer("embedding_calls").notNull().default(0),
  queryCount: integer("query_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("ai_usage_member_period_key").on(t.memberId, t.period, t.periodStart),
  check("ai_usage_period_allowed", sql`${t.period} IN ('DAY','MONTH')`),
]);

// ══ 8.4 幂等键（第十三期：MCP 写工具与创建类端点的落地前提）════════

/**
 * 写操作去重。权威依据是数据模型 8.4：第 4.9 节 MCP 写工具表有 12 处标注"幂等键"，
 * REST 第 0 节写"创建类支持 Idempotency-Key 请求头"，此前**没有任何存储载体**。
 * 幂等域按 **调用者 + 端点/工具名** 隔离：同一 key 在不同端点互不干扰。
 */
export const idempotencyKey = pgTable("idempotency_key", {
  key: text("key").notNull(),
  actorId: uuid("actor_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  /** 端点或工具名，如 `workitem.create` */
  scope: text("scope").notNull(),
  /** 请求体摘要：同键不同体 = 误用 → CONFLICT */
  requestHash: text("request_hash").notNull(),
  state: text("state").notNull().default("IN_PROGRESS"),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  /** 默认 24 小时 */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.key, t.actorId, t.scope] }),
  index("idempotency_expires_idx").on(t.expiresAt),
  check("idempotency_state_allowed", sql`${t.state} IN ('IN_PROGRESS','DONE')`),
]);

// ══ 9.1 RAG 合规留痕 / P3 研发活跃度 / Skill（第十三期收口）══════

/**
 * RAG 同意记录（规范 2.7 / A35）：**记录位，不是门禁** —— 平台不阻断、不校验出境路径。
 * 因此 `cross_border_path` **不加 CHECK**：那是给组织方的工具，平台不做裁判。
 */
export const ragConsent = pgTable("rag_consent", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  providerConfigId: uuid("provider_config_id").notNull().references(() => aiProviderConfig.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "set null" }),
  /** 同意时的文案快照（举证用：文案会改，改了就不能证明当时同意了什么） */
  purposeTextSnapshot: text("purpose_text_snapshot").notNull(),
  crossBorder: boolean("cross_border").notNull(),
  crossBorderPath: text("cross_border_path"),
  piaRecord: jsonb("pia_record"),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().default(now),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  index("rag_consent_member_idx").on(t.memberId),
  index("rag_consent_provider_idx").on(t.providerConfigId),
]);

/** 研发活跃度日聚合（P3；`integration` 表尚未落地，故数据入口是 upsert，聚合侧已可用） */
export const devActivityDaily = pgTable("dev_activity_daily", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  memberId: uuid("member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  /** 业务日期、无时区（规范第 5.4 节） */
  date: date("date").notNull(),
  commits: integer("commits").notNull().default(0),
  prs: integer("prs").notNull().default(0),
  reviews: integer("reviews").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("dev_activity_member_date_key").on(t.memberId, t.date),
  index("dev_activity_date_idx").on(t.date),
]);

/** Skill：可复用的 AI 能力包（规范 4.9 节 MCP 写工具 `skill.*` 的前置） */
export const skill = pgTable("skill", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  /** 能力清单（工具白名单、提示词、适用版本区间等），结构由使用者约定 */
  manifest: jsonb("manifest").notNull().default(sql`'{}'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  /** 规范 A29：Skill 标注适用版本区间 */
  appliesTo: text("applies_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("skill_name_key").on(t.name),
  index("skill_enabled_idx").on(t.enabled),
]);

// ══ 1.8 双因素密钥（第十四期）════════════════════════════════

export const twoFactorSecret = pgTable("two_factor_secret", {
  memberId: uuid("member_id").primaryKey().references(() => member.id, { onDelete: "cascade" }),
  /** 信封加密（数据卷主密钥）；明文永不落库、永不回显 */
  secretEncrypted: text("secret_encrypted").notNull(),
  status: text("status").notNull().default("PENDING"),
  /** 每个恢复码**单独哈希**（一次一码，用后作废；只存哈希） */
  recoveryCodesHash: jsonb("recovery_codes_hash").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  check("two_factor_status_allowed", sql`${t.status} IN ('PENDING','ACTIVE')`),
]);

// ══ P5 SSO 身份提供方（第十四期）══════════════════════════════

/**
 * OIDC / LDAP 登录源。`issuer` 是**用户可控出站 URL** → 必须过统一 SSRF 校验（与 Webhook、AI base_url 同一收口）。
 * `client_secret` 信封加密；LDAP 的 bind 口令同列不同语义（按 kind 解释）。
 */
export const idpConfig = pgTable("idp_config", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEncrypted: text("client_secret_encrypted"),
  /** OIDC 额外参数 / LDAP 连接与属性映射；不存密钥 */
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** 首次登录时是否自动建账号（不开就得先手工建号再绑定） */
  autoProvision: boolean("auto_provision").notNull().default(false),
  enabled: boolean("enabled").notNull().default(false),
  /** 只允许这些邮箱域自动建号（留空 = 不限制）；防止任意 IdP 用户涌入 */
  allowedEmailDomains: text("allowed_email_domains"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  check("idp_kind_allowed", sql`${t.kind} IN ('OIDC','LDAP')`),
  uniqueIndex("idp_issuer_client_key").on(t.issuer, t.clientId),
]);

/**
 * 登录握手状态（state/nonce/PKCE 校验器）。**一次性、短时效**：
 * 这是防 CSRF 与授权码注入的关键 —— 回调必须能对上且只能用一次。
 */
export const ssoLoginState = pgTable("sso_login_state", {
  state: text("state").primaryKey(),
  idpConfigId: uuid("idp_config_id").notNull().references(() => idpConfig.id, { onDelete: "cascade" }),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ══ 8.5 announcement — 群发公告（第十四期补：此前有端点/权限/约束却没有表）══

export const announcement = pgTable("announcement", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** RESTRICT：审计与「撤回仅限发送人本人」都要求作者记录不随人消失 */
  authorId: uuid("author_id").notNull().references(() => member.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  severity: text("severity").notNull().default("INFO"),
  /** 目标范围（角色 / 团队 / 全部）；**空数组 = 全员** */
  audience: jsonb("audience").notNull().default(sql`'[]'::jsonb`),
  /** 扇出后的实际投递人数（界面回显用；不是"计划投递数"） */
  deliveredCount: integer("delivered_count").notNull().default(0),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  check("announcement_severity_allowed", sql`${t.severity} IN ('INFO','WARNING','CRITICAL')`),
]);

// ══ 8.3 integration / sync_cursor — 外部集成（第十五期：GitLab / GitHub / Gitee）══
//
// 规范 8.3：`base_url` 是**用户可控的出站 URL**，请求会带着 `token_encrypted` 里的凭据出行，
// 因此创建/修改时都必须过统一 SSRF 模块（lib/url-safety.ts），不允许各处自己写白名单。
// `sync_cursor` 是同步游标（按 integration × entity 唯一）；REST 暂无端点，由同步任务消费。

export const integration = pgTable("integration", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(),
  /** NULL = 全局集成（不绑定单个项目） */
  projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** 访问令牌（信封加密存储，与 SMTP 密码同一套；列表/详情永不回显明文） */
  tokenEncrypted: text("token_encrypted").notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("integration_kind_project_url_idx").on(t.kind, t.projectId, t.baseUrl),
  index("integration_project_idx").on(t.projectId),
  check("integration_kind_allowed", sql`${t.kind} IN ('GITLAB','GITHUB','GITEE')`),
]);

export const syncCursor = pgTable("sync_cursor", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  integrationId: uuid("integration_id").notNull().references(() => integration.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  cursor: text("cursor"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("sync_cursor_integration_entity_key").on(t.integrationId, t.entity),
]);

// ══ 8.3 feature_flag — 功能开关（第十五期：平台能力，按需接入）══
//
// 规范 8.3：key 为 PK、enabled 默认 false、config 为半结构化配置。
// ⚠️ 如实说明：当前**没有内置业务消费者**（不拿它给已上线功能做隐形开关）；
// 它作为平台能力先落地，后续实验性功能按需读取。

export const featureFlag = pgTable("feature_flag", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
});

// ══ AI / MCP 客户端与工具级策略（第九期补：规范 9 节 / REST 11 节）══
//
// `mcp_client` 一令牌一客户端（token_id UNIQUE）；`mcp_tool_policy` 主键 (token_id, tool_name)，
// **DENY 优先于令牌档位**（A39 三重交集）——档位允许但策略 DENY 时仍拒绝。

export const mcpClient = pgTable("mcp_client", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenId: uuid("token_id").notNull().references(() => apiToken.id, { onDelete: "cascade" }),
  clientName: text("client_name"),
  clientVersion: text("client_version"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  callCount: integer("call_count").notNull().default(0),
}, (t) => [
  uniqueIndex("mcp_client_token_key").on(t.tokenId),
]);

export const mcpToolPolicy = pgTable("mcp_tool_policy", {
  tokenId: uuid("token_id").notNull().references(() => apiToken.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  effect: text("effect").notNull(),
  argConstraints: jsonb("arg_constraints").notNull().default(sql`'{}'::jsonb`),
}, (t) => [
  primaryKey({ columns: [t.tokenId, t.toolName] }),
  check("mcp_tool_policy_effect_allowed", sql`${t.effect} IN ('ALLOW','DENY')`),
]);

// ══ 9. RAG 检索日志（规范 9 节）——**不存原文 query**，只存哈希，保留 30 天 ══
export const knowledgeQueryLog = pgTable("knowledge_query_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** 成员被清理时日志不断链（SET NULL），但也不再指向个人 */
  memberId: uuid("member_id").references(() => member.id, { onDelete: "set null" }),
  /** SHA-256(query)：可做重复度/热点统计，**不可逆**，不落原文（防 PII） */
  queryHash: text("query_hash").notNull(),
  citationCount: integer("citation_count").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  tokenUsage: integer("token_usage").notNull().default(0),
  projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("knowledge_query_log_created_idx").on(t.createdAt),
  index("knowledge_query_log_project_idx").on(t.projectId),
]);

// ══ 3.3 work_item_link — 跨域引用链接（多态无 FK；目标删除由应用层清理，C-15）══
export const workItemLink = pgTable("work_item_link", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
}, (t) => [
  check("work_item_link_source_type_allowed", sql`${t.sourceType} IN ('WORK_ITEM','IDEA','PAGE','MILESTONE','ITERATION')`),
  check("work_item_link_target_type_allowed", sql`${t.targetType} IN ('WORK_ITEM','IDEA','PAGE','MILESTONE','ITERATION')`),
  // 自指仅对同类型有意义：这里只禁"同一个 WORK_ITEM 指向自己"
  check("work_item_link_no_self", sql`NOT (${t.sourceType} = 'WORK_ITEM' AND ${t.targetType} = 'WORK_ITEM' AND ${t.sourceId} = ${t.targetId})`),
  index("work_item_link_source_idx").on(t.sourceType, t.sourceId),
  index("work_item_link_target_idx").on(t.targetType, t.targetId),
]);

// ══ 2.4 project_template — 项目模板（工作项/里程碑/迭代初始集；内置模板只读）══
export const projectTemplate = pgTable("project_template", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  /** 初始集：{ milestones?: [], iterations?: [], workItems?: [] }（服务层 zod 校验） */
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

// ══ 8.6 job — 通用异步任务（PG 为队列真相源；邮件/定时/后台工作）════════
export const job = pgTable("job", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  /** PENDING → RUNNING → SUCCEEDED / FAILED（可重试则回 PENDING）/ DEAD */
  status: text("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().default(now),
  lockedBy: text("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("job_status_runat_idx").on(t.status, t.runAt),
  // C-21 豁免第 5 处：活跃任务去重（部分唯一索引；PG 特有语义，已登记豁免清单）
  uniqueIndex("job_dedupe_active_key").on(t.dedupeKey).where(sql`${t.status} in ('PENDING','RUNNING')`),
  // 状态机取值收口（text + CHECK：可移植性纪律 A40）
  check("job_status_check", sql`${t.status} in ('PENDING','RUNNING','SUCCEEDED','FAILED','DEAD')`),
  check("job_attempts_check", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
]);

// ══ 4.1b 里程碑进展记录（Round 62 对标 YouQu：结构化 summary/next/blockers）══
export const milestoneProgressUpdate = pgTable("milestone_progress_update", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  milestoneId: uuid("milestone_id").notNull().references(() => milestone.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => member.id, { onDelete: "set null" }),
  summary: text("summary").notNull(),
  nextSteps: text("next_steps"),
  blockers: text("blockers"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [index("milestone_progress_milestone_idx").on(t.milestoneId, t.createdAt)]);

// ══ 4.9b 工作项处理进展（Round 64 对标 YouQu 问题追踪：缺陷结构化处理进展）══
export const workItemProgressUpdate = pgTable("work_item_progress_update", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  workItemId: uuid("work_item_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => member.id, { onDelete: "set null" }),
  summary: text("summary").notNull(),
  nextSteps: text("next_steps"),
  blockers: text("blockers"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [index("work_item_progress_item_idx").on(t.workItemId, t.createdAt)]);

// ══ 11.x IM 集成（Round 76 超越对标）：钉钉/企微/飞书群机器人/应用凭据 ══════════
// 规划：webhook 机器人首期落地；应用模式凭据（appKey/appSecret/corpId/agentId）加密保存，
// 但应用消息 API（非 webhook）尚未实现，界面上对无 webhook 的渠道测试会明确报错，不伪造成功。
export const imChannel = pgTable("im_channel", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  provider: text("provider").notNull(),                 // DINGTALK / WECOM / FEISHU
  webhookUrlEncrypted: text("webhook_url_encrypted"),   // 群机器人 webhook（信封加密）
  appKeyEncrypted: text("app_key_encrypted"),
  appSecretEncrypted: text("app_secret_encrypted"),
  corpId: text("corp_id"),
  agentId: text("agent_id"),
  /** 应用消息接收人（逗号分隔；钉钉/企微 userid、飞书 open_id）；仅应用模式必填 */
  recipients: text("recipients"),
  /** 订阅的通知类别；空数组 = 全部类别 */
  events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  lastTestError: text("last_test_error"),
  lastSendAt: timestamp("last_send_at", { withTimezone: true }),
  lastSendOk: boolean("last_send_ok"),
  lastSendError: text("last_send_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("im_channel_provider_name_key").on(t.provider, t.name),
  check("im_channel_provider_allowed", sql`${t.provider} IN ('DINGTALK','WECOM','FEISHU')`),
]);

// ══ 4.9c 工作项转派历史（Round 79 · 对标 BugTransfer/Watcher）════════════
export const workItemTransfer = pgTable("work_item_transfer", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  workItemId: uuid("work_item_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  fromAssigneeId: uuid("from_assignee_id").references(() => member.id, { onDelete: "set null" }),
  toAssigneeId: uuid("to_assignee_id").references(() => member.id, { onDelete: "set null" }),
  actorId: uuid("actor_id").references(() => member.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [index("work_item_transfer_item_idx").on(t.workItemId, t.createdAt)]);


// ══ P0/P1：LDAP/SCIM 身份、自动化、SLA ═══════════════════════════════

/** SCIM 2.0 Bearer 令牌；哈希存储，明文只返回一次 */
export const scimToken = pgTable("scim_token", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  createdBy: uuid("created_by").references(() => member.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex("scim_token_hash_key").on(t.tokenHash)]);

/** 自动化规则：项目级触发/条件/动作 */
export const automationRule = pgTable("automation_rule", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
  actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`),
  scheduleCron: text("schedule_cron"),
  scheduleTimezone: text("schedule_timezone").default("Asia/Shanghai"),
  lastScheduledAt: timestamp("last_scheduled_at", { withTimezone: true }),
  scheduleState: jsonb("schedule_state"),
  createdBy: uuid("created_by").references(() => member.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("automation_rule_project_idx").on(t.projectId, t.enabled),
  check("automation_rule_trigger_allowed", sql`${t.trigger} IN ('WORK_ITEM_CREATED','WORK_ITEM_UPDATED','STATUS_CHANGED','COMMENT_ADDED','SLA_BREACHED','SCHEDULE')`),
]);

/** 自动执行记录（90 天保留） */
export const automationRun = pgTable("automation_run", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleId: uuid("rule_id").notNull().references(() => automationRule.id, { onDelete: "cascade" }),
  workItemId: uuid("work_item_id").references(() => workItem.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("automation_run_rule_idx").on(t.ruleId, t.createdAt),
  index("automation_run_item_idx").on(t.workItemId, t.createdAt),
  check("automation_run_status_allowed", sql`${t.status} IN ('SUCCESS','SKIPPED','FAILED')`),
]);

/** SLA 策略：项目级，可按优先级/严重度/类型匹配 */
export const slaPolicy = pgTable("sla_policy", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: text("priority"),
  severity: text("severity"),
  type: text("type"),
  responseMinutes: integer("response_minutes").notNull(),
  resolveMinutes: integer("resolve_minutes").notNull(),
  escalateAfterMinutes: integer("escalate_after_minutes").notNull().default(60),
  escalateRoles: jsonb("escalate_roles").notNull().default(sql`'[]'::jsonb`),
  /** 工作时间日历：{ enabled, days:[1-7], start:"09:00", end:"18:00" }；不配则为 24×7 */
  calendar: jsonb("calendar"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [index("sla_policy_project_idx").on(t.projectId, t.enabled)]);

/** 工作项 SLA 时钟（一工作项一条） */
export const workItemSla = pgTable("work_item_sla", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workItemId: uuid("work_item_id").notNull().references(() => workItem.id, { onDelete: "cascade" }),
  policyId: uuid("policy_id").references(() => slaPolicy.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(now),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  responseDueAt: timestamp("response_due_at", { withTimezone: true }).notNull(),
  resolveDueAt: timestamp("resolve_due_at", { withTimezone: true }).notNull(),
  breachedAt: timestamp("breached_at", { withTimezone: true }),
  state: text("state").notNull().default("ACTIVE"),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedMs: integer("paused_ms").notNull().default(0),
  lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("work_item_sla_item_key").on(t.workItemId),
  index("work_item_sla_due_idx").on(t.state, t.responseDueAt),
  check("work_item_sla_state_allowed", sql`${t.state} IN ('ACTIVE','MET','BREACHED','CANCELLED')`),
]);

// ══ 系统数据备份与恢复控制记录 ════════════════════════════════════

export const systemBackup = pgTable("system_backup", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  requestedBy: uuid("requested_by").references(() => member.id, { onDelete: "set null" }),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("PENDING"),
  headerDraft: jsonb("header_draft").notNull(),
  packagePath: text("package_path"),
  bytes: bigint("bytes", { mode: "number" }),
  manifestSummary: jsonb("manifest_summary"),
  downloadCount: integer("download_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  index("system_backup_requested_idx").on(t.requestedBy, t.createdAt),
  check("system_backup_mode_check", sql`${t.mode} in ('safe','full')`),
  check("system_backup_status_check", sql`${t.status} in ('PENDING','RUNNING','SUCCEEDED','FAILED')`),
  check("system_backup_download_count_check", sql`${t.downloadCount} >= 0`),
]);

export const systemRestore = pgTable("system_restore", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  packageId: uuid("package_id"),
  status: text("status").notNull().default("UPLOADED"),
  uploadPath: text("upload_path").notNull(),
  ownerSessionHash: text("owner_session_hash"),
  mode: text("mode"),
  sourceVersion: text("source_version"),
  manifestSummary: jsonb("manifest_summary"),
  manifestHash: text("manifest_hash"),
  rebuildJobId: uuid("rebuild_job_id"),
  rebuildCompletedAt: timestamp("rebuild_completed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  check("system_restore_status_check", sql`${t.status} in ('UPLOADED','PREFLIGHT_PASSED','RESTORING','SUCCEEDED','FAILED')`),
  check("system_restore_owner_hash_check", sql`${t.ownerSessionHash} is null or ${t.ownerSessionHash} ~ '^[a-f0-9]{64}$'`),
  check("system_restore_manifest_hash_check", sql`${t.manifestHash} is null or ${t.manifestHash} ~ '^[a-f0-9]{64}$'`),
]);

// ══ 按账号持久化的知识助手会话 ════════════════════════════════
export const ragConversation = pgTable("rag_conversation", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: uuid("owner_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新对话"),
  titleIsDefault: boolean("title_is_default").notNull().default(true),
  // 项目删除不能把固定范围悄然改为全部项目。
  projectId: uuid("project_id").references(() => project.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("rag_conversation_owner_updated_idx").on(t.ownerId, t.updatedAt, t.id)]);

export const ragMessage = pgTable("rag_message", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: uuid("conversation_id").notNull().references(() => ragConversation.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  question: text("question").notNull(),
  requestMetadata: jsonb("request_metadata").$type<import("../shared/rag.ts").RagReferences>(),
  status: text("status").notNull().default("pending"),
  reply: jsonb("reply").$type<import("../shared/rag.ts").RagChatResult>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex("rag_message_request_key").on(t.conversationId, t.requestId),
  uniqueIndex("rag_message_pending_key").on(t.conversationId).where(sql`${t.status} = 'pending'`),
  index("rag_message_conversation_created_idx").on(t.conversationId, t.createdAt, t.id),
  check("rag_message_status_check", sql`${t.status} in ('pending','completed','failed','cancelled','unavailable')`),
]);

/** 助手直传临时资料：内容始终加密，标识本身不构成授权，永不参与系统备份。 */
export const assistantArtifact = pgTable("assistant_artifact", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: uuid("owner_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  sourceTokenId: uuid("source_token_id").references(() => apiToken.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  allowedProjectIds: jsonb("allowed_project_ids").$type<string[]>().notNull(),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  destination: jsonb("destination").$type<{ kind: string; baseUrl: string }>(),
  payloadEncrypted: text("payload_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("assistant_artifact_owner_created_idx").on(t.ownerId, t.createdAt),
  index("assistant_artifact_expires_idx").on(t.expiresAt),
  check("assistant_artifact_kind_check", sql`${t.kind} in ('FILE','CREDENTIAL')`),
  check("assistant_artifact_scope_check", sql`jsonb_typeof(${t.allowedProjectIds}) = 'array' and jsonb_array_length(${t.allowedProjectIds}) between 1 and 20`),
  check("assistant_artifact_size_check", sql`${t.sizeBytes} is null or (${t.sizeBytes} > 0 and ${t.sizeBytes} <= 8388608)`),
]);
