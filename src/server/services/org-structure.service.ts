/**
 * 组织架构（Round 66 · 对标 YouQu 的部门/职位 P1）
 *
 * 与 team 的分工：team 是权限/协作范围；department/position 是**组织架构**，成员可归属。
 * 纪律：部门/职位删除一律**归档**（可恢复），归档时把成员的归属置空；部门归档要求无活跃子部门。
 * 所有写操作要求 `member:manage`；读（目录）任何已认证成员可读。
 */
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { department, member, position } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { writeAudit } from "./audit.service.ts";

function ctxOf(actor: Actor): PermissionContext {
  return { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
}
function assertManage(actor: Actor): void {
  if (!can(actor, "member:manage", { projectId: null, teamId: null }, ctxOf(actor))) throw forbidden();
}
const clean = (v: string | undefined | null): string | null => (v?.trim() ? v.trim() : null);

export async function listDepartments() {
  const rows = await db.select().from(department).where(isNull(department.archivedAt))
    .orderBy(asc(department.sortOrder), asc(department.name));
  const counts = await db.select({ departmentId: member.departmentId, n: count() }).from(member)
    .where(isNull(member.anonymizedAt)).groupBy(member.departmentId);
  const map = new Map(counts.filter((c) => c.departmentId).map((c) => [String(c.departmentId), Number(c.n)]));
  return {
    departments: rows.map((d) => ({ ...d, memberCount: map.get(d.id) ?? 0 })),
    metric: "memberCount = 直属该部门的未注销成员数（不含子部门）",
  };
}

export async function createDepartment(actor: Actor, input: { name: string; parentId?: string | null }) {
  assertManage(actor);
  const name = input.name.trim();
  if (!name) throw new DomainError("VALIDATION", "部门名称不能为空", null);
  if (name.length > 80) throw new DomainError("VALIDATION", "部门名称不能超过 80 字", null);
  const parentId = input.parentId ?? null;
  if (parentId) {
    const [p] = await db.select({ id: department.id }).from(department)
      .where(and(eq(department.id, parentId), isNull(department.archivedAt))).limit(1);
    if (!p) throw new DomainError("VALIDATION", "上级部门不存在或已归档", null);
  }
  const [dup] = await db.select({ id: department.id }).from(department).where(and(
    parentId ? eq(department.parentId, parentId) : isNull(department.parentId),
    eq(department.name, name),
  )).limit(1);
  if (dup) throw new DomainError("CONFLICT", "同级已存在同名部门", null);
  const [max] = await db.select({ n: sql<number>`coalesce(max(sort_order), 0)::int` }).from(department);
  const [row] = await db.insert(department).values({ name, parentId, sortOrder: Number(max?.n ?? 0) + 10 }).returning();
  await writeAudit({ actorId: actor.memberId, action: "department.created", targetType: "DEPARTMENT", targetId: row!.id, changes: { name, parentId }, severity: "BUSINESS" });
  return row;
}

async function assertNoCycle(id: string, parentId: string | null): Promise<void> {
  let cur = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) throw new DomainError("VALIDATION", "不能把部门挂到自己的子部门下", null);
    if (seen.has(cur)) break;
    seen.add(cur);
    const [row] = await db.select({ parentId: department.parentId }).from(department).where(eq(department.id, cur)).limit(1);
    cur = row?.parentId ?? null;
  }
}

export async function updateDepartment(actor: Actor, id: string, input: { name?: string; parentId?: string | null; sortOrder?: number }) {
  assertManage(actor);
  const [cur] = await db.select().from(department).where(eq(department.id, id)).limit(1);
  if (!cur || cur.archivedAt) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const name = input.name !== undefined ? input.name.trim() : cur.name;
  if (!name || name.length > 80) throw new DomainError("VALIDATION", "部门名称需为 1–80 字", null);
  const parentId = input.parentId !== undefined ? input.parentId : cur.parentId;
  if (parentId) {
    if (parentId === id) throw new DomainError("VALIDATION", "部门不能以自己为上级", null);
    const [p] = await db.select({ id: department.id }).from(department)
      .where(and(eq(department.id, parentId), isNull(department.archivedAt))).limit(1);
    if (!p) throw new DomainError("VALIDATION", "上级部门不存在或已归档", null);
    await assertNoCycle(id, parentId);
  }
  const [dup] = await db.select({ id: department.id }).from(department).where(and(
    parentId ? eq(department.parentId, parentId) : isNull(department.parentId),
    eq(department.name, name),
  )).limit(1);
  if (dup && dup.id !== id) throw new DomainError("CONFLICT", "同级已存在同名部门", null);
  const [row] = await db.update(department).set({
    name, parentId, sortOrder: input.sortOrder ?? cur.sortOrder,
  }).where(eq(department.id, id)).returning();
  await writeAudit({ actorId: actor.memberId, action: "department.updated", targetType: "DEPARTMENT", targetId: id, changes: { name, parentId }, severity: "BUSINESS" });
  return row;
}

export async function archiveDepartment(actor: Actor, id: string) {
  assertManage(actor);
  const [cur] = await db.select().from(department).where(eq(department.id, id)).limit(1);
  if (!cur || cur.archivedAt) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const [child] = await db.select({ n: count() }).from(department)
    .where(and(eq(department.parentId, id), isNull(department.archivedAt)));
  if (Number(child?.n ?? 0) > 0) throw new DomainError("CONFLICT", "该部门仍有子部门，请先处理子部门", null);
  await db.update(member).set({ departmentId: null, updatedAt: new Date() }).where(eq(member.departmentId, id));
  await db.update(department).set({ archivedAt: new Date() }).where(eq(department.id, id));
  await writeAudit({ actorId: actor.memberId, action: "department.archived", targetType: "DEPARTMENT", targetId: id, severity: "BUSINESS" });
}

export async function listPositions() {
  const rows = await db.select({
    id: position.id, name: position.name, code: position.code, departmentId: position.departmentId,
    description: position.description, sortOrder: position.sortOrder, createdAt: position.createdAt,
    departmentName: department.name,
  }).from(position).leftJoin(department, eq(department.id, position.departmentId))
    .where(isNull(position.archivedAt)).orderBy(asc(position.sortOrder), asc(position.name));
  const counts = await db.select({ positionId: member.positionId, n: count() }).from(member)
    .where(isNull(member.anonymizedAt)).groupBy(member.positionId);
  const map = new Map(counts.filter((c) => c.positionId).map((c) => [String(c.positionId), Number(c.n)]));
  return { positions: rows.map((p) => ({ ...p, memberCount: map.get(p.id) ?? 0 })) };
}

export async function createPosition(actor: Actor, input: { name: string; code?: string | null; departmentId?: string | null; description?: string | null }) {
  assertManage(actor);
  const name = input.name.trim();
  if (!name || name.length > 80) throw new DomainError("VALIDATION", "职位名称需为 1–80 字", null);
  const departmentId = clean(input.departmentId);
  if (departmentId) {
    const [d] = await db.select({ id: department.id }).from(department)
      .where(and(eq(department.id, departmentId), isNull(department.archivedAt))).limit(1);
    if (!d) throw new DomainError("VALIDATION", "所属部门不存在或已归档", null);
  }
  const [dup] = await db.select({ id: position.id }).from(position).where(eq(position.name, name)).limit(1);
  if (dup) throw new DomainError("CONFLICT", "已存在同名的未归档职位", null);
  const [row] = await db.insert(position).values({
    name, code: clean(input.code), departmentId, description: clean(input.description),
  }).returning();
  await writeAudit({ actorId: actor.memberId, action: "position.created", targetType: "POSITION", targetId: row!.id, changes: { name }, severity: "BUSINESS" });
  return row;
}

export async function updatePosition(actor: Actor, id: string, input: { name?: string; code?: string | null; departmentId?: string | null; description?: string | null; sortOrder?: number }) {
  assertManage(actor);
  const [cur] = await db.select().from(position).where(eq(position.id, id)).limit(1);
  if (!cur || cur.archivedAt) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const name = input.name !== undefined ? input.name.trim() : cur.name;
  if (!name || name.length > 80) throw new DomainError("VALIDATION", "职位名称需为 1–80 字", null);
  const departmentId = input.departmentId !== undefined ? clean(input.departmentId) : cur.departmentId;
  if (departmentId) {
    const [d] = await db.select({ id: department.id }).from(department)
      .where(and(eq(department.id, departmentId), isNull(department.archivedAt))).limit(1);
    if (!d) throw new DomainError("VALIDATION", "所属部门不存在或已归档", null);
  }
  const [row] = await db.update(position).set({
    name, code: input.code !== undefined ? clean(input.code) : cur.code,
    departmentId, description: input.description !== undefined ? clean(input.description) : cur.description,
    sortOrder: input.sortOrder ?? cur.sortOrder,
  }).where(eq(position.id, id)).returning();
  await writeAudit({ actorId: actor.memberId, action: "position.updated", targetType: "POSITION", targetId: id, changes: { name, departmentId }, severity: "BUSINESS" });
  return row;
}

export async function archivePosition(actor: Actor, id: string) {
  assertManage(actor);
  const [cur] = await db.select().from(position).where(eq(position.id, id)).limit(1);
  if (!cur || cur.archivedAt) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  await db.update(member).set({ positionId: null, updatedAt: new Date() }).where(eq(member.positionId, id));
  await db.update(position).set({ archivedAt: new Date() }).where(eq(position.id, id));
  await writeAudit({ actorId: actor.memberId, action: "position.archived", targetType: "POSITION", targetId: id, severity: "BUSINESS" });
}

export async function assignMemberOrganization(actor: Actor, memberId: string, input: { departmentId?: string | null; positionId?: string | null }) {
  assertManage(actor);
  const [m] = await db.select({ id: member.id }).from(member)
    .where(and(eq(member.id, memberId), isNull(member.anonymizedAt))).limit(1);
  if (!m) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const departmentId = input.departmentId !== undefined ? clean(input.departmentId) : undefined;
  const positionId = input.positionId !== undefined ? clean(input.positionId) : undefined;
  if (departmentId) {
    const [d] = await db.select({ id: department.id }).from(department)
      .where(and(eq(department.id, departmentId), isNull(department.archivedAt))).limit(1);
    if (!d) throw new DomainError("VALIDATION", "部门不存在或已归档", null);
  }
  if (positionId) {
    const [p] = await db.select({ id: position.id }).from(position)
      .where(and(eq(position.id, positionId), isNull(position.archivedAt))).limit(1);
    if (!p) throw new DomainError("VALIDATION", "职位不存在或已归档", null);
  }
  const [row] = await db.update(member).set({
    ...(departmentId !== undefined ? { departmentId } : {}),
    ...(positionId !== undefined ? { positionId } : {}),
    updatedAt: new Date(),
  }).where(eq(member.id, memberId)).returning({ id: member.id, departmentId: member.departmentId, positionId: member.positionId });
  await writeAudit({ actorId: actor.memberId, action: "member.organization_updated", targetType: "MEMBER", targetId: memberId, changes: { departmentId, positionId }, severity: "BUSINESS" });
  return row;
}

// ── 组织模板（公司 / OPC）──────────────────────────────────
export type OrgKind = "COMPANY" | "OPC";

interface DeptTemplate { name: string; children?: DeptTemplate[] }
interface PositionTemplate { name: string; dept?: string }

export function orgTemplate(kind: OrgKind, locale = "zh-CN"): { departments: DeptTemplate[]; positions: PositionTemplate[] } {
  const en = locale.startsWith("en");
  if (kind === "OPC") {
    return en
      ? {
          departments: [{ name: "Business" }, { name: "Delivery" }],
          positions: [{ name: "Founder / Owner" }, { name: "External Collaborator", dept: "Delivery" }],
        }
      : {
          departments: [{ name: "业务部" }, { name: "交付部" }],
          positions: [{ name: "负责人" }, { name: "外部协作", dept: "交付部" }],
        };
  }
  return en
    ? {
        departments: [
          { name: "Engineering", children: [{ name: "Frontend" }, { name: "Backend" }, { name: "QA" }] },
          { name: "Product" },
          { name: "Operations" },
        ],
        positions: [
          { name: "General Manager" }, { name: "Tech Lead", dept: "Engineering" },
          { name: "Frontend Engineer", dept: "Frontend" }, { name: "Backend Engineer", dept: "Backend" },
          { name: "QA Engineer", dept: "QA" }, { name: "Product Manager", dept: "Product" },
          { name: "Operations Specialist", dept: "Operations" },
        ],
      }
    : {
        departments: [
          { name: "研发部", children: [{ name: "前端组" }, { name: "后端组" }, { name: "测试组" }] },
          { name: "产品部" },
          { name: "运营部" },
        ],
        positions: [
          { name: "总经理" }, { name: "技术负责人", dept: "研发部" },
          { name: "前端工程师", dept: "前端组" }, { name: "后端工程师", dept: "后端组" },
          { name: "测试工程师", dept: "测试组" }, { name: "产品经理", dept: "产品部" },
          { name: "运营专员", dept: "运营部" },
        ],
      };
}

/** 安全应用组织模板：只补缺失的部门/职位，不删不改已有结构。 */
export async function applyOrganizationTemplate(actor: Actor, kind: OrgKind) {
  assertManage(actor);
  const locale = (await db.select({ value: sql<string>`value` }).from(sql`setting`).where(sql`key = 'org.defaultLocale'`).limit(1))[0]?.value ?? "zh-CN";
  const template = orgTemplate(kind, locale);
  const existingDepts = await db.select({ id: department.id, name: department.name, parentId: department.parentId }).from(department).where(isNull(department.archivedAt));
  const byNameParent = new Map(existingDepts.map((d) => [`${d.parentId ?? ""}:${d.name}`, d.id]));
  let deptCreated = 0;
  const createdByPath = new Map<string, string>();
  const insertDept = async (d: DeptTemplate, parentId: string | null): Promise<string | null> => {
    const key = `${parentId ?? ""}:${d.name}`;
    let id = byNameParent.get(key) ?? null;
    if (!id) {
      const [row] = await db.insert(department).values({ name: d.name, parentId }).returning({ id: department.id });
      if (!row) return null;
      id = row.id;
      deptCreated += 1;
      byNameParent.set(key, id);
      createdByPath.set(d.name, id);
    }
    // 父部门已存在时也必须继续补齐它的子部门，否则模板只会长一半
    for (const child of d.children ?? []) await insertDept(child, id);
    return id;
  };
  for (const d of template.departments) await insertDept(d, null);

  for (const p of template.positions) {
    const deptId = p.dept ? (createdByPath.get(p.dept) ?? existingDepts.find((d) => d.name === p.dept)?.id ?? null) : null;
    const [existing] = await db.select({ id: position.id, departmentId: position.departmentId })
      .from(position).where(eq(position.name, p.name)).limit(1);
    if (existing) {
      // 旧模板曾创建过岗位但没挂部门：补齐关联，不覆盖管理员后来手工调整过的归属
      if (existing.departmentId === null && deptId) {
        await db.update(position).set({ departmentId: deptId }).where(eq(position.id, existing.id));
      }
      continue;
    }
    await db.insert(position).values({ name: p.name, departmentId: deptId });
  }
  await writeAudit({ actorId: actor.memberId, action: "organization.template_applied", targetType: "ORGANIZATION", targetId: null, changes: { kind }, severity: "BUSINESS" });
  return { ok: true, kind, departmentsCreated: deptCreated, departmentCount: existingDepts.length + deptCreated };
}
