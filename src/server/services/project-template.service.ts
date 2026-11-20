/**
 * 项目模板（数据模型 2.4 / REST 第 3 节）
 *
 * 语义：`payload` = 工作项 / 里程碑 / 迭代的初始集，"从模板建项目"与导入共用；
 * **内置模板（is_builtin）只读** —— 改模板等于改所有未来项目的底版。
 *
 * 如实边界：创建流程是"先建项目，再逐项套用初始集"；中途失败不会回滚已建项目，
 * 返回 applied 计数并抛出/携带失败原因（v1 不做跨服务的分布式事务）。
 */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { projectTemplate } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectService from "./project.service.ts";
import * as planningService from "./planning.service.ts";
import * as wiService from "./work-item.service.ts";
import { publishWorkspaceInvalidation } from "./workspace-events.service.ts";

function ctxOf(actor: Actor): PermissionContext {
  return { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
}
function assertCan(actor: Actor, action: string): void {
  if (!can(actor, action, { projectId: null, teamId: null }, ctxOf(actor))) throw forbidden();
}

export const templatePayloadSchema = z.object({
  milestones: z.array(z.object({
    name: z.string().min(1).max(200),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })).max(50).optional(),
  iterations: z.array(z.object({
    name: z.string().min(1).max(200),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).max(50).optional(),
  workItems: z.array(z.object({
    title: z.string().min(1).max(500),
    type: z.enum(["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"]).default("TASK"),
    priority: z.enum(["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    description: z.string().max(5000).optional(),
  })).max(200).optional(),
}).strict();

export async function listTemplates(actor: Actor) {
  assertCan(actor, "project:create");
  return db.select().from(projectTemplate).orderBy(asc(projectTemplate.createdAt));
}

export async function getTemplate(actor: Actor, id: string) {
  assertCan(actor, "project:create");
  const row = (await db.select().from(projectTemplate).where(eq(projectTemplate.id, id)).limit(1))[0];
  if (!row) throw forbidden();
  return row;
}

export async function createTemplate(actor: Actor, input: { name: string; payload?: unknown }) {
  assertCan(actor, "project:create");
  const parsed = templatePayloadSchema.safeParse(input.payload ?? {});
  if (!parsed.success) throw new DomainError("VALIDATION", "模板 payload 不合法", parsed.error.issues);
  const [row] = await db.insert(projectTemplate).values({
    name: input.name.trim(), payload: parsed.data as object, isBuiltin: false,
  }).returning();
  await publishWorkspaceInvalidation({ domain: "projectTemplate", resourceType: "PROJECT_TEMPLATE", resourceId: row!.id });
  return row;
}

export async function updateTemplate(actor: Actor, id: string, patch: { name?: string; payload?: unknown }) {
  assertCan(actor, "project:update");
  const row = (await db.select().from(projectTemplate).where(eq(projectTemplate.id, id)).limit(1))[0];
  if (!row) throw forbidden();
  if (row.isBuiltin) throw new DomainError("FORBIDDEN", "内置模板只读（改模板等于改所有未来项目的底版）", null);
  let payload: unknown;
  if (patch.payload !== undefined) {
    const parsed = templatePayloadSchema.safeParse(patch.payload);
    if (!parsed.success) throw new DomainError("VALIDATION", "模板 payload 不合法", parsed.error.issues);
    payload = parsed.data;
  }
  const [updated] = await db.update(projectTemplate).set({
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(payload !== undefined ? { payload: payload as object } : {}),
  }).where(eq(projectTemplate.id, id)).returning();
  await publishWorkspaceInvalidation({ domain: "projectTemplate", resourceType: "PROJECT_TEMPLATE", resourceId: id });
  return updated;
}

export async function deleteTemplate(actor: Actor, id: string): Promise<void> {
  assertCan(actor, "project:update");
  const row = (await db.select().from(projectTemplate).where(eq(projectTemplate.id, id)).limit(1))[0];
  if (!row) throw forbidden();
  if (row.isBuiltin) throw new DomainError("FORBIDDEN", "内置模板不可删除", null);
  await db.delete(projectTemplate).where(eq(projectTemplate.id, id));
  await publishWorkspaceInvalidation({ domain: "projectTemplate", resourceType: "PROJECT_TEMPLATE", resourceId: id });
}

/** 从模板新建项目：先建项目（权限/KEY 唯一等由 projectService 判定），再逐项套用初始集 */
export async function createProjectFromTemplate(actor: Actor, input: {
  key: string; name: string; description?: string | null; templateId?: string | null;
}) {
  assertCan(actor, "project:create");
  let payload: z.infer<typeof templatePayloadSchema> = {};
  if (input.templateId) {
    const tpl = (await db.select().from(projectTemplate).where(eq(projectTemplate.id, input.templateId)).limit(1))[0];
    if (!tpl) throw forbidden();
    payload = tpl.payload as z.infer<typeof templatePayloadSchema>;
  }
  const project = await projectService.createProject(actor, {
    key: input.key, name: input.name, description: input.description ?? null,
  } as never);

  const applied = { milestones: 0, iterations: 0, workItems: 0 };
  const failures: { kind: string; name: string; error: string }[] = [];
  for (const ms of payload.milestones ?? []) {
    try { await planningService.createPlan(actor, project.id, "milestone", ms as never); applied.milestones++; }
    catch (e) { failures.push({ kind: "milestone", name: ms.name, error: (e as Error).message }); }
  }
  for (const it of payload.iterations ?? []) {
    try { await planningService.createPlan(actor, project.id, "iteration", it as never); applied.iterations++; }
    catch (e) { failures.push({ kind: "iteration", name: it.name, error: (e as Error).message }); }
  }
  for (const wi of payload.workItems ?? []) {
    try { await wiService.createWorkItem(actor, project.id, wi as never); applied.workItems++; }
    catch (e) { failures.push({ kind: "workItem", name: wi.title, error: (e as Error).message }); }
  }
  return { project, applied, failures };
}
