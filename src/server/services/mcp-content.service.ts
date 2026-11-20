/** MCP 内容边界：复用领域授权，响应不含匿名提交凭据或存储细节。 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { attachment } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as attachments from "./attachment.service.ts";
import * as automation from "./automation.service.ts";
import * as intake from "./intake.service.ts";
import * as sla from "./sla.service.ts";
import type { BusinessCalendar } from "../lib/sla-calendar.ts";

export const MCP_ATTACHMENT_LIMIT = 8 * 1024 * 1024;

export async function downloadAttachment(actor: Actor, attachmentId: string) {
  const [row] = await db
    .select()
    .from(attachment)
    .where(eq(attachment.id, attachmentId))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "附件不存在", null);
  // 先走目标资源授权，再检查大小，避免通过大小错误探测不可见资源。
  await attachments.listAttachments(actor, row.targetType, row.targetId);
  if (row.sizeBytes > MCP_ATTACHMENT_LIMIT)
    throw new DomainError(
      "VALIDATION",
      "MCP 附件最大为 8 MiB，请使用授权下载端点",
      null,
    );
  const file = await attachments.download(
    actor,
    attachmentId,
    MCP_ATTACHMENT_LIMIT,
  );
  if (file.data.byteLength > MCP_ATTACHMENT_LIMIT)
    throw new DomainError(
      "VALIDATION",
      "MCP 附件最大为 8 MiB，请使用授权下载端点",
      null,
    );
  return {
    attachmentId,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.data.byteLength,
    contentBase64: file.data.toString("base64"),
  };
}

async function ruleInProject(actor: Actor, projectId: string, ruleId: string) {
  const rules = await automation.listRules(actor, projectId);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) throw new DomainError("NOT_FOUND", "规则不存在", null);
  return rule;
}
export async function updateRule(
  actor: Actor,
  projectId: string,
  ruleId: string,
  patch: unknown,
) {
  await ruleInProject(actor, projectId, ruleId);
  return automation.updateRule(actor, projectId, ruleId, patch);
}
export async function deleteRule(
  actor: Actor,
  projectId: string,
  ruleId: string,
) {
  await ruleInProject(actor, projectId, ruleId);
  return automation.deleteRule(actor, projectId, ruleId);
}
export async function testRule(
  actor: Actor,
  projectId: string,
  ruleId: string,
  workItemId: string,
) {
  const rule = await ruleInProject(actor, projectId, ruleId);
  return automation.testRule(actor, projectId, rule, workItemId);
}

export async function getForm(actor: Actor, projectId: string, formId: string) {
  const forms = await intake.listForms(actor, projectId);
  const form = forms.find((f) => f.id === formId);
  if (!form) throw new DomainError("NOT_FOUND", "表单不存在", null);
  return form;
}
export async function createForm(
  actor: Actor,
  projectId: string,
  input: Parameters<typeof intake.createForm>[2],
) {
  const result = await intake.createForm(actor, projectId, input);
  return { form: result.form };
}

function validateSlaCalendar(calendar: BusinessCalendar | null | undefined) {
  if (
    calendar?.enabled &&
    (calendar.end ?? "18:00") <= (calendar.start ?? "09:00")
  )
    throw new DomainError(
      "VALIDATION",
      "SLA 工作日结束时间必须晚于开始时间",
      null,
    );
}
export async function createSlaPolicy(
  actor: Actor,
  projectId: string,
  input: Parameters<typeof sla.createPolicy>[2],
) {
  validateSlaCalendar(input.calendar);
  return sla.createPolicy(actor, projectId, input);
}
async function policyInProject(
  actor: Actor,
  projectId: string,
  policyId: string,
) {
  const policies = await sla.listPolicies(actor, projectId);
  const policy = policies.find((p) => p.id === policyId);
  if (!policy) throw new DomainError("NOT_FOUND", "策略不存在", null);
  return policy;
}
export async function updateSlaPolicy(
  actor: Actor,
  projectId: string,
  policyId: string,
  patch: Parameters<typeof sla.updatePolicy>[3],
) {
  const current = await policyInProject(actor, projectId, policyId);
  if (
    (patch.resolveMinutes ?? current.resolveMinutes) <
    (patch.responseMinutes ?? current.responseMinutes)
  )
    throw new DomainError("VALIDATION", "解决时限不能小于响应时限", null);
  validateSlaCalendar(
    patch.calendar === undefined
      ? (current.calendar as BusinessCalendar | null)
      : patch.calendar,
  );
  return sla.updatePolicy(actor, projectId, policyId, patch);
}
export async function deleteSlaPolicy(
  actor: Actor,
  projectId: string,
  policyId: string,
) {
  await policyInProject(actor, projectId, policyId);
  return sla.deletePolicy(actor, projectId, policyId);
}
