/**
 * MCP 客户端与工具级策略（规范 9 节 / REST 11 节）
 *
 * 纪律：
 *   1 `mcp_client` 一令牌一客户端（token_id UNIQUE）：客户端首次 initialize 记名字/版本，
 *      每次工具调用累加 call_count + last_seen_at；
 *   2 `mcp_tool_policy` 主键 (token_id, tool_name)，**DENY 优先于令牌档位**（A39 三重交集）——
 *      档位允许但策略 DENY 时仍拒绝；
 *   3 策略替换是**整体替换**（同一事务：删旧插新），避免"漏删一条旧策略"导致权限残留；
 *   4 写策略落 SECURITY 审计。
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { apiToken, mcpClient, mcpToolPolicy } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { TOOL_NAMES } from "../mcp/tools.ts";

export const MCP_POLICY_EFFECTS = ["ALLOW", "DENY"] as const;
export type McpPolicyEffect = (typeof MCP_POLICY_EFFECTS)[number];

function assertManageAny(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "apikey:manage_any", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

/** 客户端首次 initialize / 再次上报：记录名字与版本（不覆盖为空） */
export async function recordClientSeen(tokenId: string, clientName?: string | null, clientVersion?: string | null): Promise<void> {
  const name = clientName?.slice(0, 100) ?? null;
  const version = clientVersion?.slice(0, 50) ?? null;
  await db.insert(mcpClient).values({ tokenId, clientName: name, clientVersion: version, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: mcpClient.tokenId,
      set: {
        clientName: name ?? mcpClient.clientName,
        clientVersion: version ?? mcpClient.clientVersion,
        lastSeenAt: new Date(),
      },
    });
}

/** 每次工具调用：累加计数并刷新 last_seen（无客户端行时补建，避免首调丢失） */
export async function recordToolCall(tokenId: string): Promise<void> {
  await db.insert(mcpClient).values({ tokenId, lastSeenAt: new Date(), callCount: 1 })
    .onConflictDoUpdate({
      target: mcpClient.tokenId,
      set: { callCount: sql`${mcpClient.callCount} + 1`, lastSeenAt: new Date() },
    });
}

/** DENY 优先：存在 DENY 策略即拒绝（ALLOW 策略记录用，不绕过档位/账号权限） */
export async function assertToolPolicyAllowed(tokenId: string, toolName: string): Promise<void> {
  const row = (await db.select({ effect: mcpToolPolicy.effect }).from(mcpToolPolicy)
    .where(and(eq(mcpToolPolicy.tokenId, tokenId), eq(mcpToolPolicy.toolName, toolName))).limit(1))[0];
  if (row?.effect === "DENY") {
    throw new DomainError("FORBIDDEN", `工具「${toolName}」已被管理员策略禁用（DENY 优先于令牌档位）`, { tool: toolName });
  }
}

export interface McpClientView {
  id: string; tokenId: string; tokenName: string; tier: string;
  clientName: string | null; clientVersion: string | null; lastSeenAt: Date | null; callCount: number;
  policies: { toolName: string; effect: string; argConstraints: unknown }[];
}

export async function listMcpClients(actor: Actor): Promise<McpClientView[]> {
  assertManageAny(actor);
  const rows = await db.select({
    id: mcpClient.id, tokenId: mcpClient.tokenId, tokenName: apiToken.name, tier: apiToken.tier,
    clientName: mcpClient.clientName, clientVersion: mcpClient.clientVersion,
    lastSeenAt: mcpClient.lastSeenAt, callCount: mcpClient.callCount,
  }).from(mcpClient).innerJoin(apiToken, eq(apiToken.id, mcpClient.tokenId));
  const ids = rows.map((r) => r.tokenId);
  const policies = ids.length
    ? await db.select().from(mcpToolPolicy).where(inArray(mcpToolPolicy.tokenId, ids))
    : [];
  return rows.map((r) => ({
    ...r,
    policies: policies.filter((p) => p.tokenId === r.tokenId)
      .map((p) => ({ toolName: p.toolName, effect: p.effect, argConstraints: p.argConstraints })),
  }));
}

/** 整体替换某客户端的工具策略（事务内删旧插新） */
export async function replaceClientPolicies(actor: Actor, clientId: string, input: {
  toolName: string; effect: string; argConstraints?: Record<string, unknown>;
}[]): Promise<McpClientView["policies"]> {
  assertManageAny(actor);
  const client = (await db.select({ tokenId: mcpClient.tokenId }).from(mcpClient).where(eq(mcpClient.id, clientId)).limit(1))[0];
  if (!client) throw forbidden();
  const known = new Set(TOOL_NAMES);
  const seen = new Set<string>();
  for (const p of input) {
    if (!(MCP_POLICY_EFFECTS as readonly string[]).includes(p.effect)) {
      throw new DomainError("VALIDATION", `effect 只支持 ${MCP_POLICY_EFFECTS.join(" / ")}`, { toolName: p.toolName });
    }
    if (!known.has(p.toolName)) throw new DomainError("VALIDATION", `未知工具「${p.toolName}」`, { toolName: p.toolName });
    if (seen.has(p.toolName)) throw new DomainError("VALIDATION", `工具「${p.toolName}」重复配置`, { toolName: p.toolName });
    seen.add(p.toolName);
  }
  await db.transaction(async (tx) => {
    await tx.delete(mcpToolPolicy).where(eq(mcpToolPolicy.tokenId, client.tokenId));
    if (input.length) {
      await tx.insert(mcpToolPolicy).values(input.map((p) => ({
        tokenId: client.tokenId, toolName: p.toolName, effect: p.effect,
        argConstraints: (p.argConstraints ?? {}) as object,
      })));
    }
  });
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "mcp.policy_updated", targetType: "MCP_CLIENT", targetId: clientId,
    });
  }
  return input.map((p) => ({ toolName: p.toolName, effect: p.effect, argConstraints: p.argConstraints ?? {} }));
}
