/** 审计与活动路由（W3）—— audit_entry 只读，没有任何写端点 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { DomainError } from "../../shared/errors.ts";
import * as auditService from "../services/audit.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/audit-entries", async (req) => {
    const actor = actorOf(req);
    const q = req.query as {
      actorId?: string; action?: string; targetType?: string; severity?: string; q?: string;
      from?: string; to?: string; page?: string; pageSize?: string;
    };
    const severity = q.severity === "SECURITY" || q.severity === "BUSINESS" ? q.severity : undefined;
    const result = await auditService.listAuditEntries(actor, {
      actorId: q.actorId, action: q.action, targetType: q.targetType, severity, q: q.q,
      from: q.from, to: q.to,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    // IP 归属地（ip2region，进程内查询）：审计取证时"从哪里登录"比裸 IP 直观得多。
    // 库不可用/非 IPv4 时为 null，前端按未知展示。
    const { lookupLocation } = await import("../services/ipgeo.service.ts");
    const cache = new Map<string, string | null>();
    const items = await Promise.all(result.items.map(async (r) => {
      if (!r.ip) return { ...r, ipLocation: null };
      if (!cache.has(r.ip)) cache.set(r.ip, await lookupLocation(r.ip));
      return { ...r, ipLocation: cache.get(r.ip) ?? null };
    }));
    return { ...result, items };
  });

  /** 导出 CSV（合规取证）：与列表同筛选；UTF-8 BOM 便于 Excel 打开中文 */
  app.get("/api/v1/audit-entries/export", async (req, reply) => {
    const actor = actorOf(req);
    const q = req.query as {
      actorId?: string; action?: string; targetType?: string; severity?: string; q?: string;
      from?: string; to?: string;
    };
    const severity = q.severity === "SECURITY" || q.severity === "BUSINESS" ? q.severity : undefined;
    const rows = await auditService.listAuditEntriesForExport(actor, {
      actorId: q.actorId, action: q.action, targetType: q.targetType, severity, q: q.q,
      from: q.from, to: q.to,
    });

    // CSV 转义：引号加倍并用引号包裹；换行/逗号都包在引号里
    const cell = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["time", "severity", "action", "actorId", "actorSnapshot", "targetType", "targetId", "ip", "changes"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        r.severity, r.action, r.actorId, r.actorSnapshot, r.targetType, r.targetId, r.ip,
        r.changes === null || r.changes === undefined ? "" : JSON.stringify(r.changes),
      ].map(cell).join(","));
    }
    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="audit-${day}.csv"`)
      .header("cache-control", "no-store")
      .send(csv);
  });

  app.get("/api/v1/projects/:id/activity", async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const q = req.query as {
      page?: string; pageSize?: string; category?: string; q?: string; mine?: string;
      from?: string; to?: string;
    };
    return auditService.projectActivity(actor, id, {
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 50,
      category: q.category,
      q: q.q,
      mineOnly: q.mine === "1" || q.mine === "true",
      from: q.from,
      to: q.to,
    });
  });

  /** 活动导出 CSV（合规取证）：与列表同筛选口径；UTF-8 BOM 便于 Excel */
  app.get("/api/v1/projects/:id/activity/export", async (req, reply) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const q = req.query as {
      category?: string; q?: string; mine?: string; from?: string; to?: string;
    };
    const rows = await auditService.projectActivityForExport(actor, id, {
      category: q.category, q: q.q,
      mineOnly: q.mine === "1" || q.mine === "true",
      from: q.from, to: q.to,
    });
    const cell = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["time", "action", "actorId", "targetType", "targetId", "summary"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        r.action, r.actorId, r.targetType, r.targetId, r.summary,
      ].map(cell).join(","));
    }
    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="activity-${day}.csv"`)
      .header("cache-control", "no-store")
      .send(csv);
  });

  app.get("/api/v1/activity/recent", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { limit?: string };
    return auditService.recentActivity(actor, q.limit ? Number(q.limit) : 20);
  });
}
