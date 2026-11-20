import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useEvents } from "../src/client/lib/useEvents.ts";
class Source extends EventTarget {
  static all: Source[] = [];
  closed = false;
  constructor() {
    super();
    Source.all.push(this);
  }
  close() {
    this.closed = true;
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Source.all = [];
});
it("每次open恢复全量快照；账户切换关闭旧订阅，迟到事件不再失效新账户缓存", () => {
  vi.stubGlobal("EventSource", Source);
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const hook = renderHook(({ id }) => useEvents(true, id), {
    initialProps: { id: "a" },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  const first = Source.all[0]!;
  act(() => {
    first.dispatchEvent(new Event("open"));
    first.dispatchEvent(new Event("error"));
    first.dispatchEvent(new Event("open"));
  });
  expect(invalidate).toHaveBeenCalledTimes(2);
  hook.rerender({ id: "b" });
  expect(first.closed).toBe(true);
  invalidate.mockClear();
  act(() => {
    first.dispatchEvent(new Event("open"));
    first.dispatchEvent(
      new MessageEvent("workitem.changed", { data: '{"id":"secret"}' }),
    );
  });
  expect(invalidate).not.toHaveBeenCalled();
  hook.unmount();
  expect(Source.all[1]?.closed).toBe(true);
});
it("换号时取消尚未刷新的个人批次，旧连接迟到帧不能进入新缓存", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", Source);
  const qc = new QueryClient();
  qc.setQueryData(["todos"], []);
  const hook = renderHook(({ id }) => useEvents(true, id), {
    initialProps: { id: "a" },
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  const first = Source.all[0]!;
  const frame = () => new MessageEvent("workspace.invalidated", { data: JSON.stringify({ domain: "todo", projectId: null, resourceType: "TODO", resourceId: "old-owner-todo" }) });
  act(() => first.dispatchEvent(frame()));
  hook.rerender({ id: "b" });
  act(() => { first.dispatchEvent(frame()); vi.advanceTimersByTime(100); });
  expect(qc.getQueryState(["todos"])?.isInvalidated).toBe(false);
  act(() => { Source.all[1]!.dispatchEvent(frame()); vi.advanceTimersByTime(100); });
  expect(qc.getQueryState(["todos"])?.isInvalidated).toBe(true);
  hook.unmount(); qc.clear();
});
