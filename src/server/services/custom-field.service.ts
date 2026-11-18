/**
 * 自定义字段（第八期 W2/W3，规范 3.4 节）
 *
 * 规范原文：**类型校验必须在应用层做**（jsonb 无法对 `fieldDefId → type` 做约束），
 * 每次读写自定义字段都要经本服务，**不得直查 custom_field_value**。
 *
 * 因此本文件是字段值的唯一入口：类型 / 选项 / 必填 / 状态必填 四类校验都在这里。
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { customFieldDef, customFieldValue, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { recordBusinessEvent } from "./event-log.ts";

export const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "PERSON"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

async function assertProjectVisible(actor: Actor, projectId: string) {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}

function assertCanManageField(actor: Actor, projectId: string) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "work_item:manage_field", { projectId, teamId: null }, ctx)) throw forbidden();
}

// ── 字段定义 ────────────────────────────────────────────────

export async function listDefs(actor: Actor, projectId: string, opts: { includeArchived?: boolean } = {}) {
  await assertProjectVisible(actor, projectId);
  const conds = [eq(customFieldDef.projectId, projectId)];
  if (!opts.includeArchived) conds.push(isNull(customFieldDef.archivedAt));
  return db.select().from(customFieldDef).where(and(...conds))
    .orderBy(asc(customFieldDef.sortOrder), asc(customFieldDef.key));
}

export async function createDef(actor: Actor, projectId: string, input: {
  key: string; name: string; type: string;
  options?: { value: string; label: string; color?: string }[];
  requiredStates?: string[]; isRequired?: boolean; sortOrder?: number;
}) {
  await assertProjectVisible(actor, projectId);
  assertCanManageField(actor, projectId);

  if (!KEY_RE.test(input.key)) {
    throw new DomainError("VALIDATION", "key 需以小写字母开头，仅含小写字母/数字/下划线，长度 2–40", null);
  }
  if (!(FIELD_TYPES as readonly string[]).includes(input.type)) {
    throw new DomainError("VALIDATION", `字段类型只支持 ${FIELD_TYPES.join(" / ")}`, null);
  }
  // 选项类字段必须有选项；非选项类不允许带选项（避免出现"填不满的选项"）
  const needsOptions = input.type === "SINGLE_SELECT" || input.type === "MULTI_SELECT";
  const opts = input.options ?? [];
  if (needsOptions && opts.length === 0) {
    throw new DomainError("VALIDATION", "单选/多选字段必须提供至少一个选项", null);
  }
  if (!needsOptions && opts.length > 0) {
    throw new DomainError("VALIDATION", "只有单选/多选字段可以带选项", null);
  }
  if (opts.some((o) => !o.value || !o.label)) {
    throw new DomainError("VALIDATION", "选项必须同时有 value 与 label", null);
  }

  const dup = await db.select({ id: customFieldDef.id }).from(customFieldDef)
    .where(and(eq(customFieldDef.projectId, projectId), eq(customFieldDef.key, input.key))).limit(1);
  if (dup[0]) throw new DomainError("VALIDATION", `字段 key「${input.key}」在本项目中已存在`, null);

  const [row] = await db.insert(customFieldDef).values({
    projectId,
    key: input.key,
    name: input.name,
    type: input.type,
    options: opts as object,
    requiredStates: (input.requiredStates ?? []) as object,
    isRequired: input.isRequired ?? false,
    sortOrder: input.sortOrder ?? 0,
  }).returning();
  await recordBusinessEvent({
    actor, action: "field.created", targetType: "CUSTOM_FIELD", targetId: row!.id, projectId,
    summary: `${actor.name} 创建了自定义字段「${input.name}」（${input.type}）`,
  });
  return row;
}

export async function updateDef(actor: Actor, id: string, patch: {
  name?: string; options?: { value: string; label: string; color?: string }[];
  requiredStates?: string[]; isRequired?: boolean; sortOrder?: number;
}) {
  const rows = await db.select().from(customFieldDef).where(eq(customFieldDef.id, id)).limit(1);
  const def = rows[0];
  if (!def) throw forbidden();
  await assertProjectVisible(actor, def.projectId);
  assertCanManageField(actor, def.projectId);
  // ⚠️ key 与 type 不可改：改了等于把已填的值全部作废（存量值按旧类型校验过）
  const [row] = await db.update(customFieldDef).set(patch as object).where(eq(customFieldDef.id, id)).returning();
  await recordBusinessEvent({
    actor, action: "field.updated", targetType: "CUSTOM_FIELD", targetId: id, projectId: def.projectId,
    summary: `${actor.name} 更新了自定义字段「${row!.name}」`,
  });
  return row;
}

export async function archiveDef(actor: Actor, id: string): Promise<void> {
  const rows = await db.select().from(customFieldDef).where(eq(customFieldDef.id, id)).limit(1);
  const def = rows[0];
  if (!def) throw forbidden();
  await assertProjectVisible(actor, def.projectId);
  assertCanManageField(actor, def.projectId);
  // 归档而非删除：**已填的值不丢**（读旧值仍返回，只是不再出现在可填列表）
  await db.update(customFieldDef).set({ archivedAt: new Date() }).where(eq(customFieldDef.id, id));
  await recordBusinessEvent({
    actor, action: "field.archived", targetType: "CUSTOM_FIELD", targetId: id, projectId: def.projectId,
    summary: `${actor.name} 归档了自定义字段「${def.name}」`,
  });
}

// ── 字段值（唯一入口）────────────────────────────────────────

export interface FieldValueView { defId: string; key: string; name: string; type: string; archived: boolean; value: unknown }

/** 读：合并定义与值（**归档字段的值也返回**，只是标记 archived） */
export async function getValues(actor: Actor, workItemId: string): Promise<FieldValueView[]> {
  const wi = await db.select().from(workItem).where(eq(workItem.id, workItemId)).limit(1);
  if (!wi[0]) throw forbidden();
  await assertProjectVisible(actor, wi[0].projectId);

  const defs = await db.select().from(customFieldDef)
    .where(eq(customFieldDef.projectId, wi[0].projectId))
    .orderBy(asc(customFieldDef.sortOrder));
  const rows = await db.select().from(customFieldValue).where(eq(customFieldValue.workItemId, workItemId)).limit(1);
  const values = (rows[0]?.values ?? {}) as Record<string, unknown>;

  return defs.map((d) => ({
    defId: d.id, key: d.key, name: d.name, type: d.type,
    archived: d.archivedAt !== null,
    value: values[d.id] ?? null,
  }));
}

/** 单值类型校验（服务层唯一实现） */
function validateOne(def: typeof customFieldDef.$inferSelect, v: unknown): void {
  const fail = (why: string) => { throw new DomainError("VALIDATION", `字段「${def.name}」${why}`, { fieldKey: def.key }); };
  if (v === null || v === undefined) return;
  const options = (def.options ?? []) as { value: string }[];
  switch (def.type as FieldType) {
    case "TEXT":
      if (typeof v !== "string") fail("必须是文本");
      if ((v as string).length > 5000) fail("超出长度上限");
      break;
    case "NUMBER":
      if (typeof v !== "number" || !Number.isFinite(v)) fail("必须是数字");
      break;
    case "DATE":
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail("必须是 YYYY-MM-DD 格式的日期");
      break;
    case "SINGLE_SELECT":
      if (typeof v !== "string") fail("必须是单个选项值");
      if (!options.some((o) => o.value === v)) fail("的取值不在选项中");
      break;
    case "MULTI_SELECT":
      if (!Array.isArray(v)) fail("必须是选项数组");
      for (const item of v as unknown[]) {
        if (typeof item !== "string" || !options.some((o) => o.value === item)) fail("含不在选项中的取值");
      }
      break;
    case "PERSON":
      if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) fail("必须是成员 ID（请先经项目成员列表取 ID）");
      break;
  }
}

/**
 * 写：整批替换。校验链 = 定义存在且同项目 → 类型 → 必填/状态必填。
 * 未提供的字段视为"不改动"（保留原值），显式传 null 才是清空。
 */
export async function setValues(actor: Actor, workItemId: string, patch: Record<string, unknown>) {
  const wi = await db.select().from(workItem).where(eq(workItem.id, workItemId)).limit(1);
  if (!wi[0] || wi[0].deletedAt) throw forbidden();
  await assertProjectVisible(actor, wi[0].projectId);

  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  const allowed = can(actor, "work_item:update_own", { projectId: wi[0].projectId, createdBy: wi[0].reporterId }, ctx)
    || can(actor, "work_item:update_any", { projectId: wi[0].projectId, createdBy: wi[0].reporterId }, ctx);
  if (!allowed) throw forbidden();

  const defs = await db.select().from(customFieldDef).where(eq(customFieldDef.projectId, wi[0].projectId));
  const byId = new Map(defs.map((d) => [d.id, d]));
  const cur = await db.select().from(customFieldValue).where(eq(customFieldValue.workItemId, workItemId)).limit(1);
  const merged = { ...((cur[0]?.values ?? {}) as Record<string, unknown>) };

  for (const [defId, v] of Object.entries(patch)) {
    const def = byId.get(defId);
    if (!def) throw new DomainError("VALIDATION", "字段不存在或不属于该项目", { defId });
    if (def.archivedAt) throw new DomainError("VALIDATION", `字段「${def.name}」已归档，不能再写`, { fieldKey: def.key });
    validateOne(def, v);
    if (v === null) delete merged[defId];
    else merged[defId] = v;
  }

  // 必填校验（含按状态必填）：读当前状态 key
  // 本文件的 sql 来自 drizzle-orm（构造器），必须经 db.execute —— 与其它服务里的
  // postgres.js 客户端不同名同形，本项目已因此踩坑四次，改动前先看导入来源。
  const stRows = await db.execute(sql`
    select key from workflow_state where id = ${wi[0].statusId} limit 1
  `) as unknown as { key: string }[];
  const stRow = stRows;
  const statusKey = stRow[0]?.key ?? null;

  for (const def of defs) {
    if (def.archivedAt) continue;
    const has = merged[def.id] !== undefined && merged[def.id] !== null
      && !(Array.isArray(merged[def.id]) && (merged[def.id] as unknown[]).length === 0);
    const states = (def.requiredStates ?? []) as string[];
    const requiredNow = def.isRequired || (statusKey !== null && states.includes(statusKey));
    if (requiredNow && !has) {
      throw new DomainError("VALIDATION",
        `字段「${def.name}」为必填${states.length ? `（当前状态 ${statusKey}）` : ""}`,
        { fieldKey: def.key, required: true });
    }
  }

  await db.insert(customFieldValue).values({ workItemId, values: merged as object })
    .onConflictDoUpdate({
      target: customFieldValue.workItemId,
      set: { values: merged as object, updatedAt: new Date() },
    });
  return getValues(actor, workItemId);
}
