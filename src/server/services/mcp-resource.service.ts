/** MCP 令牌范围检查所需的资源归属查询；账号可见性和写权限仍由领域服务检查。 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  approvalRequest, comment, idea, iteration, milestone, module, page, release, workItem,
  attachment, automationRule, intakeForm, intakeSubmission, customFieldDef, dashboard, dashboardWidget,
  workflow, workflowState, workflowTransition, importBatch, integration, webhookEndpoint, webhookDelivery,
  workItemRelation, savedView, workItemProgressUpdate, milestoneProgressUpdate,
  timeLog, workItemLink, slaPolicy, timeBlock,
} from "../../db/schema.ts";

export type McpResourceKind = "workItem" | "page" | "idea" | "milestone" | "iteration" | "release" | "module" | "comment" | "approval"
  | "attachment" | "automationRule" | "intakeForm" | "intakeSubmission" | "customFieldDef" | "dashboard" | "dashboardWidget"
  | "workflow" | "workflowState" | "workflowTransition" | "importBatch" | "integration" | "webhookEndpoint" | "webhookDelivery"
  | "relation" | "savedView" | "workItemProgressUpdate" | "milestoneProgressUpdate" | "timeLog" | "contentLink" | "slaPolicy";

export async function projectForMcpResource(kind: McpResourceKind, id: string): Promise<string | null> {
  if (kind === "attachment") {
    const [row] = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);
    if (!row) return null;
    const targetKind = { WORK_ITEM: "workItem", PAGE: "page", MILESTONE: "milestone", IDEA: "idea", COMMENT: "comment" }[row.targetType] as McpResourceKind | undefined;
    return targetKind ? projectForMcpResource(targetKind, row.targetId) : null;
  }
  if (kind === "dashboardWidget") {
    const [row] = await db.select().from(dashboardWidget).where(eq(dashboardWidget.id, id)).limit(1);
    return row ? projectForMcpResource("dashboard", row.dashboardId) : null;
  }
  if (kind === "workflowState" || kind === "workflowTransition") {
    const table = kind === "workflowState" ? workflowState : workflowTransition;
    const [row] = await db.select({ workflowId: table.workflowId }).from(table).where(eq(table.id, id)).limit(1);
    return row ? projectForMcpResource("workflow", row.workflowId) : null;
  }
  if (kind === "webhookDelivery") {
    const [row] = await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, id)).limit(1);
    return row ? projectForMcpResource("webhookEndpoint", row.endpointId) : null;
  }
  if (kind === "intakeSubmission") {
    const [row] = await db.select({ formId: intakeSubmission.formId }).from(intakeSubmission).where(eq(intakeSubmission.id, id)).limit(1);
    return row ? projectForMcpResource("intakeForm", row.formId) : null;
  }
  if (kind === "contentLink") {
    const [row] = await db.select().from(workItemLink).where(eq(workItemLink.id, id)).limit(1);
    if (!row) return null;
    const sourceKind = { WORK_ITEM: "workItem", IDEA: "idea", PAGE: "page", MILESTONE: "milestone", ITERATION: "iteration" }[row.sourceType] as McpResourceKind | undefined;
    return sourceKind ? projectForMcpResource(sourceKind, row.sourceId) : null;
  }
  if (kind === "workItemProgressUpdate" || kind === "timeLog") {
    const table = { workItemProgressUpdate, timeLog }[kind];
    const workItemId = (await db.select({ workItemId: table.workItemId }).from(table).where(eq(table.id, id)).limit(1))[0]?.workItemId;
    return workItemId ? projectForMcpResource("workItem", workItemId) : null;
  }
  if (kind === "milestoneProgressUpdate") {
    const [row] = await db.select().from(milestoneProgressUpdate).where(eq(milestoneProgressUpdate.id, id)).limit(1);
    return row ? projectForMcpResource("milestone", row.milestoneId) : null;
  }
  if (kind === "comment") {
    const [row] = await db.select({ targetType: comment.targetType, targetId: comment.targetId }).from(comment).where(eq(comment.id, id)).limit(1);
    if (!row) return null;
    const targetKind = { WORK_ITEM: "workItem", PAGE: "page", MILESTONE: "milestone" }[row.targetType] as McpResourceKind | undefined;
    return targetKind ? projectForMcpResource(targetKind, row.targetId) : null;
  }
  if (kind === "approval") {
    const [row] = await db.select({ projectId: workItem.projectId }).from(approvalRequest)
      .innerJoin(workItem, eq(workItem.id, approvalRequest.workItemId)).where(eq(approvalRequest.id, id)).limit(1);
    return row?.projectId ?? null;
  }
  const table = { workItem, page, idea, milestone, iteration, release, module, automationRule, intakeForm,
    customFieldDef, dashboard, workflow, importBatch, integration, webhookEndpoint, savedView, relation: workItemRelation, slaPolicy }[kind];
  const [row] = await db.select({ projectId: table.projectId }).from(table).where(eq(table.id, id)).limit(1);
  return row?.projectId ?? null;
}

/** 只读归属查询；调用方必须继续检查token范围、账号可见性与业务操作权限。 */
export async function mcpIntakeFormProject(id: string) {
  const [row] = await db.select({ projectId: intakeForm.projectId }).from(intakeForm).where(eq(intakeForm.id, id)).limit(1);
  return row?.projectId ?? null;
}

export async function mcpIntakeSubmissionProject(id: string) {
  const [row] = await db.select({ projectId: intakeForm.projectId }).from(intakeSubmission)
    .innerJoin(intakeForm, eq(intakeForm.id, intakeSubmission.formId)).where(eq(intakeSubmission.id, id)).limit(1);
  return row?.projectId ?? null;
}

export async function mcpSavedView(id: string) {
  const [row] = await db.select().from(savedView).where(eq(savedView.id, id)).limit(1);
  return row ?? null;
}

export async function mcpDashboard(id: string) {
  const [row] = await db.select().from(dashboard).where(eq(dashboard.id, id)).limit(1);
  return row ?? null;
}

export async function mcpDashboardWidget(id: string) {
  const [row] = await db.select().from(dashboardWidget).where(eq(dashboardWidget.id, id)).limit(1);
  return row ?? null;
}

export async function mcpTimeBlock(id: string) {
  const [row] = await db.select().from(timeBlock).where(eq(timeBlock.id, id)).limit(1);
  return row ?? null;
}
