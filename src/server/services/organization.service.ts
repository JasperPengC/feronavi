/**
 * 组织信息（REST 第 3 节：GET/PATCH /organization；PATCH 需 org:manage）
 *
 * 组织是单行表（向导第 4 步创建）。这里把「读取」与「管理员修改」收进一个服务：
 * name / logoUrl / defaultLocale / defaultTimezone 全部是实例级默认值。
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { organization } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { writeSecurityAudit } from "./audit.service.ts";

export interface OrganizationView {
  id: string; name: string; logoUrl: string | null;
  defaultLocale: string; defaultTimezone: string;
  createdAt: string | null; updatedAt: string | null;
}

export async function getOrganization(): Promise<OrganizationView> {
  const row = (await db.select().from(organization).limit(1))[0];
  if (!row) {
    return {
      id: "", name: "Feronavi", logoUrl: null,
      defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai",
      createdAt: null, updatedAt: null,
    };
  }
  return {
    id: row.id, name: row.name, logoUrl: row.logoUrl,
    defaultLocale: row.defaultLocale, defaultTimezone: row.defaultTimezone,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function assertOrgManage(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "org:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

function validTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export async function updateOrganization(actor: Actor, patch: {
  name?: string; logoUrl?: string | null; defaultLocale?: string; defaultTimezone?: string;
}) {
  assertOrgManage(actor);
  const row = (await db.select().from(organization).limit(1))[0];
  if (!row) throw new DomainError("CONFLICT", "组织尚未初始化", null);
  const name = patch.name !== undefined ? patch.name.trim() : row.name;
  if (!name) throw new DomainError("VALIDATION", "组织名称不能为空", null);
  if (patch.defaultLocale !== undefined && !["zh-CN", "en-US"].includes(patch.defaultLocale)) {
    throw new DomainError("VALIDATION", "默认语言只支持 zh-CN / en-US", null);
  }
  if (patch.defaultTimezone !== undefined && !validTimezone(patch.defaultTimezone)) {
    throw new DomainError("VALIDATION", "时区不是合法的 IANA 时区", null);
  }
  let logoUrl = patch.logoUrl !== undefined ? patch.logoUrl : row.logoUrl;
  if (logoUrl !== null && logoUrl !== "") {
    try { new URL(logoUrl); } catch { throw new DomainError("VALIDATION", "Logo 必须是合法 URL", null); }
  }
  if (logoUrl === "") logoUrl = null;
  const [updated] = await db.update(organization).set({
    name,
    ...(patch.logoUrl !== undefined ? { logoUrl: logoUrl ?? null } : {}),
    ...(patch.defaultLocale !== undefined ? { defaultLocale: patch.defaultLocale } : {}),
    ...(patch.defaultTimezone !== undefined ? { defaultTimezone: patch.defaultTimezone } : {}),
    updatedAt: new Date(),
  }).where(eq(organization.id, row.id)).returning();
  await writeSecurityAudit({
    actorId: actor.memberId, action: "organization.updated", targetType: "ORGANIZATION", targetId: updated!.id,
  });
  return {
    id: updated!.id, name: updated!.name, logoUrl: updated!.logoUrl,
    defaultLocale: updated!.defaultLocale, defaultTimezone: updated!.defaultTimezone,
    createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString(),
  };
}
