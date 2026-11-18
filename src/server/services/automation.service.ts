import { deferAfterCommit } from "../../db/context.ts";
/**
 * 自动化规则引擎（P1-1）
 *
 * 触发点：工作项创建/更新/状态变更/评论；规则执行身份 = 规则创建者（仍走权限与流转校验）。
 * 递归防护：AsyncLocalStorage 深度，最多 3 层；每层动作失败只记日志，不阻断主流程。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { automationRule, automationRun, roleAssignment, role } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { loadActor } from "../auth/actor-loader.ts";
import * as projectRepo from "../repos/project.repo.ts";
import * as wiRepo from "../repos/work-item.repo.ts";
import * as wfRepo from "../repos/workflow.repo.ts";
import { cronDue } from "../lib/cron.ts";
import { AUTOMATION_TRIGGERS, automationConditionsSchema, createAutomationRuleSchema, updateAutomationRuleSchema, type AutomationAction, type AutomationCondition } from "../../shared/schemas/automation.ts";

export const TRIGGERS = AUTOMATION_TRIGGERS;
export type Trigger = typeof TRIGGERS[number];

export type RuleCondition = AutomationCondition;
export type RuleAction = AutomationAction;

const runScope = new AsyncLocalStorage<{ depth: number }>();
const MAX_DEPTH = 3;

function assertManage(actor: Actor, projectId: string): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "project:update", { projectId, teamId: null }, ctx)) throw forbidden();
}
async function assertProjectVisible(actor: Actor, projectId: string): Promise<void> {
  const org = actor.grants.some((g) => g.scopeType === "ORG");
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, org))) throw forbidden();
}

const executionSchema = createAutomationRuleSchema.pick({ conditions: true, actions: true });
function executableRule(rule: { conditions?: unknown; actions: unknown }) {
  const parsed = executionSchema.safeParse({ conditions: rule.conditions ?? {}, actions: rule.actions });
  if (!parsed.success) throw new DomainError("VALIDATION", "自动化规则内容不合法", parsed.error.issues);
  return { conditions: [...(parsed.data.conditions?.all ?? []), ...(parsed.data.conditions?.any ?? [])], actions: parsed.data.actions };
}
function stringField(row: Record<string, unknown>, key: string): unknown { return row[key]; }

function matches(conditions: RuleCondition[], item: Record<string, unknown>, statusKey: string): boolean {
  if (conditions.length === 0) return true;
  return conditions.every((c) => {
    const actual = c.field === "statusKey" ? statusKey : stringField(item, c.field);
    const expected = c.value;
    switch (c.op) {
      case "eq": return String(actual ?? "") === String(expected ?? "");
      case "neq": return String(actual ?? "") !== String(expected ?? "");
      case "in": return Array.isArray(expected) && expected.map(String).includes(String(actual ?? ""));
      case "not_in": return Array.isArray(expected) && !expected.map(String).includes(String(actual ?? ""));
      case "contains": return String(actual ?? "").includes(String(expected ?? ""));
      case "is_empty": return actual == null || actual === "";
      case "is_not_empty": return actual != null && actual !== "";
      default: return false;
    }
  });
}

/** 管理 API 用 */
export async function listRules(actor: Actor, projectId: string) {
  assertManage(actor, projectId);
  await assertProjectVisible(actor, projectId);
  return db.select().from(automationRule).where(eq(automationRule.projectId, projectId)).orderBy(asc(automationRule.createdAt));
}
export async function createRule(actor: Actor, projectId: string, raw: unknown) {
  assertManage(actor, projectId);
  await assertProjectVisible(actor, projectId);
  const parsed = createAutomationRuleSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "自动化规则参数不合法", parsed.error.issues);
  const input = parsed.data;
  const [row] = await db.insert(automationRule).values({
    projectId, name: input.name.trim(), trigger: input.trigger,
    conditions: (input.conditions ?? {}) as object, actions: input.actions as object,
    scheduleCron: input.scheduleCron?.trim() || null, scheduleTimezone: input.scheduleTimezone?.trim() || "Asia/Shanghai",
    enabled: input.enabled ?? true, createdBy: actor.memberId,
  }).returning();
  return row!;
}
export async function updateRule(actor: Actor, projectId: string, id: string, raw: unknown) {
  assertManage(actor, projectId);
  const parsed = updateAutomationRuleSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "自动化规则参数不合法", parsed.error.issues);
  const patch = parsed.data;
  const [row] = await db.update(automationRule).set({
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
    ...(patch.conditions !== undefined ? { conditions: patch.conditions as object } : {}),
    ...(patch.actions !== undefined ? { actions: patch.actions as object } : {}),
    ...(patch.scheduleCron !== undefined ? { scheduleCron: patch.scheduleCron?.trim() || null } : {}),
    ...(patch.scheduleTimezone !== undefined ? { scheduleTimezone: patch.scheduleTimezone?.trim() || "Asia/Shanghai" } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: new Date(),
  }).where(and(eq(automationRule.id, id), eq(automationRule.projectId, projectId))).returning();
  if (!row) throw new DomainError("NOT_FOUND", "规则不存在", null);
  return row;
}
export async function deleteRule(actor: Actor, projectId: string, id: string) {
  assertManage(actor, projectId);
  await db.delete(automationRule).where(and(eq(automationRule.id, id), eq(automationRule.projectId, projectId)));
  return { ok: true };
}
export async function listRuns(actor: Actor, projectId: string, opts: { workItemId?: string; limit?: number } = {}) {
  assertManage(actor, projectId);
  const conds = [eq(automationRun.ruleId, automationRule.id), eq(automationRule.projectId, projectId)];
  if (opts.workItemId) conds.push(eq(automationRun.workItemId, opts.workItemId));
  return db.select({ run: automationRun, ruleName: automationRule.name }).from(automationRun)
    .innerJoin(automationRule, eq(automationRule.id, automationRun.ruleId))
    .where(and(...conds)).orderBy(desc(automationRun.createdAt)).limit(Math.min(200, opts.limit ?? 50));
}

/** 管理端 dry-run：只判断条件，不执行动作 */
export async function testRule(actor: Actor, projectId: string, rule: { conditions?: unknown }, workItemId: string) {
  assertManage(actor, projectId);
  await assertProjectVisible(actor, projectId);
  const item = await wiRepo.findById(workItemId);
  if (!item) throw new DomainError("NOT_FOUND", "工作项不存在", null);
  if (item.projectId !== projectId) throw new DomainError("VALIDATION", "工作项不属于该项目", null);
  const states = await wfRepo.listStates(item.workflowId);
  const statusKey = states.find((s) => s.id === item.statusId)?.key ?? "";
  const parsed = automationConditionsSchema.safeParse(rule.conditions ?? {});
  if (!parsed.success) throw new DomainError("VALIDATION", "自动化条件不合法", parsed.error.issues);
  const conditions = [...(parsed.data.all ?? []), ...(parsed.data.any ?? [])];
  return { matched: matches(conditions, item as unknown as Record<string, unknown>, statusKey) };
}

async function resolveRoleMembers(roleKeys: string[]): Promise<string[]> {
  if (roleKeys.length === 0) return [];
  const all = await db.select({ memberId: roleAssignment.memberId, roleKey: role.key })
    .from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(eq(roleAssignment.scopeType, "ORG"));
  return [...new Set(all.filter((r) => roleKeys.includes(r.roleKey)).map((r) => r.memberId))];
}

async function executeAction(actor: Actor, rule: typeof automationRule.$inferSelect, itemId: string, action: RuleAction): Promise<unknown> {
  const { updateWorkItem, transitionWorkItem } = await import("./work-item.service.ts");
  const current = await wiRepo.findById(itemId);
  if (!current) throw new DomainError("NOT_FOUND", "工作项不存在", null);
  if (action.type === "ASSIGN") {
    const assigneeId = String(action.memberId ?? "");
    if (!assigneeId) throw new DomainError("VALIDATION", "ASSIGN 缺少 memberId", null);
    return updateWorkItem(actor, itemId, { version: current.version, assigneeId });
  }
  if (action.type === "SET_FIELD") {
    const field = String(action.field ?? "");
    const allowed = new Set(["priority", "assigneeId", "iterationId", "milestoneId"]);
    if (!allowed.has(field)) throw new DomainError("VALIDATION", `不支持自动修改字段 ${field}`, null);
    return updateWorkItem(actor, itemId, { version: current.version, [field]: action.value ?? null });
  }
  if (action.type === "TRANSITION") {
    const toStateKey = String(action.toStateKey ?? "");
    if (!toStateKey) throw new DomainError("VALIDATION", "TRANSITION 缺少 toStateKey", null);
    return transitionWorkItem(actor, itemId, { toStateKey, version: current.version });
  }
  if (action.type === "ADD_COMMENT") {
    const { createComment } = await import("./comment.service.ts");
    return createComment(actor, { targetType: "WORK_ITEM", targetId: itemId, body: String(action.body ?? "自动化规则触发的评论") });
  }
  if (action.type === "NOTIFY") {
    const { notify } = await import("./notification.service.ts");
    const memberIds = Array.isArray(action.memberIds) ? action.memberIds.map(String) : [];
    const roleKeys = Array.isArray(action.roles) ? action.roles.map(String) : [];
    const targets = [...new Set([...memberIds, ...(await resolveRoleMembers(roleKeys))])];
    for (const recipientId of targets) {
      await notify({
        recipientId, actorId: actor.memberId, category: "FIELD_CHANGE", type: "automation.notify",
        title: String(action.title ?? `自动化规则「${rule.name}」`), body: String(action.body ?? current.title),
        link: `/work-items/${itemId}`,
      });
    }
    return { notified: targets.length };
  }
  if (action.type === "CALL_WEBHOOK") {
    const { deliver } = await import("./webhook.service.ts");
    await deliver("automation.rule", { ruleId: rule.id, workItemId: itemId }, current.projectId);
    return { delivered: true };
  }
  throw new DomainError("VALIDATION", "不支持的自动化动作", null);
}

async function recordRuleFailure(ruleId: string, trigger: Trigger, workItemId: string | null, error: unknown) {
  try {
    await db.insert(automationRun).values({ ruleId, trigger, workItemId, status: "FAILED", actions: [], error: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
  } catch (recordError) { console.warn("[automation] 记录失败规则时出错", recordError); }
}

/**
 * 对外触发入口。调用方 await 它；错误在这里吞掉，自动化失败不影响主操作。
 */
export async function triggerAutomation(trigger: Trigger, workItemId: string): Promise<void> {
  const depth = runScope.getStore()?.depth ?? 0;
  if (depth >= MAX_DEPTH) return;
  const item = await wiRepo.findById(workItemId);
  if (!item) return;
  const rules = await db.select().from(automationRule)
    .where(and(eq(automationRule.projectId, item.projectId), eq(automationRule.enabled, true), eq(automationRule.trigger, trigger)));
  if (rules.length === 0) return;
  const states = await wfRepo.listStates(item.workflowId);
  const statusKey = states.find((s) => s.id === item.statusId)?.key ?? "";
  await runScope.run({ depth: depth + 1 }, async () => {
    for (const rule of rules) {
      try {
        const executable = executableRule(rule);
        if (!matches(executable.conditions, item as unknown as Record<string, unknown>, statusKey)) continue;
        const actor = rule.createdBy ? await loadActor(rule.createdBy) : null;
        if (!actor) {
          await db.insert(automationRun).values({ ruleId: rule.id, workItemId, trigger, status: "FAILED", actions: [], error: "规则创建者不存在" });
          continue;
        }
        const results: unknown[] = [];
        let status: "SUCCESS" | "FAILED" = "SUCCESS";
        let error: string | null = null;
        for (const action of executable.actions) {
          try { results.push({ action: action.type, result: await executeAction(actor, rule, workItemId, action) }); }
          catch (e) { status = "FAILED"; error = (e as Error).message.slice(0, 500); results.push({ action: action.type, error: error }); }
        }
        await db.insert(automationRun).values({ ruleId: rule.id, workItemId, trigger, status, actions: results as object, error });
      } catch (error) { await recordRuleFailure(rule.id, trigger, workItemId, error); }
    }
  });
}

/** 扫描定时规则：同一分钟最多执行一次；对项目内匹配条件的工作项执行动作。 */
export async function runScheduledAutomations(now = new Date()): Promise<{ rules: number; items: number }> {
  const rules = await db.select().from(automationRule)
    .where(and(eq(automationRule.enabled, true), eq(automationRule.trigger, "SCHEDULE")));
  let ruleCount = 0, itemCount = 0;
  const { workItem } = await import("../../db/schema.ts");
  for (const rule of rules) {
    try {
      if (!rule.scheduleCron || !cronDue(rule.scheduleCron, rule.scheduleTimezone ?? "Asia/Shanghai", now)) continue;
      if (rule.lastScheduledAt && now.getTime() - rule.lastScheduledAt.getTime() < 30_000) continue;
      const claimed = await db.update(automationRule).set({ lastScheduledAt: now, updatedAt: now })
        .where(and(eq(automationRule.id, rule.id), eq(automationRule.enabled, true))).returning({ id: automationRule.id });
      if (claimed.length === 0) continue;
      const executable = executableRule(rule);
      ruleCount += 1;
      const items = await db.select().from(workItem)
        .where(and(eq(workItem.projectId, rule.projectId), sql`${workItem.deletedAt} IS NULL`)).limit(500);
      const actor = rule.createdBy ? await loadActor(rule.createdBy) : null;
      if (!actor) continue;
      for (const item of items) {
        const states = await wfRepo.listStates(item.workflowId);
        const statusKey = states.find((s) => s.id === item.statusId)?.key ?? "";
        if (!matches(executable.conditions, item as unknown as Record<string, unknown>, statusKey)) continue;
        const results: unknown[] = []; let status: "SUCCESS" | "FAILED" = "SUCCESS"; let error: string | null = null;
        for (const action of executable.actions) {
          try { results.push({ action: action.type, result: await executeAction(actor, rule, item.id, action) }); }
          catch (e) { status = "FAILED"; error = (e as Error).message.slice(0, 500); results.push({ action: action.type, error }); }
        }
        await db.insert(automationRun).values({ ruleId: rule.id, workItemId: item.id, trigger: "SCHEDULE", status, actions: results as object, error });
        itemCount += 1;
      }
    } catch (error) { await recordRuleFailure(rule.id, "SCHEDULE", null, error); }
  }
  return { rules: ruleCount, items: itemCount };
}

/** 供工作项服务调用的安全包装：绝不把自动化异常抛给主请求 */
export async function runAutomation(trigger: Trigger, workItemId: string): Promise<void> {
  // 队列 drain 会回到外层扫描上下文，须保留触发时深度，避免联动绕过递归上限。
  const scope = runScope.getStore() ?? { depth: 0 };
  const run = () => runScope.run(scope, async () => {
    try { await triggerAutomation(trigger, workItemId); }
    catch (e) { console.warn("[automation] 执行失败", (e as Error).message); }
  });
  if (deferAfterCommit(run)) return;
  await run();
}

/** 清理 90 天前运行日志（定时任务调用） */
export async function pruneRuns(): Promise<void> {
  await db.delete(automationRun).where(sql`${automationRun.createdAt} < now() - interval '90 days'`);
}
