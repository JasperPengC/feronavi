import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { invalidateFor } from "../src/client/lib/useEvents.ts";

describe("业务事件与页面缓存", () => {
  it.each(["workitem.changed", "workitem.transitioned", "workitem.assigned"])("%s 刷新所有工作项视图及详情，保留无关设置", (event) => {
    const qc = new QueryClient();
    const keys = [
      ["work-item-detail", "w1"], ["work-item-parent", "w1"],
      ["board", "p1", "", ""], ["table", "p1", 2],
      ["issues", "global", "OPEN"], ["issue-stats", "p1"],
      ["calendar", "p1", "2026-11"], ["calendar-unscheduled", "p1", 2],
      ["timeline", "p1"], ["workbench"], ["project-activity", "p1"],
      ["activity-series", "p1"], ["milestone-detail", "m1"],
    ];
    for (const key of [...keys, ["settings"], ["work-item-detail", "w2"]]) qc.setQueryData(key, {});
    invalidateFor(qc, event, { id: "w1" });
    for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    expect(qc.getQueryState(["settings"])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(["work-item-detail", "w2"])?.isInvalidated).toBe(false);
    qc.clear();
  });

  it("评论事件使用 targetId 而非评论 id，并刷新项目活动", () => {
    const qc = new QueryClient();
    const keys = [["comments", "WORK_ITEM", "w1"], ["comments", "WORK_ITEM", "w2"], ["project-activity", "p1", "COMMENT"], ["activity-series", "p1"]];
    for (const key of keys) qc.setQueryData(key, {});
    invalidateFor(qc, "comment.created", { id: "comment-1", targetType: "WORK_ITEM", targetId: "w1" });
    expect(qc.getQueryState(keys[0]!)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[1]!)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keys[2]!)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[3]!)?.isInvalidated).toBe(true);
    qc.clear();
  });

  it("已打开的看板收到事件会重新获取内容", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let serverTitle = "旧标题";
    const observer = new QueryObserver(qc, { queryKey: ["board", "p1", "", ""], queryFn: async () => ({ title: serverTitle }) });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    serverTitle = "新标题";
    try {
      invalidateFor(qc, "workitem.changed", { id: "w1" });
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual({ title: "新标题" }));
    } finally { unsubscribe(); qc.clear(); }
  });

  it("未知事件不会使任意缓存失效", () => {
    const qc = new QueryClient();
    qc.setQueryData(["settings"], {});
    invalidateFor(qc, "unknown", {});
    expect(qc.getQueryState(["settings"])?.isInvalidated).toBe(false);
    qc.clear();
  });

  it.each(["notification.new", "notification.changed"])("%s立即同步铃铛及过滤列表的未读数，并标记正文待刷新", event => {
    const qc = new QueryClient();
    const keys = [["notifications"], ["notifications", false], ["notifications", true]];
    for (const key of keys) qc.setQueryData(key, { items: [{ id: "n1" }], unreadCount: 1 });
    invalidateFor(qc, event, { id: "n2", unreadCount: 2 });
    for (const key of keys) {
      expect(qc.getQueryData(key)).toEqual({ items: [{ id: "n1" }], unreadCount: 2 });
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
    qc.clear();
  });

  it("丢失事件窗口时刷新所有已有查询，在线状态事件仅刷新 presence", () => {
    const qc = new QueryClient();
    qc.setQueryData(["presence"], {}); qc.setQueryData(["settings"], {});
    invalidateFor(qc, "presence", { memberId: "m1", online: true });
    expect(qc.getQueryState(["presence"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["settings"])?.isInvalidated).toBe(false);
    invalidateFor(qc, "dropped", {});
    expect(qc.getQueryState(["settings"])?.isInvalidated).toBe(true);
    qc.clear();
  });
});
