import { businessEffects } from "./business-effects.ts";
/** 工作项领域服务 */
import { DomainError, forbidden } from "../../shared/errors.ts";
import { createWorkItemSchema, updateWorkItemSchema, type CreateWorkItemInput } from "../../shared/schemas/work-item.ts";
import { z } from "zod";

import type { Actor } from "../permission/actor.ts";
import { can, roleKeysForScope, type PermissionContext } from "../permission/engine.ts";
import * as wiRepo from "../repos/work-item.repo.ts";
import * as projectRepo from "../repos/project.repo.ts";
import * as wfRepo from "../repos/workflow.repo.ts";
import { db, sql } from "../../db/index.ts";
import { and, asc, desc, eq, ilike, or, isNull, sql as dsql } from "drizzle-orm";
import { workItem, workItemTransfer, workflowState } from "../../db/schema.ts";
import { assertTreeParent, lockProjectTree } from "./project-tree.ts";

const serviceUpdateSchema = updateWorkItemSchema.extend({ assigneeReason: z.string().max(2000).nullable().optional() }).strict();

function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

async function assertProjectVisible(actor: Actor, projectId: string): Promise<void> {
  // ⚠️ 先验存在：`isVisibleTo` 对 ORG 档直接放行，不查项目是否存在 ——
  //    少了这一步，伪造/拼错的项目 ID 会返回**空列表而不是 NOT_FOUND**
  //    （第六期 MCP 工具实测暴露；REST 侧同源受益）。
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  const visible = await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrgGrant(actor));
  if (!visible) throw forbidden();
}

export async function createWorkItem(
  actor: Actor,
  projectId: string,
  input: CreateWorkItemInput,
): Promise<Awaited<ReturnType<typeof wiRepo.findById>>> {
  businessEffects(); // Fail before writes if an entry point omitted application composition.
  const parsed = createWorkItemSchema.strict().safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "工作项参数不合法", parsed.error.issues);
  input = parsed.data;
  await assertProjectVisible(actor, projectId);

  const project = await projectRepo.findById(projectId);
  if (!project) throw forbidden();

  // 生命周期锁：置位时禁止一切写操作（数据模型 2.1）
  if (project.lifecycleLock) {
    throw new DomainError("CONFLICT", "该项目已锁定，禁止写入", null);
  }

  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  if (!can(actor, "work_item:create", { projectId, createdBy: null }, ctx)) throw forbidden();

  /**
   * ⚠️ **校验顺序很重要**：先做参数校验，再查工作流。
   *    反过来的话，用户会看到「缺少工作流」这种误导性错误，
   *    而真实原因只是没填父项（实测踩到）。
   */

  // ① 严重度只对缺陷有意义 —— 应用层先拦，DB 的 CHECK 兜底
  if (input.severity && input.type !== "DEFECT") {
    throw new DomainError("VALIDATION", "严重度只对缺陷类型有效", null);
  }
  // ② 子任务必须有父项
  if (input.type === "SUBTASK" && !input.parentId) {
    throw new DomainError("VALIDATION", "子任务必须指定父工作项", null);
  }

  // ③ 父项必须同项目
  let parent: Awaited<ReturnType<typeof wiRepo.findById>> = null;
  if (input.parentId) {
    parent = await wiRepo.findById(input.parentId);
    if (!parent || parent.projectId !== projectId) {
      throw new DomainError("VALIDATION", "父工作项必须属于同一项目", null);
    }
  }

  /**
   * ④ 定工作流与起始状态。
   *
   * ⚠️ **子任务继承父项的工作流**（行业标准：Jira 的 sub-task 绑定父任务的 workflow）。
   *    规范缺口：`applies_to_type` 的取值域含 `SUBTASK`，但内置三套模板只覆盖
   *    TASK / DEFECT / REQUIREMENT，没说明子任务用哪套。若按「查项目内适用于 SUBTASK 的
   *    默认工作流」实现，子任务**永远建不出来**（BLOCKED_BY_PREREQUISITE）。
   *    继承父项则状态语义与父任务一致，也不会凭空多出一套工作流。
   */
  let workflowId: string;
  let stateId: string;

  if (input.type === "SUBTASK") {
    // 已在上面保证 parent 非空且同项目
    workflowId = parent!.workflowId;
    const initialState = await wiRepo.findInitialState(workflowId);
    if (!initialState) {
      throw new DomainError("BLOCKED_BY_PREREQUISITE", "父项的工作流没有起始状态", null);
    }
    stateId = initialState.id;
  } else {
    const wf = await wiRepo.findDefaultWorkflow(projectId, input.type);
    if (!wf) {
      throw new DomainError("BLOCKED_BY_PREREQUISITE",
        `项目缺少适用于「${input.type}」的工作流，请先复制或创建工作流`, null);
    }
    const initialState = await wiRepo.findInitialState(wf.id);
    if (!initialState) {
      throw new DomainError("BLOCKED_BY_PREREQUISITE", "工作流没有起始状态（category=NOT_STARTED）", null);
    }
    workflowId = wf.id;
    stateId = initialState.id;
  }

  // ⑤ 原子分配编号并插入
  // ⚠️ 返回**完整行**而不是 {id,key,number}：REST 建工作项的响应此前过薄，
  //    调用方拿不到 statusId/workflowId 等字段（实测两次因测试假设 title/workflowId
  //    存在而踩空）。与 updateWorkItem 的回读口径保持一致。
  const created = await db.transaction(async () => {
    await lockProjectTree(projectId);
    // 与完成/归档共用项目锁；校验与关联写入必须在同一事务。
    await assertPlanRefsSameProject(input, projectId);
    if (input.parentId) await assertTreeParent("work_item", projectId, input.parentId);
    return wiRepo.insertWithNumber({
    projectId,
    type: input.type,
    title: input.title,
    description: input.description ?? null,
    workflowId,
    statusId: stateId,
    reporterId: actor.memberId,
    assigneeId: input.assigneeId ?? null,
    priority: input.priority ?? null,
    severity: input.severity ?? null,
    estimatePoints: input.estimatePoints != null ? String(input.estimatePoints) : null,
    estimateHours: input.estimateHours != null ? String(input.estimateHours) : null,
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    parentId: input.parentId ?? null,
    // ⚠️ 计划实体关联此前**被静默忽略**：schema 接受这四个字段、插入却不带，
    //    导致工作项无法在创建时挂到迭代/里程碑/版本/模块（迭代看板与燃尽图因此为空）。
    //    与 updateWorkItem 同一套校验（必须同项目）。
    milestoneId: input.milestoneId ?? null,
    iterationId: input.iterationId ?? null,
    releaseId: input.releaseId ?? null,
    moduleId: input.moduleId ?? null,
    });
  });
  const full = await wiRepo.findById(created.id);
  // 刚插入的行必然可回读；回读不到说明事务/可见性出了问题，宁可显式报错也不返回残缺对象
  if (!full) throw new DomainError("INTERNAL", "工作项创建后回读失败", null);
  await businessEffects().deliverWebhook("work_item.created", {
    id: full.id, key: full.key, projectId, version: full.version, actorId: actor.memberId,
  }, projectId);
  void businessEffects().runAutomation("WORK_ITEM_CREATED", full.id);
  void businessEffects().ensureSla(full.id);
  return full;
}

export async function getWorkItem(actor: Actor, id: string) {
  const wi = await wiRepo.findById(id);
  if (!wi) throw forbidden();                       // 不可见与不存在同形
  try {
    await assertProjectVisible(actor, wi.projectId);
  } catch {
    // C-23：协作者对「自己协作的工作项」有可见性，即使不在项目成员名单
    const { isCollaborator } = await import("./collab.service.ts");
    if (!(await isCollaborator(actor.memberId, id))) throw forbidden();
  }
  // 当前状态属于工作项自身读取事实，不依赖工作流管理或另一工具权限。
  const state = await wfRepo.findStateById(wi.statusId);
  const currentState = state?.workflowId === wi.workflowId ? state : null;
  return { ...wi, statusKey: currentState?.key ?? null, statusName: currentState?.name ?? null, statusCategory: currentState?.category ?? null };
}

/** 子工作项列表（父子层级 UI 用；只读，不改变主列表投影）。 */
export async function listChildren(actor: Actor, parentId: string) {
  const parent = await getWorkItem(actor, parentId);
  const rows = await db.execute(dsql`
    select wi.id, wi.key, wi.title, wi.type, wi.priority, wi.status_id as status_id
    from work_item wi
    where wi.parent_id = ${parentId} and wi.deleted_at is null
    order by wi.number asc
  `) as unknown as { id: string; key: string; title: string; type: string; priority: string | null; status_id: string }[];
  return { parent: { id: parent.id, key: parent.key, title: parent.title }, children: rows };
}

/**
 * 更新（乐观锁）。
 *
 * ⚠️ 判定「能不能改」要区分 `_own` 与 `_any`：
 *    - 资源创建者可以用 `update_own`
 *    - 其他人在有 `update_any` 时才可以
 * 两者都不满足 → FORBIDDEN（与资源不存在同形）
 */
export async function updateWorkItem(
  actor: Actor,
  id: string,
  patch: Record<string, unknown>,
): Promise<ReturnType<typeof wiRepo.findById>> {
  businessEffects(); // Fail before writes if an entry point omitted application composition.
  const parsed = serviceUpdateSchema.safeParse(patch);
  if (!parsed.success) throw new DomainError("VALIDATION", "工作项更新参数不合法", parsed.error.issues);
  patch = parsed.data;
  const wi = await wiRepo.findById(id);
  if (!wi) throw forbidden();
  // C-23：协作者通道（可见性 + 编辑权），C-24 限定它不等于 update_any
  const { isCollaborator } = await import("./collab.service.ts");
  const isCollab = await isCollaborator(actor.memberId, id);
  try {
    await assertProjectVisible(actor, wi.projectId);
  } catch {
    if (!isCollab) throw forbidden();
  }

  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  const res = { projectId: wi.projectId, teamId: null, createdBy: wi.reporterId };
  const allowed =
    can(actor, "work_item:update_own", res, ctx) || can(actor, "work_item:update_any", res, ctx)
    || isCollab;   // 协作编辑权：**不含** delete / transition 之外的高权动作（C-24）
  if (!allowed) throw forbidden();

  const { version, assigneeReason, ...fields } = patch as { version: number; assigneeReason?: string | null } & Record<string, unknown>;

  /**
   * 计划实体关联校验：**必须与工作项同项目**。
   *
   * 为什么必须校验：工作项的可见性由**项目**决定。若允许跨项目关联，
   * 「按项目过滤」与「按关联过滤」会给出矛盾结果 —— 例如 A 项目的人
   * 看到自己项目的工作项挂在 B 项目的里程碑下，而他对 B 项目根本不可见。
   */
  // 严重度与类型一致性（改 severity 时用现有 type 校验）
  if (fields.severity && wi.type !== "DEFECT") {
    throw new DomainError("VALIDATION", "严重度只对缺陷类型有效", null);
  }

  if (wi.type === "SUBTASK" && fields.parentId === null) {
    throw new DomainError("VALIDATION", "子任务必须指定父工作项", null);
  }
  const changesRelations = ["parentId", "milestoneId", "iterationId", "releaseId", "moduleId"].some(field => fields[field] !== undefined);
  const updated = changesRelations
    ? await db.transaction(async () => {
        await lockProjectTree(wi.projectId);
        await assertPlanRefsSameProject(fields, wi.projectId, wi);
        if (typeof fields.parentId === "string") await assertTreeParent("work_item", wi.projectId, fields.parentId, id);
        return wiRepo.updateWithVersion(id, version, fields);
      })
    : await wiRepo.updateWithVersion(id, version, fields);
  if (!updated) {
    // 版本不匹配 = 别人先改了（第 4.9 节）
    throw new DomainError("VERSION_CONFLICT", "该工作项已被他人修改，请刷新后重试", null);
  }

  // ── 转派历史（Round 79）：只有"真的换了人"才记一条（含 from/to/reason）──
  if (fields.assigneeId !== undefined && fields.assigneeId !== wi.assigneeId) {
    try {
      await db.insert(workItemTransfer).values({
        projectId: wi.projectId, workItemId: id,
        fromAssigneeId: wi.assigneeId, toAssigneeId: (fields.assigneeId as string | null) ?? null,
        actorId: actor.memberId, reason: assigneeReason ?? null,
      });
    } catch (e) { console.error("[transfer] 写转派历史失败（不阻断）:", (e as Error).message); }
  }

  // ── 审计 + 活动（W3）──────────────────────────────────────
  // changes 走审计服务的白名单过滤（email/正文等进不来）；活动 summary 预渲染
  {
    const { writeAudit, writeActivity } = await import("./audit.service.ts");
    await writeAudit({
      actorId: actor.memberId,
      action: "work_item.updated",
      targetType: "WORK_ITEM",
      targetId: id,
      changes: fields,
      severity: "BUSINESS",
    });
    await writeActivity({
      projectId: wi.projectId,
      actorId: actor.memberId,
      targetType: "WORK_ITEM",
      targetId: id,
      action: "work_item.updated",
      summary: `${actor.name} 更新了 ${wi.key}`,
    });
  }

  // ── SSE：workitem.changed（含指派时的 assigned 专项事件）──────
  try {
    const { publish } = await import("./events.service.ts");
    const changedFields = Object.keys(fields);
    await publish("workitem.changed", { id, version: updated.version, changedFields }, null);
    if (fields.assigneeId && fields.assigneeId !== wi.assigneeId) {
      await publish("workitem.assigned", { id, assigneeId: fields.assigneeId }, null);
    }
  } catch { /* 可丢 */ }

  await businessEffects().deliverWebhook("work_item.updated", {
    id, key: updated.key, projectId: wi.projectId, version: updated.version,
    actorId: actor.memberId, changedFields: Object.keys(fields),
  }, wi.projectId);
  void businessEffects().runAutomation("WORK_ITEM_UPDATED", id);
  void businessEffects().ensureSla(id);

  // ── 指派变更 → 通知新指派人 ───────────────────────────────
  // 只在「真的换了人」时发，且不给自己发。ASSIGN 类走免打扰与聚合：
  // 批量指派 20 个工作项应是一条聚合通知，而不是 20 条轰炸。
  if (fields.assigneeId && fields.assigneeId !== wi.assigneeId && fields.assigneeId !== actor.memberId) {
    const { notify } = await import("./notification.service.ts");
    await notify({
      recipientId: String(fields.assigneeId),
      actorId: actor.memberId,
      category: "ASSIGN",
      type: "work_item.assigned",
      title: `${actor.name} 将 ${wi.key} 指派给你`,
      body: wi.title,
      link: `/work-items/${id}`,
    }).catch(() => {});   // 通知失败不阻断主操作
  }

  return updated;
}

export async function deleteWorkItem(actor: Actor, id: string): Promise<void> {
  const wi = await wiRepo.findById(id);
  if (!wi) throw forbidden();
  await assertProjectVisible(actor, wi.projectId);

  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  if (!can(actor, "work_item:delete", { projectId: wi.projectId, createdBy: wi.reporterId }, ctx)) {
    throw forbidden();
  }
  // 软删；编号永久作废，计数器不回退
  await db.transaction(async () => {
    await lockProjectTree(wi.projectId);
    const children = await db.select({ id: workItem.id }).from(workItem)
      .where(and(eq(workItem.parentId, id), isNull(workItem.deletedAt))).limit(1);
    if (children.length) throw new DomainError("BLOCKED_BY_PREREQUISITE", "请先移出或删除子工作项", null);
    await wiRepo.softDelete(id);
  });
  // C-15：多态链接无 FK，删除目标时**应用层**清理（两侧都查）
  {
    const { cleanupLinksFor } = await import("./work-item-link.service.ts");
    await cleanupLinksFor("WORK_ITEM", id);
  }
  await businessEffects().deliverWebhook("work_item.deleted", {
    id, key: wi.key, projectId: wi.projectId, version: wi.version, actorId: actor.memberId,
  }, wi.projectId);
}


/**
 * 状态流转（R6 核心）。
 *
 * **校验链顺序不可换**（Spec 第 4.4 节）：
 *   1 version 匹配          → 否则 VERSION_CONFLICT（先拦并发，避免基于旧状态做判断）
 *   2 迁移边存在            → 否则 VALIDATION（这条流转本就不被允许）
 *   3 allowed_role_ids 允许 → 否则 FORBIDDEN
 *   4 required_fields 必填   → 否则 VALIDATION（带 details.requiredFields 供前端弹窗）
 *
 * 副作用（同一事务）：
 *   - 更新 status_id 与 version
 *   - **按终态进入/离开写入或清空 `completed_at`** —— 判定读 `category`，禁止硬编码状态码（C-3）
 */
export async function transitionWorkItem(
  actor: Actor,
  id: string,
  input: { toStateKey: string; version: number; fields?: Record<string, unknown> },
  opts: { skipApproval?: boolean } = {},
): Promise<NonNullable<Awaited<ReturnType<typeof wiRepo.findById>>>> {
  businessEffects(); // Fail before writes if an entry point omitted application composition.
  const wi = await wiRepo.findById(id);
  if (!wi) throw forbidden();
  await assertProjectVisible(actor, wi.projectId);

  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  if (!can(actor, "work_item:transition", { projectId: wi.projectId, createdBy: wi.reporterId }, ctx)) {
    throw forbidden();
  }

  // ① 版本（乐观锁）
  if (wi.version !== input.version) {
    throw new DomainError("VERSION_CONFLICT", "该工作项已被他人修改，请刷新后重试", null);
  }

  // ② 迁移边必须存在
  const target = await wfRepo.findStateByKey(wi.workflowId, input.toStateKey);
  if (!target) {
    throw new DomainError("VALIDATION", `工作流中没有状态「${input.toStateKey}」`, null);
  }
  const edge = await wfRepo.findTransition(wi.workflowId, wi.statusId, target.id);
  if (!edge) {
    throw new DomainError("VALIDATION", "当前状态不允许流转到该状态", null);
  }

  // ③ 迁移权限：`allowed_role_ids` 为空 = 不限制（所有有 work_item:transition 的人都能用）
  const allowedRoles = (edge.allowedRoleIds ?? []) as string[];
  if (allowedRoles.length > 0) {
    const myRoles = roleKeysForScope(actor, { projectId: wi.projectId });
    const ok = allowedRoles.some((r) => myRoles.has(r));
    if (!ok) throw forbidden();
  }

  // ④ 必填字段（如驳回原因）。把缺哪些回给前端，供其弹窗补齐
  const required = (edge.requiredFields ?? []) as string[];
  const given = input.fields ?? {};
  const missing = required.filter((f) => given[f] === undefined || given[f] === null || given[f] === "");
  if (missing.length > 0) {
    throw new DomainError("VALIDATION", "该流转需要填写必填字段", { requiredFields: missing });
  }

  // 审批边：先落审批请求，不直接流转（内部审批通过时 skipApproval）
  if (edge.requiresApproval && !opts.skipApproval) {
    const { requestApproval } = businessEffects();
    const approval = await requestApproval(actor, wi, {
      fromStateId: wi.statusId, toStateId: target.id,
      approverRoleKeys: (edge.approverRoleKeys ?? []) as string[],
      fields: input.fields,
    });
    throw new DomainError("BLOCKED_BY_PREREQUISITE", "已提交审批，等待审批人处理", { approvalId: approval.id });
  }

  // ── 副作用：终态进出与 completed_at ───────────────────────
  const fromState = await wfRepo.findStateById(wi.statusId);
  const enteringTerminal = target.category === "TERMINAL";
  const leavingTerminal = fromState?.category === "TERMINAL";
  const completedAt = enteringTerminal ? new Date() : leavingTerminal ? null : wi.completedAt;

  const updated = await db.transaction(async () => {
    await lockProjectTree(wi.projectId);
    // 终态重开不能给已关闭的计划重新引入未完成项。
    // carryOver=false 保留的历史未完成项仍可继续处理至终态。
    if (leavingTerminal && !enteringTerminal) {
      await assertPlanRefsSameProject({ iterationId: wi.iterationId, releaseId: wi.releaseId }, wi.projectId);
    }
    return wiRepo.updateWithVersion(id, input.version, { statusId: target.id, completedAt });
  });
  if (!updated) {
    // 极小概率：③④ 之间被别人改了。乐观锁兜住，不静默覆盖
    throw new DomainError("VERSION_CONFLICT", "该工作项已被他人修改，请刷新后重试", null);
  }

  // ── 审计 + 活动（W3）──────────────────────────────────────
  {
    const { writeAudit, writeActivity } = await import("./audit.service.ts");
    await writeAudit({
      actorId: actor.memberId,
      action: "work_item.transitioned",
      targetType: "WORK_ITEM",
      targetId: id,
      changes: { statusKey: target.key },
      severity: "BUSINESS",
    });
    await writeActivity({
      projectId: wi.projectId,
      actorId: actor.memberId,
      targetType: "WORK_ITEM",
      targetId: id,
      action: "work_item.transitioned",
      summary: `${actor.name} 把 ${wi.key} 移到了「${target.name}」`,
    });
  }

  // ── SSE：workitem.transitioned ────────────────────────────
  try {
    const { publish } = await import("./events.service.ts");
    await publish("workitem.transitioned", { id, fromState: wi.statusId, toState: target.id }, null);
  } catch { /* 可丢 */ }

  // ── 流转 → 通知 reporter / assignee（不通知操作者自己）────────
  // TRANSITION 类走免打扰与聚合：同一条工作项短时间多次流转合并成一条。
  {
    const { notify } = await import("./notification.service.ts");
    const targets = new Set<string>();
    if (wi.reporterId) targets.add(wi.reporterId);
    if (wi.assigneeId) targets.add(wi.assigneeId);
    targets.delete(actor.memberId);          // 自己操作的不提醒自己
    for (const t of targets) {
      await notify({
        recipientId: t,
        actorId: actor.memberId,
        category: "TRANSITION",
        type: "work_item.transitioned",
        title: `${wi.key} 已流转到「${target.name}」`,
        body: wi.title,
        link: `/work-items/${id}`,
        groupKey: `transition:${t}:${id}`,
      }).catch(() => {});
    }
  }

  await businessEffects().deliverWebhook("work_item.transitioned", {
    id, key: updated.key, projectId: wi.projectId, version: updated.version,
    actorId: actor.memberId, fromStateId: wi.statusId, toStateId: target.id,
  }, wi.projectId);
  void businessEffects().runAutomation("STATUS_CHANGED", id);
  void businessEffects().markTransition(id, target.category);
  return updated;
}

/** 详情页用：当前状态下当前 Actor 可用的迁移边 */
export async function allowedTransitions(actor: Actor, wi: { workflowId: string; statusId: string; projectId: string }) {
  const edges = await wfRepo.listTransitionsFrom(wi.workflowId, wi.statusId);
  const myRoles = roleKeysForScope(actor, { projectId: wi.projectId });
  return edges
    .filter((e) => {
      const allowed = (e.allowedRoleIds ?? []) as string[];
      return allowed.length === 0 || allowed.some((r) => myRoles.has(r));
    })
    .map((e) => ({
      toStateKey: e.toKey, toName: e.toName, toCategory: e.toCategory,
      label: e.label, requiredFields: (e.requiredFields ?? []) as string[],
    }));
}

/** 看板聚合（R6） */
export async function loadBoard(actor: Actor, projectId: string, perColumnLimit: number, filters: wfRepo.BoardFilters = {}) {
  await assertProjectVisible(actor, projectId);
  return wfRepo.loadBoard(projectId, perColumnLimit, filters);
}

export async function loadBoardColumn(actor: Actor, projectId: string, stateKey: string, offset: number, limit: number, filters: wfRepo.BoardFilters = {}) {
  await assertProjectVisible(actor, projectId);
  return wfRepo.loadBoardColumn(projectId, stateKey, offset, limit, filters);
}

/**
 * 校验四个计划实体 id 与工作项同项目（S3）。
 *
 * 为什么必须校验：工作项的可见性由**项目**决定。若允许跨项目关联，
 * 「按项目过滤」与「按关联过滤」会给出矛盾结果 —— 例如 A 项目的人看到
 * 自己项目的工作项挂在 B 项目的里程碑下，而他对 B 项目根本不可见。
 *
 * 逐项查询而不是一次 CTE：只有 4 个字段，逐查更直白，也便于给出
 * 「到底是哪个字段、哪张表」的精确错误。
 */
async function assertPlanRefsSameProject(
  fields: Record<string, unknown>,
  projectId: string,
  previous: Record<string, unknown> = {},
): Promise<void> {
  const checks = [
    ["milestoneId", "milestone"],
    ["iterationId", "iteration"],
    ["releaseId", "release"],
    ["moduleId", "module"],
  ] as const;

  for (const [field, table] of checks) {
    const v = fields[field];
    if (v === undefined || v === null) continue;      // 未提供或解除关联

    // 注意：本文件的 sql 来自 src/db/index.ts（postgres.js 客户端），
    // 直接用它查询即可；它没有 .raw()（那是 drizzle 构造器的 API）。
    // ⚠️ 表名**不能**用 ${} 直接插值 —— postgres.js 会把裸标识符也参数化，
    //    生成 `from $1` 这种非法 SQL（实测报 42601）。
    //    必须用 sql(ident) 辅助函数；同时保留白名单，双保险。
    const TABLE_OK = new Set(["milestone", "iteration", "release", "module"]);
    if (!TABLE_OK.has(table)) throw new Error(`内部错误：未知计划实体表 ${table}`);
    const rows = table === "iteration" || table === "release"
      ? await sql<{ project_id: string | null; completed_at?: Date | null; archived_at?: Date | null }[]>`select project_id, completed_at, archived_at from ${sql(table)} where id = ${String(v)}::uuid limit 1`
      : await sql<{ project_id: string | null; completed_at?: Date | null; archived_at?: Date | null }[]>`select project_id, archived_at from ${sql(table)} where id = ${String(v)}::uuid limit 1`;

    const row = rows[0];
    if (!row) {
      throw new DomainError("VALIDATION", `关联的${table}不存在`, { field });
    }
    if (row.project_id !== projectId) {
      throw new DomainError("VALIDATION", `${table} 必须与工作项属于同一项目`, { field });
    }
    if (v !== previous[field] && (row.completed_at || row.archived_at)) {
      throw new DomainError("BLOCKED_BY_PREREQUISITE", "不能关联到已完成或归档的计划", { field });
    }
  }
}

/**
 * REST 普通列表与 MCP 共用授权、筛选、检索和投影；视图分发仍由路由处理。
 * 未指定排序的服务调用保留编号升序；REST 传入 schema 默认的 created 排序。
 */
export async function listWorkItems(
  actor: Actor,
  projectId: string,
  filters: { statusKey?: string; assigneeId?: string; type?: string; q?: string; priority?: string; parentId?: string;
    iterationId?: string; milestoneId?: string; releaseId?: string; moduleId?: string; unscheduled?: boolean;
    sort?: "created" | "updated" | "priority" | "dueDate";
    sortBy?: "created_at" | "updated_at" | "due_date" | "priority" | "number";
    sortDir?: "asc" | "desc"; page?: number; pageSize?: number } = {},
) {
  await assertProjectVisible(actor, projectId);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));

  const conds = [eq(workItem.projectId, projectId), isNull(workItem.deletedAt)];
  if (filters.assigneeId) conds.push(eq(workItem.assigneeId, filters.assigneeId));
  if (filters.type) conds.push(eq(workItem.type, filters.type));
  if (filters.priority) conds.push(eq(workItem.priority, filters.priority));
  if (filters.q) {
    // 同时保留 REST 的中文分词检索与服务的标题/编号/描述子串检索。
    conds.push(or(
      dsql`to_tsvector('chinese_zh', coalesce(${workItem.title}, '') || ' ' || coalesce(${workItem.description}, ''))
        @@ plainto_tsquery('chinese_zh', ${filters.q})`,
      ilike(workItem.title, `%${filters.q}%`),
      ilike(workItem.key, `%${filters.q}%`),
      ilike(workItem.description, `%${filters.q}%`),
    )!);
  }
  for (const field of ["parentId", "iterationId", "milestoneId", "releaseId", "moduleId"] as const) {
    if (filters[field]) conds.push(eq(workItem[field], filters[field]!));
  }
  if (filters.unscheduled === true) conds.push(and(isNull(workItem.startDate), isNull(workItem.dueDate))!);
  if (filters.unscheduled === false) conds.push(dsql`(${workItem.startDate} is not null or ${workItem.dueDate} is not null)`);
  if (filters.statusKey) {
    // ⚠️ 本文件里 sql 是 postgres.js 客户端，drizzle 的构造器用 dsql（同项目第三次踩这个坑，已固化注释）
    conds.push(dsql`${workItem.statusId} in (
      select id from workflow_state where workflow_id = ${workItem.workflowId} and key = ${filters.statusKey}
    )`);
  }

  const legacySort = { created: "created_at", updated: "updated_at", priority: "priority", dueDate: "due_date" } as const;
  const sortBy = filters.sortBy ?? (filters.sort ? legacySort[filters.sort] : "number");
  const sortable = {
    created_at: workItem.createdAt,
    updated_at: workItem.updatedAt,
    due_date: workItem.dueDate,
    // 字符串字母序不代表业务紧急程度。
    priority: dsql`case ${workItem.priority}
      when 'LOWEST' then 1 when 'LOW' then 2 when 'MEDIUM' then 3
      when 'HIGH' then 4 when 'URGENT' then 5 end`,
    number: workItem.number,
  };
  const direction = filters.sortDir ?? (["created_at", "updated_at", "priority"].includes(sortBy) ? "desc" : "asc");
  const order = direction === "desc" ? desc : asc;
  const rows = await db.select({
    id: workItem.id, key: workItem.key, number: workItem.number, title: workItem.title,
    type: workItem.type, priority: workItem.priority, severity: workItem.severity,
    assigneeId: workItem.assigneeId, statusId: workItem.statusId,
    projectId: workItem.projectId, workflowId: workItem.workflowId,
    statusKey: workflowState.key, statusName: workflowState.name, statusCategory: workflowState.category,
    startDate: workItem.startDate, dueDate: workItem.dueDate,
    createdAt: workItem.createdAt, updatedAt: workItem.updatedAt,
    version: workItem.version,
    // 计划实体关联（MCP plan.getMilestone 需按 milestoneId 过滤）
    milestoneId: workItem.milestoneId, iterationId: workItem.iterationId,
    releaseId: workItem.releaseId, moduleId: workItem.moduleId,
  }).from(workItem).leftJoin(workflowState, and(eq(workItem.statusId, workflowState.id), eq(workItem.workflowId, workflowState.workflowId))).where(and(...conds))
    .orderBy(dsql`${order(sortable[sortBy])} nulls last`, asc(workItem.number))
    .limit(pageSize).offset((page - 1) * pageSize);

  const cnt = await db.select({ n: dsql<number>`count(*)::int` }).from(workItem).where(and(...conds));
  return { items: rows, total: cnt[0]?.n ?? 0, page, pageSize };
}
