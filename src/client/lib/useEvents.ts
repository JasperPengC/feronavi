/**
 * SSE 订阅：与页面/本地写操作共用查询键和失效入口。
 *
 * notification.new 先更新已有列表的未读数，再刷新列表正文。
 * 断线重连由浏览器 EventSource 自带；窗口过期（410/dropped）→ 全量失效兜底。
 */
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invalidateCommentQueries, invalidateWorkItemQueries, queryKeys } from "./query-keys.ts";

/** data.id 是工作项事件的资源 id；评论事件必须使用 targetType/targetId。 */
export function invalidateFor(qc: QueryClient, event: string, data: Record<string, unknown>): void {
  switch (event) {
    case "workitem.changed":
    case "workitem.transitioned":
    case "workitem.assigned":
      void invalidateWorkItemQueries(qc, typeof data.id === "string" ? data.id : undefined);
      break;
    case "comment.created":
      void invalidateCommentQueries(qc, typeof data.targetType === "string" ? data.targetType : undefined,
        typeof data.targetId === "string" ? data.targetId : undefined);
      break;
    case "presence":
      void qc.invalidateQueries({ queryKey: queryKeys.presence() });
      break;
    case "notification.new":
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
export function useEvents(enabled: boolean): void {
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
    const onMsg = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;
        invalidateFor(qc, ev.type || "message", data);
      } catch { /* 单条坏数据不终结订阅 */ }
    };
    for (const t of ["notification.new", "workitem.changed", "workitem.transitioned", "workitem.assigned", "comment.created", "presence", "dropped"]) {
      es.addEventListener(t, onMsg as EventListener);
    }
    return () => es.close();
  }, [qc, enabled]);
}
