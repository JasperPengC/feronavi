import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { product, productProject, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import { createProductSchema, linkProductSchema, productVersionSchema, updateProductSchema, type ProductSummary } from "../../shared/schemas/product.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import * as projects from "../repos/project.repo.ts";
import { lockProjectTree } from "./project-tree.ts";
import { recordBusinessEvent } from "./event-log.ts";

type Scope = readonly string[] | undefined;
type Product = typeof product.$inferSelect;
const ctx = (actor: Actor) => ({ memberId: actor.memberId, memberProjectIds: new Set<string>(), memberTeamIds: new Set<string>() });
const inScope = (scope: Scope, id: string) => !scope?.length || scope.includes(id);
const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const result = schema.safeParse(raw);
  if (!result.success) throw new DomainError("VALIDATION", "产品参数不合法", result.error.issues);
  return result.data;
};
async function assertVisible(actor: Actor, id: string, scope?: Scope) {
  if (!inScope(scope, id) || !await projects.findById(id) || !await projects.isVisibleTo(actor.memberId, id, actor.grants.some(g => g.scopeType === "ORG"))) throw forbidden();
}
export async function assertProductCreatable(actor: Actor, id: string, scope?: Scope) {
  await assertVisible(actor, id, scope);
  if (!can(actor, "project:update", { projectId: id }, ctx(actor))) throw forbidden();
  const p = await projects.findById(id);
  if (p?.lifecycleLock || p?.archivedAt) throw new DomainError("CONFLICT", "关联项目已锁定或归档，不能修改共享产品", null);
}

/** 与归属变更共用，调用方须在事务内、项目锁之前调用。 */
export async function lockProducts(ids: (string | null | undefined)[]) {
  for (const id of [...new Set(ids.filter((id): id is string => !!id))].sort()) {
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'product:'+id}, 0))`);
  }
}
async function linkedProjects(id: string) {
  return db.select({ id: productProject.projectId }).from(productProject).where(eq(productProject.productId, id)).orderBy(asc(productProject.projectId));
}
async function assertManage(actor: Actor, id: string, scope?: Scope) {
  const links = await linkedProjects(id);
  if (!links.length) throw forbidden();
  for (const link of links) await assertProductCreatable(actor, link.id, scope);
  return links;
}
async function find(actor: Actor, projectId: string, id: string, scope?: Scope) {
  await assertVisible(actor, projectId, scope);
  const [row] = await db.select({ product }).from(product).innerJoin(productProject, eq(productProject.productId, product.id))
    .where(and(eq(product.id, id), eq(productProject.projectId, projectId))).limit(1);
  if (!row) throw forbidden();
  return row.product;
}
async function summary(actor: Actor, projectId: string, row: Product, scope?: Scope): Promise<ProductSummary> {
  let canManage = true;
  let linkedCount = 0;
  try { linkedCount = (await assertManage(actor, row.id, scope)).length; } catch (error) {
    if (!(error instanceof DomainError) || !["FORBIDDEN", "CONFLICT"].includes(error.code)) throw error;
    canManage = false;
  }
  const [count] = await db.select({ n: sql<number>`count(*) filter (where ${workItem.deletedAt} is null)::int`, total: sql<number>`count(*)::int` }).from(workItem)
    .where(and(eq(workItem.projectId, projectId), eq(workItem.productId, row.id)));
  return { id: row.id, name: row.name, description: row.description, version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), canManage,
    canUnlink: canManage && linkedCount > 1 && count?.total === 0, requirementCount: count?.n ?? 0 };
}
export async function listProducts(actor: Actor, projectId: string, includeArchived = false, scope?: Scope) {
  await assertVisible(actor, projectId, scope);
  const rows = await db.select({ product }).from(product).innerJoin(productProject, eq(productProject.productId, product.id))
    .where(and(eq(productProject.projectId, projectId), includeArchived ? undefined : isNull(product.archivedAt))).orderBy(asc(product.name), asc(product.id));
  return Promise.all(rows.map(row => summary(actor, projectId, row.product, scope)));
}
export async function getProduct(actor: Actor, projectId: string, id: string, scope?: Scope) {
  return summary(actor, projectId, await find(actor, projectId, id, scope), scope);
}
export async function createProduct(actor: Actor, projectId: string, raw: unknown, scope?: Scope) {
  const input = parse(createProductSchema, raw);
  return db.transaction(async () => {
    await lockProjectTree(projectId);
    await assertProductCreatable(actor, projectId, scope);
    const [row] = await db.insert(product).values({ ...input, createdBy: actor.memberId }).returning();
    await db.insert(productProject).values({ productId: row!.id, projectId });
    await recordBusinessEvent({ actor, action: "product.created", targetType: "PRODUCT", targetId: row!.id, projectId, summary: `${actor.name} 创建了产品「${row!.name}」` });
    return getProduct(actor, projectId, row!.id, scope);
  });
}
function checkVersion(row: Product, expected: number) {
  if (row.version !== expected) throw new DomainError("VERSION_CONFLICT", "产品已被修改，请刷新后重试", null);
}
async function lockManagedProjects(actor: Actor, id: string, scope?: Scope, targetId?: string) {
  const links = await linkedProjects(id);
  for (const pid of [...new Set([...links.map(link => link.id), ...(targetId ? [targetId] : [])])].sort()) {
    await lockProjectTree(pid); await assertProductCreatable(actor, pid, scope);
  }
  return links;
}
export async function updateProduct(actor: Actor, projectId: string, id: string, raw: unknown, scope?: Scope) {
  const input = parse(updateProductSchema, raw);
  return db.transaction(async () => {
    await lockProducts([id]);
    const row = await find(actor, projectId, id, scope);
    await lockManagedProjects(actor, id, scope);
    checkVersion(row, input.expectedVersion);
    if (row.archivedAt && input.archived !== false) throw new DomainError("VALIDATION", "请先恢复产品再编辑", null);
    await db.update(product).set({ ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}), version: row.version + 1, updatedAt: new Date() }).where(eq(product.id, id));
    await recordBusinessEvent({ actor, action: "product.updated", targetType: "PRODUCT", targetId: id, projectId,
      summary: `${actor.name} ${input.archived === true ? "归档" : input.archived === false ? "恢复" : "更新"}了产品「${input.name ?? row.name}」` });
    return getProduct(actor, projectId, id, scope);
  });
}
export async function linkProductProject(actor: Actor, projectId: string, id: string, raw: unknown, scope?: Scope) {
  const input = parse(linkProductSchema, raw);
  return db.transaction(async () => {
    await lockProducts([id]);
    const row = await find(actor, projectId, id, scope);
    const links = await lockManagedProjects(actor, id, scope, input.targetProjectId);
    checkVersion(row, input.expectedVersion);
    if (row.archivedAt) throw new DomainError("VALIDATION", "已归档产品不能关联新项目", null);
    if (!links.some(link => link.id === input.targetProjectId)) {
      await db.insert(productProject).values({ productId: id, projectId: input.targetProjectId });
      await db.update(product).set({ version: row.version + 1, updatedAt: new Date() }).where(eq(product.id, id));
      await recordBusinessEvent({ actor, action: "product.project_linked", targetType: "PRODUCT", targetId: id, projectId: input.targetProjectId, summary: `${actor.name} 关联了产品「${row.name}」` });
    }
    return getProduct(actor, projectId, id, scope);
  });
}
export async function unlinkProductProject(actor: Actor, projectId: string, id: string, raw: unknown, scope?: Scope) {
  const input = parse(productVersionSchema, raw);
  return db.transaction(async () => {
    await lockProducts([id]);
    const row = await find(actor, projectId, id, scope);
    const links = await lockManagedProjects(actor, id, scope);
    checkVersion(row, input.expectedVersion);
    if (links.length <= 1) throw new DomainError("BLOCKED_BY_PREREQUISITE", "产品至少保留一个关联项目，可归档产品", null);
    const [reference] = await db.select({ id: workItem.id }).from(workItem).where(and(eq(workItem.productId, id), eq(workItem.projectId, projectId))).limit(1);
    if (reference) throw new DomainError("BLOCKED_BY_PREREQUISITE", "项目仍有需求引用该产品，请先调整归属", null);
    await db.delete(productProject).where(and(eq(productProject.productId, id), eq(productProject.projectId, projectId)));
    await db.update(product).set({ version: row.version + 1, updatedAt: new Date() }).where(eq(product.id, id));
    await recordBusinessEvent({ actor, action: "product.project_unlinked", targetType: "PRODUCT", targetId: id, projectId, summary: `${actor.name} 解除了产品「${row.name}」的项目关联` });
    return { ok: true, version: row.version + 1 };
  });
}

/** 调用方已持有产品和项目锁；关联不授予跨项目读取权限。 */
export async function assertRequirementProduct(actor: Actor, projectId: string, type: string, productId: string | null | undefined, previousId?: string | null) {
  if (!productId) return;
  if (type !== "REQUIREMENT") throw new DomainError("VALIDATION", "只有需求能设置产品归属", null);
  const row = await find(actor, projectId, productId);
  if (row.archivedAt && previousId !== productId) throw new DomainError("VALIDATION", "不能关联已归档产品", null);
}
