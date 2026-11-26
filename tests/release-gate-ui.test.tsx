import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";
import { ReleaseGatePanel } from "../src/client/components/delivery/ReleaseGatePanel.tsx";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("发布检查逐项显示语义颜色，缺证据时禁止完成，历史未知不显示已部署", async () => {
  setLocale("zh-CN");
  const onReady = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      Response.json(
        String(url).endsWith("/sources")
          ? []
          : String(url).includes("/testing/plans")
            ? { items: [], nextCursor: null }
            : {
                releaseId: "r",
                candidate: null,
                completedAt: null,
                passed: false,
                checks: [
                  {
                    key: "merge",
                    passed: true,
                    message: "合并记录通过",
                    evidenceIds: [],
                  },
                  {
                    key: "deployment",
                    passed: false,
                    message: "缺少目标部署",
                    evidenceIds: [],
                  },
                ],
                verification: null,
                feedback: [],
              },
      ),
    ),
  );
  render(
    <ActorContext.Provider value={{ permissions: ["release:manage"] } as Actor}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ReleaseGatePanel projectId="p" releaseId="r" onReady={onReady} />
      </QueryClientProvider>
    </ActorContext.Provider>,
  );
  await screen.findByText("缺少目标部署");
  expect(screen.getByText("通过").getAttribute("data-tone")).toBe("success");
  expect(screen.getAllByText("待补齐")[0]!.getAttribute("data-tone")).toBe(
    "warning",
  );
  expect(onReady).toHaveBeenLastCalledWith(false);
  expect(screen.queryByText("已部署")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "建立发布候选" }));
  await screen.findByText("冻结范围");
});
