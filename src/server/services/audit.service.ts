/**
 * 审计 + 活动时间线（W3，数据模型 8.1）
 *
 * 三条铁律：
 *   1 `audit_entry` **只读** —— 全项目没有任何写它的端点，服务只提供 insert 内部函数
 *   2 `changes` **白名单由本服务统一过滤**（不靠各调用点自觉）——
 *      允许字段名 + 枚举/状态码 + 不可逆 ID；禁止 email/name/username/密码/正文
 *   3 `activity_entry.summary` 是**预渲染中文文案**（前端不拼装）
 */
import { and, desc, eq, gte, ilike, like, lte, sql, type SQL } from "drizzle-orm";
import { DomainError, SYSTEM_RESTORE_ERROR_CODES } from "../../shared/errors.ts";
import { db } from "../../db/index.ts";
import { activityEntry, auditEntry, member } from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";

/** changes 允许写入的键（白名单，第 2.6 节「审计与个人数据分离」） */
const CHANGES_ALLOWED = new Set([
  "statusId", "statusKey", "priority", "severity", "type", "assigneeId",
  "milestoneId", "iterationId", "releaseId", "moduleId", "productId", "roleId", "projectId",
  // 功能开关的 key 是稳定标识（非 PII）；audit_entry.target_id 是 uuid，不能塞 key
  "flagKey",
  "projectId", "teamId", "workflowId", "dueDate", "startDate", "estimatePoints",
  "locale", "timezone", "theme", "isArchived", "carryOver",
]);

/** 白名单统一过滤：非白名单键整块剔除（含嵌套对象也只按顶层键过滤） */
export function sanitizeChanges(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "errorCode" && typeof v === "string" && (SYSTEM_RESTORE_ERROR_CODES as readonly string[]).includes(v)) { out[k] = v; continue; }
    if (!CHANGES_ALLOWED.has(k)) continue;
    // 值也过一遍：长文本（>200 字符）一律截断为占位，防止正文/姓名混进来
    if (typeof v === "string" && v.length > 200) { out[k] = "<redacted>"; continue; }
    if (typeof v === "object" && v !== null) { out[k] = "<redacted>"; continue; }
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface AuditInput {
  actorId: string | null;
  actorSnapshot?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  changes?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  severity: "SECURITY" | "BUSINESS";
}

/** 内部写入（**不暴露成端点**）。审计失败不阻断主操作，但必须进错误日志 */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditEntry).values({
      actorId: input.actorId,
      actorSnapshot: input.actorSnapshot ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      changes: sanitizeChanges(input.changes),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      severity: input.severity,
    });
  } catch (e) {
    console.error("[audit] 写入失败（不阻断主操作）:", (e as Error).message);
  }
}

/** 安全事件审计（severity=SECURITY 的简写）。与 writeAudit 一样**不阻断主操作** */
export async function writeSecurityAudit(input: Omit<AuditInput, "severity">): Promise<void> {
  await writeAudit({ ...input, severity: "SECURITY" });
}

export interface ActivityInput {
  projectId: string | null;
  actorId: string | null;
  targetType: string;
  targetId?: string | null;
  action: string;
  /** 预渲染中文文案，例如「张三 把 DEMO-1 移到了「进行中」」 */
  summary: string;
}

export async function writeActivity(input: ActivityInput): Promise<void> {
  try {
    await db.insert(activityEntry).values({
      projectId: input.projectId,
      actorId: input.actorId,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      action: input.action,
      summary: input.summary,
    });
  } catch (e) {
    console.error("[activity] 写入失败（不阻断主操作）:", (e as Error).message);
  }
}

// ── 查询端点 ────────────────────────────────────────────────

/** 审计导出（合规取证）：与列表同筛选口径，上限 10000 行；只返回**已脱敏**的 changes */
export async function listAuditEntriesForExport(actor: Actor, f: {
  actorId?: string; action?: string; targetType?: string;
  severity?: "SECURITY" | "BUSINESS"; q?: string; from?: string; to?: string;
  limit?: number;
}) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "audit:read", { projectId: null, teamId: null }, ctx)) throw forbidden();

  const conds = [];
  if (f.actorId) conds.push(eq(auditEntry.actorId, f.actorId));
  if (f.action) conds.push(eq(auditEntry.action, f.action));
  if (f.targetType) conds.push(eq(auditEntry.targetType, f.targetType));
  if (f.severity) conds.push(eq(auditEntry.severity, f.severity));
  if (f.q?.trim()) {
    const escaped = f.q.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`);
    conds.push(ilike(auditEntry.action, `%${escaped}%`));
  }
  if (f.from) conds.push(gte(auditEntry.createdAt, new Date(f.from)));
  if (f.to) conds.push(lte(auditEntry.createdAt, new Date(f.to)));

  const limit = Math.min(10_000, Math.max(1, f.limit ?? 10_000));
  return db.select().from(auditEntry)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditEntry.createdAt)).limit(limit);
}

export async function listAuditEntries(actor: Actor, f: {
  actorId?: string; action?: string; targetType?: string;
  severity?: "SECURITY" | "BUSINESS";
  /** 动作关键字（ILIKE，含通配符转义） */
  q?: string;
  from?: string; to?: string; page?: number; pageSize?: number;
}) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  // 审计是安全数据：只有 ADMIN 能读（权限矩阵有对应动作就交给矩阵判定）
  if (!can(actor, "audit:read", { projectId: null, teamId: null }, ctx)) throw forbidden();

  const conds = [];
  if (f.actorId) conds.push(eq(auditEntry.actorId, f.actorId));
  if (f.action) conds.push(eq(auditEntry.action, f.action));
  if (f.targetType) conds.push(eq(auditEntry.targetType, f.targetType));
  if (f.severity) conds.push(eq(auditEntry.severity, f.severity));
  if (f.q?.trim()) {
    const escaped = f.q.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`);
    conds.push(ilike(auditEntry.action, `%${escaped}%`));
  }
  if (f.from) conds.push(gte(auditEntry.createdAt, new Date(f.from)));
  if (f.to) conds.push(lte(auditEntry.createdAt, new Date(f.to)));
  const where = conds.length ? and(...conds) : undefined;

  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 50));
  const items = await db.select().from(auditEntry).where(where)
    .orderBy(desc(auditEntry.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const cnt = await db.select({ n: sql<number>`count(*)::int` }).from(auditEntry).where(where);
  return { items, total: cnt[0]?.n ?? 0, page, pageSize };
}

/** 项目活动可用的动作类别（与 action 前缀一致；未知类别忽略而不是拼进 SQL） */
export const ACTIVITY_CATEGORIES = [
  "work_item", "comment", "wiki", "attachment", "plan", "project", "announcement", "role", "idea", "workflow", "field", "import", "intake", "insight",
] as const;

export interface ProjectActivityOptions {
  page?: number;
  pageSize?: number;
  /** 动作类别（action 前缀），如 comment / wiki / plan */
  category?: string;
  /** 摘要关键字（ILIKE，做转义） */
  q?: string;
  /** 只看当前成员自己的活动 */
  mineOnly?: boolean;
  /** 起止日期（YYYY-MM-DD 或 ISO 时间；含当日边界） */
  from?: string;
  to?: string;
}

/** 活动日期筛选：接受 YYYY-MM-DD（按当日 UTC 边界）或 ISO 时间；非法值明确 400，不静默忽略 */
function activityDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const text = raw.length === 10 ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : raw;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) throw new DomainError("VALIDATION", "日期格式应为 YYYY-MM-DD", { value: raw });
  return d;
}

function activityConds(actor: Actor, projectId: string, opts: ProjectActivityOptions): SQL[] {
  const conds: SQL[] = [eq(activityEntry.projectId, projectId)];
  const category = opts.category?.trim();
  if (category && (ACTIVITY_CATEGORIES as readonly string[]).includes(category)) {
    conds.push(like(activityEntry.action, `${category}.%`));
  }
  const q = opts.q?.trim();
  if (q) {
    // 转义 LIKE 通配符：用户输入的 % / _ 不能变成通配（否则一个 % 就等价于全表）
    const escaped = q.replace(/[%_\\]/g, (ch) => `\\${ch}`);
    conds.push(ilike(activityEntry.summary, `%${escaped}%`));
  }
  if (opts.mineOnly) conds.push(eq(activityEntry.actorId, actor.memberId));
  const from = activityDate(opts.from, false);
  const to = activityDate(opts.to, true);
  if (from) conds.push(gte(activityEntry.createdAt, from));
  if (to) conds.push(lte(activityEntry.createdAt, to));
  return conds;
}

/** 项目维度活动时间线（按数据范围）+ 类别/关键字/只看我的筛选（total 为筛选后的总数） */
export async function projectActivity(actor: Actor, projectId: string, opts: ProjectActivityOptions = {}) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "activity:read", { projectId, teamId: null }, ctx)) throw forbidden();

  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 50)));
  const where = and(...activityConds(actor, projectId, opts));
  const items = await db.select().from(activityEntry).where(where)
    .orderBy(desc(activityEntry.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const cnt = await db.select({ n: sql<number>`count(*)::int` }).from(activityEntry).where(where);
  return { items, total: cnt[0]?.n ?? 0, page, pageSize };
}

/** 项目活动导出（合规取证）：与列表同筛选口径，上限 10000 行 */
export async function projectActivityForExport(actor: Actor, projectId: string, opts: ProjectActivityOptions = {}) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "activity:read", { projectId, teamId: null }, ctx)) throw forbidden();
  const where = and(...activityConds(actor, projectId, opts));
  return db.select().from(activityEntry).where(where)
    .orderBy(desc(activityEntry.createdAt)).limit(10_000);
}

/** 个人最近活动 */
export async function recentActivity(actor: Actor, limit = 20) {
  const items = await db.select().from(activityEntry)
    .where(eq(activityEntry.actorId, actor.memberId))
    .orderBy(desc(activityEntry.createdAt)).limit(Math.min(100, limit));
  return { items };
}

void member;
