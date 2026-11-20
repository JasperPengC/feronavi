/**
 * 外部集成（规范 8.3 / REST 11 节）
 *
 * 三条纪律（与 webhook 同源，不能各自发明）：
 *   1 `base_url` 是**用户可控的出站 URL**：创建与修改都必须过 `lib/url-safety.ts`（C-17/C-27），
 *      因为请求会带着 `token_encrypted` 里的凭据出行；
 *   2 访问令牌走**信封加密**（与 SMTP 密码同一套），列表/详情**永不回显**，只给 hasToken；
 *   3 增删改都写 **SECURITY 审计**（不含令牌明文），便于回答"谁把集成指向了哪里"。
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { integration } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { assertSafeOutboundUrl } from "../lib/url-safety.ts";
import { encryptSecret } from "./crypto.service.ts";

export const INTEGRATION_KINDS = ["GITLAB", "GITHUB", "GITEE"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
function assertManage(actor: Actor, projectId: string | null) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "integration:manage", { projectId, teamId: null }, ctx)) throw forbidden();
}
async function assertProjectVisible(actor: Actor, projectId: string | null) {
  if (!projectId) return;
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}

/** 对外视图：**不含 token**（连密文也不返回），只告诉界面"有没有配令牌" */
export interface IntegrationView {
  id: string; kind: string; projectId: string | null; name: string; baseUrl: string;
  config: unknown; isActive: boolean; hasToken: true;
  createdAt: Date; updatedAt: Date;
}
function toView(row: typeof integration.$inferSelect): IntegrationView {
  return {
    id: row.id, kind: row.kind, projectId: row.projectId, name: row.name, baseUrl: row.baseUrl,
    config: row.config, isActive: row.isActive, hasToken: true,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

/** 应用层重复校验：DB 唯一索引对 project_id IS NULL 不生效（PG 的 NULL 不参与唯一比较） */
async function assertNoDuplicate(kind: string, projectId: string | null, baseUrl: string, repo: string, excludeId?: string) {
  const rows = await db.select({ id: integration.id, config: integration.config }).from(integration).where(and(
    eq(integration.kind, kind),
    projectId ? eq(integration.projectId, projectId) : isNull(integration.projectId),
    eq(integration.baseUrl, baseUrl),
  ));
  const dup = rows.find((r) => r.id !== excludeId && String((r as { config?: Record<string, unknown> }).config?.repo ?? "") === repo);
  if (dup) throw new DomainError("VALIDATION", "同一范围、同一服务、同一仓库已存在集成", null);
}

function assertKind(kind: string): void {
  if (!(INTEGRATION_KINDS as readonly string[]).includes(kind)) {
    throw new DomainError("VALIDATION", `kind 只支持 ${INTEGRATION_KINDS.join(" / ")}`, null);
  }
}

export async function listIntegrations(actor: Actor, projectId?: string): Promise<IntegrationView[]> {
  assertManage(actor, projectId ?? null);
  if (projectId) await assertProjectVisible(actor, projectId);
  const rows = await db.select().from(integration)
    .where(projectId ? eq(integration.projectId, projectId) : undefined)
    .orderBy(desc(integration.createdAt));
  return rows.map(toView);
}

export async function createIntegration(actor: Actor, input: {
  kind: string; name: string; baseUrl: string; token: string;
  projectId?: string | null; config?: Record<string, unknown>; isActive?: boolean;
}): Promise<IntegrationView> {
  const projectId = input.projectId ?? null;
  await assertProjectVisible(actor, projectId);
  assertManage(actor, projectId);
  assertKind(input.kind);
  await assertSafeOutboundUrl(input.baseUrl);
  await assertNoDuplicate(input.kind, projectId, input.baseUrl, String((input.config as { repo?: unknown } | undefined)?.repo ?? ""));

  const [row] = await db.insert(integration).values({
    kind: input.kind, projectId, name: input.name, baseUrl: input.baseUrl,
    tokenEncrypted: encryptSecret(input.token),
    config: (input.config ?? {}) as object,
    isActive: input.isActive ?? true,
  }).returning();
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "integration.created", targetType: "INTEGRATION", targetId: row!.id,
    });
  }
  return toView(row!);
}

export async function updateIntegration(actor: Actor, id: string, patch: {
  name?: string; baseUrl?: string; token?: string;
  projectId?: string | null; config?: Record<string, unknown>; isActive?: boolean;
}): Promise<IntegrationView> {
  const row = (await db.select().from(integration).where(eq(integration.id, id)).limit(1))[0];
  if (!row) throw forbidden();
  // 修改目标前必须仍可管理原范围，不能借换项目绕过原项目授权。
  await assertProjectVisible(actor, row.projectId);
  assertManage(actor, row.projectId);
  const projectId = patch.projectId !== undefined ? patch.projectId : row.projectId;
  await assertProjectVisible(actor, projectId);
  assertManage(actor, projectId);
  if (patch.baseUrl !== undefined && patch.baseUrl !== row.baseUrl) await assertSafeOutboundUrl(patch.baseUrl);
  const normalizedUrl = (value: string) => new URL(value).toString().replace(/\/+$/u, "");
  const destinationChanged = patch.baseUrl !== undefined && normalizedUrl(patch.baseUrl) !== normalizedUrl(row.baseUrl);
  if ((destinationChanged || projectId !== row.projectId) && !patch.token?.trim()) {
    throw new DomainError("VALIDATION", "更换服务地址或项目时请重新提供对应的访问令牌", null);
  }
  if (patch.baseUrl !== undefined || patch.projectId !== undefined || patch.config !== undefined) {
    await assertNoDuplicate(row.kind, projectId, patch.baseUrl ?? row.baseUrl,
      String((patch.config ?? row.config as Record<string, unknown>)?.repo ?? ""), id);
  }

  const [updated] = await db.update(integration).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
    ...(patch.token !== undefined ? { tokenEncrypted: encryptSecret(patch.token) } : {}),
    ...(patch.projectId !== undefined ? { projectId } : {}),
    ...(patch.config !== undefined ? { config: patch.config as object } : {}),
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    updatedAt: new Date(),
  }).where(eq(integration.id, id)).returning();
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "integration.updated", targetType: "INTEGRATION", targetId: id,
    });
  }
  return toView(updated!);
}

export async function deleteIntegration(actor: Actor, id: string): Promise<void> {
  const row = (await db.select().from(integration).where(eq(integration.id, id)).limit(1))[0];
  if (!row) throw forbidden();
  await assertProjectVisible(actor, row.projectId);
  assertManage(actor, row.projectId);
  await db.delete(integration).where(eq(integration.id, id));
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "integration.deleted", targetType: "INTEGRATION", targetId: id,
    });
  }
}
