/**
 * SSE 订阅：与页面/本地写操作共用查询键和失效入口。
 *
 * notification.new 先更新已有列表的未读数，再刷新列表正文。
 * 断线重连由浏览器 EventSource 自带；窗口过期（410/dropped）→ 全量失效兜底。
 */
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invalidateCommentQueries, invalidateResourceBatch, invalidateResourceQueries, invalidateWorkspaceBatch, invalidateWorkItemQueries, queryKeys } from "./query-keys.ts";
import { parseResourceInvalidation, parseWorkspaceInvalidation, type ResourceInvalidation, type WorkspaceInvalidation } from "../../shared/resource-events.ts";

/** data.id 是工作项事件的资源 id；评论事件必须使用 targetType/targetId。 */
export function invalidateFor(qc: QueryClient, event: string, data: Record<string, unknown>): void {
  switch (event) {
    case "workspace.invalidated": {
      const value = parseWorkspaceInvalidation(data);
      if (value) void invalidateWorkspaceBatch(qc, [value]);
      break;
    }
    case "resource.invalidated": {
      const scope = parseResourceInvalidation(data);
      if (scope) void invalidateResourceQueries(qc, scope);
      break;
    }
    case "workitem.changed":
    case "workitem.transitioned":
    case "workitem.assigned":
      if (typeof data.projectId === "string" && typeof data.id === "string") {
        void invalidateResourceQueries(qc, { domain: "workitem", projectId: data.projectId, resourceType: "WORK_ITEM", resourceId: data.id });
      } else void invalidateWorkItemQueries(qc, typeof data.id === "string" ? data.id : undefined);
      break;
    case "comment.created":
      void invalidateCommentQueries(qc, typeof data.targetType === "string" ? data.targetType : undefined,
        typeof data.targetId === "string" ? data.targetId : undefined);
      break;
    case "presence":
      void qc.invalidateQueries({ queryKey: queryKeys.presence() });
      break;
    case "notification.new":
    case "notification.changed":
      qc.setQueriesData({ queryKey: queryKeys.notifications() }, (old: { items: unknown[]; unreadCount: number } | undefined) =>
        old ? { ...old, unreadCount: (data.unreadCount as number) ?? old.unreadCount } : old);
      void qc.invalidateQueries({ queryKey: queryKeys.notifications() });
      break;
    case "dropped":
      void qc.invalidateQueries();
      break;
    default:
      break;
  }
}

/** 挂在主应用壳：登录后常驻订阅 */
export function useEvents(enabled: boolean, accountId?: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    // ⚠️ EventSource 不是所有环境都有（jsdom 就没有；个别旧浏览器也没有）。
    //    实测踩到：无此构造函数时整棵树被炸掉（错误边界兜住才没变黑屏）。
    //    实时不支持 = 静默降级为「手动刷新」，绝不能让主界面挂掉。
    if (typeof EventSource === "undefined") return;
    let es: EventSource;
    try {
      es = new EventSource("/api/v1/events", { withCredentials: true });
    } catch {
      return;
    }
    let active = true;
    es.addEventListener("open", () => { if (active) void qc.invalidateQueries(); });
    const pending = new Map<string, ResourceInvalidation>();
    const pendingWorkspace = new Map<string, WorkspaceInvalidation>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (!active) return;
      if (pending.size) void invalidateResourceBatch(qc, [...pending.values()]);
      if (pendingWorkspace.size) void invalidateWorkspaceBatch(qc, [...pendingWorkspace.values()]);
      pending.clear(); pendingWorkspace.clear(); flushTimer = undefined;
    };
    const onMsg = (ev: MessageEvent) => {
      if (!active) return;
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;
        const workspace = ev.type === "workspace.invalidated" ? parseWorkspaceInvalidation(data) : null;
        if (workspace) {
          pendingWorkspace.set(`${workspace.domain}:${workspace.resourceType}:${workspace.resourceId}`, workspace);
          flushTimer ??= setTimeout(flush, 50);
          return;
        }
        const scope = ev.type === "resource.invalidated" ? parseResourceInvalidation(data)
          : ev.type.startsWith("workitem.") && typeof data.id === "string" && typeof data.projectId === "string"
            ? { domain: "workitem" as const, projectId: data.projectId, resourceType: "WORK_ITEM", resourceId: data.id }
            : ev.type.startsWith("comment.") && typeof data.targetType === "string" && typeof data.targetId === "string" && typeof data.projectId === "string"
              ? { domain: "comment" as const, projectId: data.projectId, resourceType: data.targetType, resourceId: data.targetId } : null;
        if (scope) {
          pending.set(`${scope.domain}:${scope.resourceType}:${scope.resourceId}`, scope);
          flushTimer ??= setTimeout(flush, 50);
          return;
        }
        if (ev.type === "dropped") { pending.clear(); pendingWorkspace.clear(); clearTimeout(flushTimer); flushTimer = undefined; }
        invalidateFor(qc, ev.type || "message", data);
      } catch { /* 单条坏数据不终结订阅 */ }
    };
    for (const t of ["workspace.invalidated", "resource.invalidated", "notification.new", "notification.changed", "workitem.changed", "workitem.transitioned", "workitem.assigned", "comment.created", "presence", "dropped"]) {
      es.addEventListener(t, onMsg as EventListener);
    }
    return () => { active = false; clearTimeout(flushTimer); pending.clear(); pendingWorkspace.clear(); es.close(); };
  }, [qc, enabled, accountId]);
}
