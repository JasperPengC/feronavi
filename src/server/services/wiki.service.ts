/**
 * Wiki 文档（第十二期，规范 6.1–6.3 + REST 9 节）
 *
 * 本文件是**可见性的唯一入口**（规范：页面级 ACL 只用于 RESTRICTED 页）：
 *   可见 = 项目数据范围通过 ∧ ( visibility='PROJECT' ∨ 命中 page_permission 的读授权 )
 * 授权主体三种：MEMBER（本人）· ROLE（我持有的角色 id）· TEAM（我被指派的团队 id）。
 * **任何读取路径（列表、树、详情、版本、搜索、MCP）都必须经 `visiblePageCondition`** ——
 * 否则直链或搜索就会成为越权入口。
 */
import { and, asc, desc, eq, getTableColumns, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { deferAfterCommit } from "../../db/context.ts";
import { page, pagePermission, pageRevision } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { hasAcl, visiblePageCondition } from "./page-access.service.ts";
export { aclPrincipals, hasAcl, visiblePageCondition } from "./page-access.service.ts";
import { businessEffects } from "./business-effects.ts";
import { recordBusinessEvent } from "./event-log.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { assertTreeParent, lockProjectTree } from "./project-tree.ts";
import { assertDocumentLinks } from "../../shared/document-links.ts";
import { pageActive, pageArchived } from "../repos/page-state.ts";

const SLUG_MAX_RETRY = 5;

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
function assertCan(actor: Actor, action: string, projectId: string, res: { createdBy?: string | null } = {}) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, action, { projectId, teamId: null, createdBy: res.createdBy ?? null }, ctx)) throw forbidden();
}
async function assertProjectVisible(actor: Actor, projectId: string) {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}

/**
 * 写权 = **角色权限 ∪ 资源级 ACL**（规范：页 ACL 是额外的资源级授权，不是替代品）。
 * 角色侧：`page:update_any` 任意页；`page:update_own` own 页（Wiki 的"own"= 首版作者）。
 * 资源侧：ACL `can_write`。
 * ⚠️ 早先只判 `page:update_any`，导致"只被 ACL 授写权"的成员实际写不了 —— 资源级授权形同虚设。
 */
export async function assertCanWrite(actor: Actor, pageId: string, projectId: string): Promise<void> {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (can(actor, "page:update_any", { projectId, teamId: null }, ctx)) return;
  const [owner] = await db.select({ createdBy: page.createdBy }).from(page).where(eq(page.id, pageId)).limit(1);
  const first = owner?.createdBy ? null : (await db.select({ authorId: pageRevision.authorId }).from(pageRevision)
    .where(and(eq(pageRevision.pageId, pageId), eq(pageRevision.revisionNo, 1))).limit(1))[0];
  if (can(actor, "page:update_own", { projectId, teamId: null, createdBy: owner?.createdBy ?? first?.authorId ?? null }, ctx)) return;
  if (await hasAcl(actor, pageId, "write")) return;
  throw forbidden();
}

function slugify(title: string): string {
  const base = title.trim().toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "page";
}

// ── 读取 ────────────────────────────────────────────────────

/** 文档树/列表：**不含正文**（规范：list 不含正文，get 才含） */
export async function listPages(actor: Actor, projectId: string, options: { archived?: boolean; q?: string } = {}) {
  await assertProjectVisible(actor, projectId);
  const visible = await visiblePageCondition(actor);
  const rows = await db.select({
    id: page.id, title: page.title, slug: page.slug, parentId: page.parentId,
    visibility: page.visibility, sortOrder: page.sortOrder,
    currentRevisionId: page.currentRevisionId, updatedAt: page.updatedAt,
    kind: page.kind, structureVersion: page.structureVersion, archivedAt: page.archivedAt, isArchived: pageArchived(),
  }).from(page)
    .where(and(eq(page.projectId, projectId), isNull(page.deletedAt), visible,
      options.archived ? pageArchived() : pageActive(), options.q ? ilike(page.title, `%${options.q}%`) : undefined))
    .orderBy(asc(page.sortOrder), asc(page.title));
  const visibleIds = new Set(rows.map(row => row.id));
  return rows.map(row => ({ ...row, parentId: row.parentId && visibleIds.has(row.parentId) ? row.parentId : null }));
}

export async function getPage(actor: Actor, id: string) {
  const rows = await db.select({ ...getTableColumns(page), isArchived: pageArchived() }).from(page)
    .where(and(eq(page.id, id), isNull(page.deletedAt))).limit(1);
  const p = rows[0];
  if (!p) throw forbidden();                       // 不可见与不存在同形
  // ⚠️ **项目数据范围优先**：页 ACL 是受限页的**附加**过滤，不能成为跨项目越权的通道。
  //    实测踩到：只套 ACL（不套项目范围）时，项目外成员只要被授一条 ACL 就能读正文。
  await assertProjectVisible(actor, p.projectId);
  if (p.visibility === "RESTRICTED" && !(await hasAcl(actor, id, "read"))) throw forbidden();
  const rev = p.currentRevisionId
    ? (await db.select().from(pageRevision).where(eq(pageRevision.id, p.currentRevisionId)).limit(1))[0]
    : null;
  return { ...p, content: rev?.content ?? "", revisionNo: rev?.revisionNo ?? 0, changeSummary: rev?.changeSummary ?? null };
}

/** 幂等响应重放也必须重新验证当前项目可见性和页面写权。 */
export async function assertPageWritable(actor: Actor, pageId: string, projectId?: string) {
  const current = await getPage(actor, pageId);
  if (projectId && current.projectId !== projectId) throw forbidden();
  await assertProjectVisible(actor, current.projectId);
  await assertCanWrite(actor, pageId, current.projectId);
  if (current.isArchived) throw forbidden();
  if (current.kind === "FOLDER") throw new DomainError("VALIDATION", "文件夹没有正文，请使用目录整理操作", null);
  return current;
}

/** 关键字检索：**必须套可见性条件**，否则受限页会从搜索泄露 */
export async function searchPages(actor: Actor, projectId: string, q: string) {
  return listPages(actor, projectId, { q });
}

// ── 写入 ────────────────────────────────────────────────────

/** slug 冲突自动追加 -2 / -3…（规范：不得把唯一冲突直接抛给用户） */
export async function allocateSlug(projectId: string, title: string, excludeId?: string): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i <= SLUG_MAX_RETRY; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await db.select({ id: page.id }).from(page)
      .where(and(eq(page.projectId, projectId), eq(page.slug, candidate))).limit(1);
    if (!hit[0] || hit[0].id === excludeId) return candidate;
  }
  throw new DomainError("CONFLICT", "同名文档过多，请换一个标题", null);
}

/** 重放建页结果前重新验证项目、受限页权限以及父页可见性和归属。 */
export async function assertPageCreatable(actor: Actor, projectId: string, input: { parentId?: string | null; visibility?: "PROJECT" | "RESTRICTED" }) {
  await assertProjectVisible(actor, projectId);
  assertCan(actor, "page:create", projectId);
  if (input.visibility === "RESTRICTED") assertCan(actor, "page:manage_visibility", projectId);
  if (input.parentId) {
    await assertTreeParent("page", projectId, input.parentId);
    const parent = await getPage(actor, input.parentId);
    if (parent.isArchived) throw new DomainError("VALIDATION", "不能在已归档目录内创建文档", null);
  }
}

/** 建页：**同一事务内**建首版 revision + 回填 current_revision_id + 同步 search_vector */
export async function createPage(actor: Actor, projectId: string, input: Parameters<typeof createPageLocked>[2]) {
  return db.transaction(async () => {
    await lockProjectTree(projectId);
    return createPageLocked(actor, projectId, input);
  });
}

async function createPageLocked(actor: Actor, projectId: string, input: {
  title: string; content?: string; parentId?: string | null; visibility?: "PROJECT" | "RESTRICTED"; sortOrder?: number;
  kind?: "DOCUMENT" | "FOLDER";
}) {
  await assertPageCreatable(actor, projectId, input);
  assertDocumentLinks(input.content ?? "");
  if (input.kind === "FOLDER" && input.content) throw new DomainError("VALIDATION", "文件夹不能包含正文", null);
  const visibility = input.visibility ?? "PROJECT";
  const slug = await allocateSlug(projectId, input.title);

  const createdPage = await db.transaction(async (tx) => {
    const [p] = await tx.insert(page).values({
      projectId, title: input.title, slug, parentId: input.parentId ?? null,
      visibility, sortOrder: input.sortOrder ?? 0,
      kind: input.kind ?? "DOCUMENT", createdBy: actor.memberId,
    }).returning();
    const [rev] = input.kind === "FOLDER" ? [] : await tx.insert(pageRevision).values({
      pageId: p!.id, revisionNo: 1, content: input.content ?? "", changeSummary: "创建", authorId: actor.memberId,
    }).returning();
    /**
     * ⚠️ 受限页必须**同事务给创建者授读写**：否则创建者自己也过不了可见性判定
     * （ACL 里没有他 → getPage 直接拒绝），连后续设置 ACL 的入口都打不开 ——
     * 实测踩到：受限页建完，管理员立刻被自己的可见性规则挡在门外。
     */
    if (visibility === "RESTRICTED") {
      await tx.insert(pagePermission).values({
        pageId: p!.id, principalType: "MEMBER", principalId: actor.memberId, canRead: true, canWrite: true,
      });
    }
    // 派生列与内容同事务更新（规范明示）
    if (rev) {
      await tx.update(page).set({ currentRevisionId: rev.id, updatedAt: new Date() }).where(eq(page.id, p!.id));
      await syncSearchVector(tx, p!.id, input.title, input.content ?? "");
    }
    return { ...p!, currentRevisionId: rev?.id ?? null, revisionNo: rev ? 1 : 0 };
  });
  await recordBusinessEvent({
    actor, action: "wiki.created", targetType: "PAGE", targetId: createdPage.id, projectId,
    summary: `${actor.name} 创建了文档「${createdPage.title}」`,
  });
  if (createdPage.currentRevisionId && input.content?.trim()) {
    const revisionId = createdPage.currentRevisionId;
    const complete = () => businessEffects().finishPagePublication(actor, { pageId: createdPage.id, revisionId });
    if (!deferAfterCommit(complete)) await complete();
  }
  return createdPage;
}

/** search_vector 同步（与保存 revision 同事务；回滚历史版本时同样要重算） */
/** 只依赖 execute 的最小结构类型：db 与事务句柄都能传进来（drizzle 的完整类型在事务上是不同别名） */
type Executor = { execute: (q: SQL) => Promise<unknown> };

export async function syncSearchVector(tx: Executor, pageId: string, title: string, content: string): Promise<void> {
  await tx.execute(sql`
    update page set search_vector = to_tsvector('chinese_zh', ${title + "\n" + content})
    where id = ${pageId}
  `);
}

/** 改页：**乐观锁**（以 currentRevisionId 作为期望值做 CAS；表定义里没有 version 列，不擅自加） */
export async function updatePage(actor: Actor, id: string, input: Parameters<typeof updatePageLocked>[2], options: { collaborationPublish?: boolean } = {}) {
  const current = await getPage(actor, id);
  return db.transaction(async () => {
    await lockProjectTree(current.projectId);
    return updatePageLocked(actor, id, input, options);
  });
}

async function updatePageLocked(actor: Actor, id: string, input: {
  title?: string; content?: string; parentId?: string | null; sortOrder?: number;
  visibility?: "PROJECT" | "RESTRICTED"; changeSummary?: string | null; expectedRevisionId?: string; expectedStructureVersion?: number;
}, options: { collaborationPublish?: boolean }) {
  const current = await getPage(actor, id);              // 内含可见性校验
  await assertPageWritable(actor, id, current.projectId);
  if (input.expectedStructureVersion !== undefined && current.structureVersion !== input.expectedStructureVersion) {
    throw new DomainError("VERSION_CONFLICT", "目录或标题已被修改，请刷新后重试；正文草稿已保留", { expected: input.expectedStructureVersion, actual: current.structureVersion });
  }
  if (input.visibility && input.visibility !== current.visibility) {
    assertCan(actor, "page:manage_visibility", current.projectId);
  }
  if (input.expectedRevisionId && current.currentRevisionId !== input.expectedRevisionId) {
    throw new DomainError("VERSION_CONFLICT", "该文档已被他人修改，请刷新后重试", {
      expected: input.expectedRevisionId, actual: current.currentRevisionId,
    });
  }
  if (input.parentId) {
    await assertTreeParent("page", current.projectId, input.parentId, id);
    const parent = await getPage(actor, input.parentId);
    if (parent.isArchived) throw new DomainError("VALIDATION", "不能移动到已归档目录", null);
  }
  const title = input.title ?? current.title;
  const content = input.content ?? current.content;
  // 元数据调整不改旧正文；新正文及协同发布必须通过同一检查。
  if (input.content !== undefined) assertDocumentLinks(content);

  const updatedPage = await db.transaction(async (tx) => {
    const slug = input.title && input.title !== current.title
      ? await allocateSlug(current.projectId, title, id)
      : current.slug;
    const [rev] = await tx.insert(pageRevision).values({
      pageId: id, revisionNo: current.revisionNo + 1, content,
      changeSummary: input.changeSummary ?? null, authorId: actor.memberId,
    }).returning();
    const [updated] = await tx.update(page).set({
      title, slug,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      currentRevisionId: rev!.id, updatedAt: new Date(),
      ...((input.title !== undefined || input.parentId !== undefined || input.sortOrder !== undefined) ? { structureVersion: sql`${page.structureVersion} + 1` } : {}),
    }).where(eq(page.id, id)).returning();
    await syncSearchVector(tx, id, title, content);
    return { ...updated!, revisionNo: rev!.revisionNo };
  });
  const documents = businessEffects();
  const room = await documents.synchronizePublishedPage(actor, { pageId: id, projectId: current.projectId, revisionId: updatedPage.currentRevisionId!, content: input.content });
  await recordBusinessEvent({ actor, action: "wiki.updated", targetType: "PAGE", targetId: id, projectId: current.projectId,
    summary: `${actor.name} 更新了文档「${title}」` });
  if (!options.collaborationPublish) {
    const complete = () => documents.finishPagePublication(actor, { pageId: id, revisionId: updatedPage.currentRevisionId!, ...(room ?? {}) });
    if (!deferAfterCommit(complete)) await complete();
  }
  return updatedPage;
}

/** 软删：**必须改写 slug**（唯一约束不含 deleted_at，否则同名重建会撞键） */
export async function deletePage(actor: Actor, id: string): Promise<void> {
  const current = await getPage(actor, id);
  return db.transaction(async () => {
    await lockProjectTree(current.projectId);
    await deletePageLocked(actor, id);
  });
}

async function deletePageLocked(actor: Actor, id: string): Promise<void> {
  const current = await getPage(actor, id);
  await assertCanWrite(actor, id, current.projectId);
  const [child] = await db.select({ id: page.id }).from(page).where(and(eq(page.parentId, id), isNull(page.deletedAt))).limit(1);
  if (child) throw new DomainError("VALIDATION", "目录中仍有内容，请先移动内容或归档整个目录", null);
  await db.update(page).set({
    deletedAt: new Date(),
    slug: `${current.slug}--deleted-${Date.now()}`,
    updatedAt: new Date(),
  }).where(eq(page.id, id));
  await recordBusinessEvent({
    actor, action: "wiki.deleted", targetType: "PAGE", targetId: id, projectId: current.projectId,
    summary: `${actor.name} 删除了文档「${current.title}」`,
  });
  {
    const { cleanupLinksFor } = await import("../repos/content-link.repo.ts");
    await cleanupLinksFor("PAGE", id);
  }
}

// ── 版本历史 ────────────────────────────────────────────────

export async function listRevisions(actor: Actor, pageId: string) {
  await getPage(actor, pageId);
  return db.select({
    id: pageRevision.id, revisionNo: pageRevision.revisionNo, changeSummary: pageRevision.changeSummary,
    authorId: pageRevision.authorId, createdAt: pageRevision.createdAt,
  }).from(pageRevision).where(eq(pageRevision.pageId, pageId)).orderBy(desc(pageRevision.revisionNo)).limit(100);
}

/** 回滚到历史版本：**append-only** —— 把旧内容写成新 revision，不删旧版 */
export async function getRevision(actor: Actor, pageId: string, revisionId: string) {
  await getPage(actor, pageId);
  const [revision] = await db.select().from(pageRevision).where(and(eq(pageRevision.pageId, pageId), eq(pageRevision.id, revisionId))).limit(1);
  if (!revision) throw new DomainError("NOT_FOUND", "版本不存在", null);
  return revision;
}

export async function restoreRevision(actor: Actor, pageId: string, revisionId: string, expectedRevisionId?: string) {
  const current = await getPage(actor, pageId);
  return db.transaction(async () => {
    await lockProjectTree(current.projectId);
    return restoreRevisionLocked(actor, pageId, revisionId, expectedRevisionId);
  });
}

async function restoreRevisionLocked(actor: Actor, pageId: string, revisionId: string, expectedRevisionId?: string) {
  const current = await getPage(actor, pageId);
  await assertPageWritable(actor, pageId, current.projectId);
  if (expectedRevisionId && current.currentRevisionId !== expectedRevisionId) throw new DomainError("VERSION_CONFLICT", "该文档已被他人修改，请刷新后重试", { expected: expectedRevisionId, actual: current.currentRevisionId });
  const target = (await db.select().from(pageRevision)
    .where(and(eq(pageRevision.id, revisionId), eq(pageRevision.pageId, pageId))).limit(1))[0];
  if (!target) throw new DomainError("NOT_FOUND", "版本不存在", null);

  const restored = await db.transaction(async (tx) => {
    const [rev] = await tx.insert(pageRevision).values({
      pageId, revisionNo: current.revisionNo + 1, content: target.content,
      changeSummary: `回滚到第 ${target.revisionNo} 版`, authorId: actor.memberId,
    }).returning();
    await tx.update(page).set({ currentRevisionId: rev!.id, updatedAt: new Date() }).where(eq(page.id, pageId));
    // 回滚后**必须重算** search_vector（规范：否则检索结果与显示内容不符）
    await syncSearchVector(tx, pageId, current.title, target.content);
    return { ...rev!, revisionNo: rev!.revisionNo };
  });
  const documents = businessEffects();
  const room = await documents.synchronizePublishedPage(actor, { pageId, projectId: current.projectId, revisionId: restored.id, content: target.content });
  await recordBusinessEvent({ actor, action: "wiki.restored", targetType: "PAGE", targetId: pageId, projectId: current.projectId,
    summary: `${actor.name} 将文档「${current.title}」恢复到第 ${target.revisionNo} 版` });
  const complete = () => documents.finishPagePublication(actor, { pageId, revisionId: restored.id, ...(room ?? {}) });
  if (!deferAfterCommit(complete)) await complete();
  return restored;
}

// ── 页面级 ACL ──────────────────────────────────────────────

/**
 * 取页面**原始行**（只校验项目数据范围，**不套可见性 ACL**）——
 * 仅供 ACL 管理使用：ACL 是行政动作，走角色权限 `page:manage_permission`。
 * ⚠️ 若这里也套可见性，一旦有人把 ACL 覆盖成不含自己的列表，
 *    管理员就再也进不来修 ACL 了（页面直接变成谁都读不了的孤儿）——实测踩到。
 */
async function loadPageForAdmin(actor: Actor, pageId: string) {
  const p = (await db.select().from(page).where(and(eq(page.id, pageId), isNull(page.deletedAt))).limit(1))[0];
  if (!p) throw new DomainError("NOT_FOUND", "页面不存在", null);
  await assertProjectVisible(actor, p.projectId);
  assertCan(actor, "page:manage_permission", p.projectId);
  return p;
}

export async function listPermissions(actor: Actor, pageId: string) {
  await loadPageForAdmin(actor, pageId);
  return db.select().from(pagePermission).where(eq(pagePermission.pageId, pageId));
}

/** 设 ACL：**仅 RESTRICTED 页有意义**，规范明示 */
export async function setPermissions(actor: Actor, pageId: string, perms: {
  principalType: "MEMBER" | "TEAM" | "ROLE"; principalId: string; canRead: boolean; canWrite: boolean;
}[]) {
  const current = await loadPageForAdmin(actor, pageId);
  if (current.visibility !== "RESTRICTED") {
    throw new DomainError("VALIDATION", "只有受限（RESTRICTED）页面才需要页面级授权", null);
  }
  // 防孤儿：受限页若没有任何可读主体，就再也没人能读到它（只能靠管理员改 ACL 救回）
  if (!perms.some((p) => p.canRead)) {
    throw new DomainError("VALIDATION", "受限页必须至少保留一个可读主体，否则页面将无人可读", null);
  }
  return db.transaction(async (tx) => {
    // 替换集合前先串行化同项目页面写入；仅锁旧ACL行会漏掉并发插入的新授权。
    await lockProjectTree(current.projectId);
    const latest = await loadPageForAdmin(actor, pageId);
    if (latest.visibility !== "RESTRICTED") throw new DomainError("VALIDATION", "只有受限页面才能设置授权", null);
    await tx.delete(pagePermission).where(eq(pagePermission.pageId, pageId));
    await tx.insert(pagePermission).values(perms.map((p) => ({ pageId, ...p })));
    await recordBusinessEvent({ actor, action: "wiki.permissions_updated", targetType: "PAGE", targetId: pageId,
      projectId: latest.projectId, summary: `${actor.name} 更新了文档访问权限` });
    return tx.select().from(pagePermission).where(eq(pagePermission.pageId, pageId));
  });
}
