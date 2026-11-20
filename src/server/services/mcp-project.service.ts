/** MCP 与 REST 复用的项目写入，以及有明确项目归属的洞察入口。 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, inTransaction } from "../../db/index.ts";
import {
  customFieldDef,
  dashboard,
  iteration,
  member,
  project,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import { updateProjectSchema } from "../../shared/schemas/project.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import * as projectService from "./project.service.ts";
import * as insight from "./insight.service.ts";
import * as field from "./custom-field.service.ts";
import * as exportService from "./export.service.ts";
import * as reportService from "./report.service.ts";
import * as integration from "./integration.service.ts";
import { recordBusinessEvent } from "./event-log.ts";

export function assertProjectPermission(
  actor: Actor,
  action: string,
  projectId: string | null,
): void {
  if (
    !can(
      actor,
      action,
      { projectId, teamId: null },
      {
        memberProjectIds: new Set(),
        memberTeamIds: new Set(),
        memberId: actor.memberId,
      },
    )
  )
    throw forbidden();
}
/** 幂等重放仍须重新检查当前授权，不能把旧缓存作为撤权后的读取通道。 */
export function assertProjectToolWritePermission(
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): void {
  let action: string;
  let projectId = typeof args.projectId === "string" ? args.projectId : null;
  if (name.startsWith("projectTemplate.")) {
    action = ["projectTemplate.update", "projectTemplate.delete"].includes(name)
      ? "project:update"
      : "project:create";
    projectId = null;
  } else if (name.startsWith("portfolio.")) {
    action = "project:create";
    projectId = null;
  } else if (name.startsWith("dashboard.")) action = "dashboard:manage";
  else if (name.startsWith("customField.")) action = "work_item:manage_field";
  else if (name.startsWith("integration.") || name.startsWith("webhook."))
    action = "integration:manage";
  else if (name.startsWith("project.member.")) action = "project:manage_member";
  else if (["project.archive", "project.unarchive"].includes(name))
    action = "project:archive";
  else if (name === "project.status") action = "project:manage_status";
  else if (name === "project.create") action = "project:create";
  else if (name === "project.update") action = "project:update";
  else throw new DomainError("INTERNAL", "项目写工具未声明动作权限", null);
  assertProjectPermission(actor, action, projectId);
}
async function assertVisible(actor: Actor, projectId: string) {
  if (
    !(await projectRepo.isVisibleTo(
      actor.memberId,
      projectId,
      actor.grants.some((g) => g.scopeType === "ORG"),
    ))
  )
    throw forbidden();
}
export async function updateProject(
  actor: Actor,
  projectId: string,
  patch: unknown,
) {
  const input = updateProjectSchema.parse(patch);
  await assertVisible(actor, projectId);
  assertProjectPermission(actor, "project:update", projectId);
  await projectService.assertDepartmentActive(input.departmentId);
  return inTransaction(async () => {
    const row = await projectRepo.update(projectId, input);
    if (!row) throw forbidden();
    await recordBusinessEvent({
      actor,
      action: "project.updated",
      targetType: "PROJECT",
      targetId: projectId,
      projectId,
      summary: `${actor.name} 更新了项目「${row.name}」`,
    });
    return { ok: true };
  });
}
export async function archiveProject(
  actor: Actor,
  projectId: string,
  archived: boolean,
) {
  await assertVisible(actor, projectId);
  assertProjectPermission(actor, "project:archive", projectId);
  return inTransaction(async () => {
    const row = await projectRepo.setArchived(projectId, archived);
    if (!row) throw forbidden();
    await recordBusinessEvent({
      actor,
      action: archived ? "project.archived" : "project.unarchived",
      targetType: "PROJECT",
      targetId: projectId,
      projectId,
      summary: `${actor.name} ${archived ? "归档" : "取消归档"}了项目「${row.name}」`,
    });
    return { ok: true };
  });
}
export async function transitionProjectStatus(
  actor: Actor,
  projectId: string,
  statusKey: string,
) {
  await assertVisible(actor, projectId);
  assertProjectPermission(actor, "project:manage_status", projectId);
  return inTransaction(async () => {
    const [p] = await db
      .select()
      .from(project)
      .where(eq(project.id, projectId))
      .for("update");
    if (!p) throw forbidden();
    const definitions = await projectRepo.listStatusDefs();
    const target = definitions.find((s) => s.key === statusKey);
    if (!target)
      throw new DomainError(
        "VALIDATION",
        `未知的项目状态「${statusKey}」`,
        null,
      );
    const current = definitions.find((s) => s.id === p.statusId);
    const from = current?.category ?? "NOT_STARTED";
    const allowed =
      from === "NOT_STARTED"
        ? target.category === "IN_PROGRESS" || target.key === "CANCELLED"
        : from === "IN_PROGRESS"
          ? target.category !== "NOT_STARTED"
          : target.category === "IN_PROGRESS";
    if (!allowed)
      throw new DomainError(
        "VALIDATION",
        `不允许从「${current?.name ?? "未开始"}」流转到「${target.name}」`,
        null,
      );
    await projectRepo.setStatus(projectId, target.id);
    await recordBusinessEvent({
      actor,
      action: "project.status_changed",
      targetType: "PROJECT",
      targetId: projectId,
      projectId,
      summary: `${actor.name} 把项目「${p.name}」状态改为「${target.name}」`,
    });
    return { ok: true };
  });
}
export async function listMembers(
  actor: Actor,
  input: { page?: number; pageSize?: number },
) {
  assertProjectPermission(actor, "member:manage", null);
  const page = input.page ?? 1,
    pageSize = input.pageSize ?? 50;
  const rows = await db
    .select({
      id: member.id,
      username: member.username,
      name: member.name,
      status: member.status,
      departmentId: member.departmentId,
      positionId: member.positionId,
    })
    .from(member)
    .where(isNull(member.anonymizedAt))
    .orderBy(asc(member.name), asc(member.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return {
    members: rows.slice(0, pageSize),
    page,
    pageSize,
    hasMore: rows.length > pageSize,
  };
}
export async function assertIterationProject(
  actor: Actor,
  projectId: string,
  iterationId: string,
) {
  await assertVisible(actor, projectId);
  const [it] = await db
    .select({ projectId: iteration.projectId })
    .from(iteration)
    .where(eq(iteration.id, iterationId))
    .limit(1);
  if (!it || it.projectId !== projectId)
    throw new DomainError("NOT_FOUND", "资源不存在", null);
}
export async function listDashboards(actor: Actor, projectId: string) {
  await assertVisible(actor, projectId);
  return (await insight.listDashboards(actor, projectId)).filter(
    (d) => d.projectId === projectId,
  );
}
export async function getDashboard(
  actor: Actor,
  projectId: string,
  dashboardId: string,
) {
  await assertVisible(actor, projectId);
  const [d] = await db
    .select({ projectId: dashboard.projectId })
    .from(dashboard)
    .where(eq(dashboard.id, dashboardId))
    .limit(1);
  if (!d || d.projectId !== projectId)
    throw new DomainError("NOT_FOUND", "资源不存在", null);
  const result = await insight.getDashboard(actor, dashboardId);
  for (const widget of result.widgets)
    await assertWidgetConfig(
      actor,
      projectId,
      widget.type,
      widget.config as Record<string, unknown>,
    );
  return result;
}
export async function getWidget(
  actor: Actor,
  projectId: string,
  dashboardId: string,
  widgetId: string,
) {
  await getDashboard(actor, projectId, dashboardId);
  return insight.getWidget(actor, dashboardId, widgetId);
}
export async function assertWidgetConfig(
  actor: Actor,
  projectId: string,
  type: string,
  config: Record<string, unknown> = {},
) {
  if (
    ["BURNDOWN", "CUMULATIVE_FLOW"].includes(type) &&
    typeof config.iterationId !== "string"
  )
    throw new DomainError(
      "VALIDATION",
      "燃尽/累积流挂件必须指定 iterationId",
      null,
    );
  if (typeof config.iterationId === "string")
    await assertIterationProject(actor, projectId, config.iterationId);
}
export async function addWidget(
  actor: Actor,
  projectId: string,
  dashboardId: string,
  input: Parameters<typeof insight.addWidget>[2],
) {
  await getDashboard(actor, projectId, dashboardId);
  await assertWidgetConfig(actor, projectId, input.type, input.config);
  return insight.addWidget(actor, dashboardId, input);
}
export async function updateWidget(
  actor: Actor,
  projectId: string,
  dashboardId: string,
  widgetId: string,
  patch: Parameters<typeof insight.updateWidget>[2],
) {
  const w = await getWidget(actor, projectId, dashboardId, widgetId);
  await assertWidgetConfig(
    actor,
    projectId,
    patch.type ?? w.type,
    patch.config ?? (w.config as Record<string, unknown>),
  );
  return insight.updateWidget(actor, widgetId, patch);
}
export async function updateField(
  actor: Actor,
  projectId: string,
  fieldId: string,
  patch: Parameters<typeof field.updateDef>[2],
) {
  await assertFieldProject(actor, projectId, fieldId);
  return field.updateDef(actor, fieldId, patch);
}
export async function assertFieldProject(
  actor: Actor,
  projectId: string,
  fieldId: string,
) {
  await assertVisible(actor, projectId);
  const [def] = await db
    .select({ id: customFieldDef.id })
    .from(customFieldDef)
    .where(
      and(
        eq(customFieldDef.id, fieldId),
        eq(customFieldDef.projectId, projectId),
      ),
    )
    .limit(1);
  if (!def) throw new DomainError("NOT_FOUND", "资源不存在", null);
}
export async function exportCsv(
  actor: Actor,
  projectId: string,
  filters: exportService.WorkItemExportFilters,
  limit = 1000,
) {
  const result = await exportService.exportWorkItemsCsv(
    actor,
    projectId,
    filters,
    { maxRows: limit },
  );
  if (Buffer.byteLength(result.csv) > 1024 * 1024)
    throw new DomainError("VALIDATION", "CSV 超过 1 MiB，请收窄筛选条件", null);
  return {
    ...result,
    mimeType: "text/csv",
    schemaVersion: exportService.EXPORT_SCHEMA_VERSION,
  };
}
export async function projectReport(actor: Actor, projectId: string) {
  const result = await reportService.projectReport(actor, projectId);
  if (result.buffer.length > 1024 * 1024)
    throw new DomainError("VALIDATION", "报告超过 1 MiB", null);
  return {
    filename: result.filename,
    mimeType: "application/pdf",
    sizeBytes: result.buffer.length,
    contentBase64: result.buffer.toString("base64"),
  };
}
export async function listIntegrations(actor: Actor, projectId: string) {
  return (await integration.listIntegrations(actor, projectId)).map(
    ({ id, kind, name, isActive, hasToken, createdAt, updatedAt }) => ({
      id,
      projectId,
      kind,
      name,
      isActive,
      hasToken,
      createdAt,
      updatedAt,
    }),
  );
}
