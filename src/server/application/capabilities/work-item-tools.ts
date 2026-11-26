/** 工作项附属资源；业务读写统一经领域服务，中央注册器负责通用 guard。 */
import type { ToolCtx, ToolDef } from "./tools.ts";
import { DomainError, forbidden } from "../../../shared/errors.ts";
import { can } from "../../permission/engine.ts";
import { projectAllowed } from "../../services/token.service.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import * as items from "../../services/work-item.service.ts";
import * as revisions from "../../services/requirement-revision.service.ts";
import * as relations from "../../services/relation.service.ts";
import * as times from "../../services/prefs-time.service.ts";
import { projectForMcpResource, type McpResourceKind } from "../../services/mcp-resource.service.ts";
import * as attachments from "../../services/attachment.service.ts";
import * as fields from "../../services/custom-field.service.ts";

const UUID = { type: "string", format: "uuid" };
const text = { type: "string" };
const boolean = { type: "boolean" };
const timestamp = { type: "string", format: "date-time" };
const date = { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const nullableText = { type: ["string", "null"], maxLength: 5000 };
const array = (items: object) => ({ type: "array", items });
const shape = (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: "object" as const, properties, required, additionalProperties: false });
const scoped = { projectId: UUID, workItemId: UUID };
const confirmation = { userConfirmed: { type: "boolean", description: "用户已明确确认本次写操作；必须为 true" } };
const writeScope = { ...scoped, ...confirmation };
const ok = shape({ ok: { type: "boolean", const: true } });
const MAX_INLINE_BYTES = 512 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_INLINE_BYTES / 3) * 4;
const base64 = { type: "string", minLength: 4, maxLength: MAX_BASE64_LENGTH, pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" };
const relationShape = { id: UUID, workItemId: UUID, relatedWorkItemId: UUID, projectId: UUID, key: text, title: text };
const relationResult = shape({ blocks: array(shape(relationShape)), blockedBy: array(shape(relationShape)), others: array(shape({ ...relationShape, type: text })) });
const timeInput = { minutes: { type: "integer", minimum: 1, maximum: 2147483647 }, loggedDate: date, note: nullableText };
const timeResult = shape({ id: UUID, workItemId: UUID, memberId: UUID, ...timeInput, createdAt: timestamp });
const attachmentResult = shape({ id: UUID, targetType: { type: "string", enum: ["WORK_ITEM", "PAGE", "MILESTONE", "IDEA", "COMMENT"] }, targetId: UUID, uploaderId: UUID, originalName: text, mimeType: text, sizeBytes: { type: "integer", minimum: 1 }, createdAt: timestamp });
const option = shape({ value: { type: "string", minLength: 1, maxLength: 200 }, label: { type: "string", minLength: 1, maxLength: 200 }, color: { type: "string", maxLength: 32 } }, ["value", "label"]);
const fieldPatch = { name: { type: "string", minLength: 1, maxLength: 80 }, options: { ...array(option), maxItems: 200 }, requiredStates: { ...array({ type: "string", minLength: 1, maxLength: 40 }), maxItems: 100, uniqueItems: true }, isRequired: boolean, sortOrder: { type: "integer", minimum: -2147483648, maximum: 2147483647 } };
const fieldResult = shape({ id: UUID, projectId: UUID, key: text, type: { type: "string", enum: [...fields.FIELD_TYPES] }, ...fieldPatch, archivedAt: { anyOf: [timestamp, { type: "null" }] }, createdAt: timestamp });
const fieldValue = { anyOf: [{ type: "null" }, { type: "string", maxLength: 5000 }, { type: "number" }, { ...array({ type: "string", maxLength: 200 }), maxItems: 200 }] };
const fieldValuesResult = shape({ fields: array(shape({ defId: UUID, key: text, name: text, type: { type: "string", enum: [...fields.FIELD_TYPES] }, archived: boolean, value: fieldValue })) });
const revisionMetadata = { id: UUID, workItemId: UUID, revisionNo: { type: "integer", minimum: 1 }, workItemVersion: { type: "integer", minimum: 1 }, title: text,
  authorId: { anyOf: [UUID, { type: "null" }] }, authorName: { type: ["string", "null"] }, source: { type: "string", enum: ["INITIAL", "EDIT", "BASELINE"] }, createdAt: timestamp };

function missing(): never { throw new DomainError("NOT_FOUND", "资源不存在", null); }
function present<T>(row: T | undefined): T {
  if (!row) throw new DomainError("INTERNAL", "业务操作未返回资源", null);
  return row;
}
function assertPatch(patch: object) {
  if (!Object.keys(patch).length) throw new DomainError("VALIDATION", "至少提供一个要更新的字段", null);
}
async function assertWorkItem(ctx: ToolCtx, args: Record<string, unknown>) {
  const row = await items.getWorkItem(ctx.actor, String(args.workItemId));
  if (row.projectId !== args.projectId || !projectAllowed(ctx.token, row.projectId)) missing();
  return row;
}
async function visibleRelations(ctx: ToolCtx, args: Record<string, unknown>) {
  await assertWorkItem(ctx, args);
  const result = await relations.listRelations(ctx.actor, String(args.workItemId));
  return {
    blocks: result.blocks.filter(row => projectAllowed(ctx.token, row.projectId)),
    blockedBy: result.blockedBy.filter(row => projectAllowed(ctx.token, row.projectId)),
    others: result.others.filter(row => projectAllowed(ctx.token, row.projectId)),
  };
}
async function assertTimeLog(ctx: ToolCtx, args: Record<string, unknown>) {
  await assertWorkItem(ctx, args);
  const row = (await times.listTimeLogs(ctx.actor, String(args.workItemId))).find(row => row.id === args.timeLogId);
  if (!row) missing();
  return row;
}
const attachmentScope = { projectId: UUID, workItemId: UUID, targetType: { type: "string", enum: ["WORK_ITEM", "PAGE", "MILESTONE", "IDEA", "COMMENT"] }, targetId: UUID };
function attachmentInput(extra: Record<string, object> = {}, required: string[] = []) {
  return { ...shape({ ...attachmentScope, ...extra }, ["projectId", ...required]), oneOf: [
    { required: ["workItemId"], not: { anyOf: [{ required: ["targetType"] }, { required: ["targetId"] }] } },
    { required: ["targetType", "targetId"], not: { required: ["workItemId"] } },
  ] };
}
async function attachmentTarget(args: Record<string, unknown>) {
  const targetType = typeof args.workItemId === "string" ? "WORK_ITEM" : String(args.targetType);
  const targetId = String(args.workItemId ?? args.targetId);
  const kind = { WORK_ITEM: "workItem", PAGE: "page", MILESTONE: "milestone", IDEA: "idea", COMMENT: "comment" }[targetType] as McpResourceKind;
  if (await projectForMcpResource(kind, targetId) !== args.projectId) missing();
  return { targetType, targetId };
}
async function assertAttachment(ctx: ToolCtx, args: Record<string, unknown>) {
  const { targetType, targetId } = await attachmentTarget(args);
  const row = (await attachments.listAttachments(ctx.actor, targetType, targetId)).find(row => row.id === args.attachmentId);
  if (!row) missing();
  return row;
}
async function assertField(ctx: ToolCtx, args: Record<string, unknown>) {
  const row = (await fields.listDefs(ctx.actor, String(args.projectId), { includeArchived: true })).find(row => row.id === args.fieldId);
  if (!row || !projectAllowed(ctx.token, row.projectId)) missing();
  return row;
}
function timeView(row: Awaited<ReturnType<typeof times.listTimeLogs>>[number]) {
  return { id: row.id, workItemId: row.workItemId, memberId: row.memberId, minutes: row.minutes, loggedDate: row.loggedDate, note: row.note, createdAt: row.createdAt.toISOString() };
}
function attachmentView(row: Awaited<ReturnType<typeof attachments.listAttachments>>[number]) {
  return { id: row.id, targetType: row.targetType, targetId: row.targetId, uploaderId: row.uploaderId, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, createdAt: row.createdAt.toISOString() };
}
function fieldView(row: Awaited<ReturnType<typeof fields.listDefs>>[number]) {
  return { id: row.id, projectId: row.projectId, key: row.key, name: row.name, type: row.type, options: row.options,
    requiredStates: row.requiredStates, isRequired: row.isRequired, sortOrder: row.sortOrder, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}

export const WORK_ITEM_TOOLS: ToolDef[] = [
  {
    name: "workitem.listRequirementRevisions", kind: "read", description: "分页读取需求正文历史元数据，按正文版本倒序；before 使用上一页 nextCursor。工作项乐观锁版本与正文版本独立。",
    inputSchema: shape({ ...scoped, before: { type: "integer", minimum: 1, maximum: 2147483647 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["projectId", "workItemId"]),
    outputSchema: shape({ items: array(shape(revisionMetadata)), nextCursor: { type: ["integer", "null"], minimum: 1 } }),
    handler: async (ctx, args) => {
      await assertWorkItem(ctx, args);
      return revisions.listRequirementRevisions(ctx.actor, String(args.workItemId), { before: args.before, limit: args.limit });
    },
  },
  {
    name: "workitem.getRequirementRevision", kind: "read", description: "读取指定需求的固定正文版本。旧数据 BASELINE 是捕获时的当前内容，不代表原始创建记录。",
    inputSchema: shape({ ...scoped, revisionId: UUID }),
    outputSchema: shape({ ...revisionMetadata, description: { type: ["string", "null"] } }),
    handler: async (ctx, args) => {
      await assertWorkItem(ctx, args);
      return revisions.getRequirementRevision(ctx.actor, String(args.workItemId), String(args.revisionId));
    },
  },
  {
    name: "workitem.listRelations", kind: "read", description: "读取工作项关联；仅返回账号可见且处于令牌项目范围的对端。",
    inputSchema: shape(scoped), outputSchema: relationResult,
    handler: visibleRelations,
  },
  {
    name: "workitem.removeRelation", kind: "write", description: "删除当前工作项的一条可见关联；需要 work_item:update_any 权限及 userConfirmed=true。",
    inputSchema: shape({ ...writeScope, relationId: UUID }), outputSchema: ok,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      const result = await visibleRelations(ctx, args);
      if (![...result.blocks, ...result.blockedBy, ...result.others].some(row => row.id === args.relationId)) missing();
      if (!can(ctx.actor, "work_item:update_any", { projectId: String(args.projectId) }, { memberId: ctx.actor.memberId, memberProjectIds: new Set(), memberTeamIds: new Set() })) throw forbidden();
      await relations.removeRelation(ctx.actor, String(args.workItemId), String(args.relationId));
      return { ok: true };
    },
  },
  {
    name: "workitem.listTimeLogs", kind: "read", description: "读取工作项工时记录。",
    inputSchema: shape(scoped), outputSchema: shape({ timeLogs: array(timeResult) }),
    handler: async (ctx, args) => { await assertWorkItem(ctx, args); return { timeLogs: (await times.listTimeLogs(ctx.actor, String(args.workItemId))).map(timeView) }; },
  },
  {
    name: "workitem.addTimeLog", kind: "write", description: "为当前账号记录工作项工时（分钟）；需要 userConfirmed=true。",
    inputSchema: shape({ ...writeScope, ...timeInput }, [...Object.keys(writeScope), "minutes", "loggedDate"]), outputSchema: timeResult,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true); await assertWorkItem(ctx, args);
      return timeView(present(await times.addTimeLog(ctx.actor, String(args.workItemId), { minutes: args.minutes as number, loggedDate: String(args.loggedDate), note: args.note as string | null | undefined })));
    },
  },
  {
    name: "workitem.updateTimeLog", kind: "write", description: "更新当前工作项工时；仅本人或有 work_item:update_any 权限的账号可修改，需要 userConfirmed=true。",
    inputSchema: shape({ ...writeScope, timeLogId: UUID, ...timeInput }, [...Object.keys(writeScope), "timeLogId"]), outputSchema: timeResult,
    handler: async (ctx, args) => {
      const { projectId: _project, workItemId: _item, timeLogId, userConfirmed, ...patch } = args;
      requireUserConfirmation(userConfirmed === true); assertPatch(patch); await assertTimeLog(ctx, args);
      return timeView(present(await times.updateTimeLog(ctx.actor, String(timeLogId), patch)));
    },
  },
  {
    name: "workitem.deleteTimeLog", kind: "write", description: "删除当前工作项工时；仅本人或有 work_item:update_any 权限的账号可删除，需要 userConfirmed=true。",
    inputSchema: shape({ ...writeScope, timeLogId: UUID }), outputSchema: ok,
    handler: async (ctx, args) => { requireUserConfirmation(args.userConfirmed === true); await assertTimeLog(ctx, args); await times.deleteTimeLog(ctx.actor, String(args.timeLogId)); return { ok: true }; },
  },
  {
    name: "attachment.list", kind: "read", description: "列出工作项、文档、里程碑、想法或评论的附件元数据；不返回存储地址或内部存储标识。",
    inputSchema: attachmentInput(), outputSchema: shape({ attachments: array(attachmentResult) }),
    handler: async (ctx, args) => { const target = await attachmentTarget(args); return { attachments: (await attachments.listAttachments(ctx.actor, target.targetType, target.targetId)).map(attachmentView) }; },
  },
  {
    name: "attachment.upload", kind: "write", description: "上传不超过512KiB的 base64 文件至指定业务对象；只接受文件名和内容，需 attachment:upload 权限及 userConfirmed=true。",
    inputSchema: attachmentInput({ ...confirmation, originalName: { type: "string", minLength: 1, maxLength: 200, pattern: "^[^/\\\\\\u0000-\\u001f\\u007f<>:\"|?*]+$" }, mimeType: { type: "string", minLength: 1, maxLength: 100 }, dataBase64: base64 }, ["userConfirmed", "originalName", "mimeType", "dataBase64"]), outputSchema: attachmentResult,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true); const target = await attachmentTarget(args);
      const data = Buffer.from(String(args.dataBase64), "base64");
      if (!data.length || data.length > MAX_INLINE_BYTES || data.toString("base64") !== args.dataBase64) throw new DomainError("VALIDATION", "附件必须为规范 base64 且内容不超过512KiB", null);
      return attachmentView(present(await attachments.upload(ctx.actor, { ...target, originalName: String(args.originalName), mimeType: String(args.mimeType), sizeBytes: data.length, data })));
    },
  },
  {
    name: "attachment.download", kind: "read", description: "读取业务对象附件内容（base64）；文件不得超过512KiB，大文件请通过已登录的附件下载入口读取。",
    inputSchema: attachmentInput({ attachmentId: UUID }, ["attachmentId"]), outputSchema: shape({ attachmentId: UUID, originalName: text, mimeType: text, sizeBytes: { type: "integer", minimum: 1, maximum: MAX_INLINE_BYTES }, dataBase64: base64 }),
    handler: async (ctx, args) => {
      const row = await assertAttachment(ctx, args);
      if (row.sizeBytes > MAX_INLINE_BYTES) throw new DomainError("VALIDATION", "附件超过512KiB内联下载上限", null);
      const file = await attachments.download(ctx.actor, row.id);
      if (file.data.length > MAX_INLINE_BYTES) throw new DomainError("VALIDATION", "附件超过512KiB内联下载上限", null);
      return { attachmentId: row.id, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.data.length, dataBase64: file.data.toString("base64") };
    },
  },
  {
    name: "attachment.delete", kind: "write", description: "删除当前业务对象的附件；仅上传者可删除，需要 userConfirmed=true。",
    inputSchema: attachmentInput({ ...confirmation, attachmentId: UUID }, ["userConfirmed", "attachmentId"]), outputSchema: ok,
    handler: async (ctx, args) => { requireUserConfirmation(args.userConfirmed === true); await assertAttachment(ctx, args); await attachments.remove(ctx.actor, String(args.attachmentId)); return { ok: true }; },
  },
  {
    name: "customField.list", kind: "read", description: "读取项目自定义字段定义；默认排除归档字段。",
    inputSchema: shape({ projectId: UUID, includeArchived: boolean }, ["projectId"]), outputSchema: shape({ fields: array(fieldResult) }),
    handler: async (ctx, args) => ({ fields: (await fields.listDefs(ctx.actor, String(args.projectId), { includeArchived: args.includeArchived === true })).map(fieldView) }),
  },
  {
    name: "customField.create", kind: "write", description: "创建项目自定义字段；需要 work_item:manage_field 权限及 userConfirmed=true。",
    inputSchema: shape({ projectId: UUID, ...confirmation, key: { type: "string", pattern: "^[a-z][a-z0-9_]{1,39}$" }, type: { type: "string", enum: [...fields.FIELD_TYPES] }, ...fieldPatch }, ["projectId", "userConfirmed", "key", "name", "type"]), outputSchema: fieldResult,
    handler: async (ctx, args) => {
      const { projectId, userConfirmed, ...input } = args;
      requireUserConfirmation(userConfirmed === true);
      return fieldView(present(await fields.createDef(ctx.actor, String(projectId), input as Parameters<typeof fields.createDef>[2])));
    },
  },
  {
    name: "customField.update", kind: "write", description: "更新项目自定义字段定义；key和type不可修改，需要 work_item:manage_field 权限及 userConfirmed=true。",
    inputSchema: shape({ projectId: UUID, fieldId: UUID, ...confirmation, ...fieldPatch }, ["projectId", "fieldId", "userConfirmed"]), outputSchema: fieldResult,
    handler: async (ctx, args) => {
      const { projectId: _project, fieldId, userConfirmed, ...patch } = args;
      requireUserConfirmation(userConfirmed === true); assertPatch(patch); const row = await assertField(ctx, args);
      if (patch.options !== undefined) {
        const options = patch.options as unknown[];
        const needsOptions = row.type === "SINGLE_SELECT" || row.type === "MULTI_SELECT";
        if (needsOptions ? !options.length : options.length > 0) throw new DomainError("VALIDATION", "选项必须符合字段类型，单选/多选至少保留一个选项", null);
      }
      return fieldView(present(await fields.updateDef(ctx.actor, String(fieldId), patch)));
    },
  },
  {
    name: "customField.archive", kind: "write", description: "归档项目自定义字段并保留历史值；需要 work_item:manage_field 权限及 userConfirmed=true。",
    inputSchema: shape({ projectId: UUID, fieldId: UUID, ...confirmation }), outputSchema: fieldResult,
    handler: async (ctx, args) => { requireUserConfirmation(args.userConfirmed === true); await assertField(ctx, args); await fields.archiveDef(ctx.actor, String(args.fieldId)); return fieldView(await assertField(ctx, args)); },
  },
  {
    name: "workitem.getFieldValues", kind: "read", description: "读取工作项自定义字段及其当前值，含归档字段历史值。",
    inputSchema: shape(scoped), outputSchema: fieldValuesResult,
    handler: async (ctx, args) => { await assertWorkItem(ctx, args); return { fields: await fields.getValues(ctx.actor, String(args.workItemId)) }; },
  },
  {
    name: "workitem.setFieldValues", kind: "write", description: "按字段定义ID更新工作项自定义字段值；null清空，未提供项保留。复用类型/必填/状态权限校验，需要 userConfirmed=true。",
    inputSchema: shape({ ...writeScope, values: { type: "object", minProperties: 1, maxProperties: 100, propertyNames: UUID, additionalProperties: fieldValue } }), outputSchema: fieldValuesResult,
    handler: async (ctx, args) => { requireUserConfirmation(args.userConfirmed === true); await assertWorkItem(ctx, args); return { fields: await fields.setValues(ctx.actor, String(args.workItemId), args.values as Record<string, unknown>) }; },
  },
];
