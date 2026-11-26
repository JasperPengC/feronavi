import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale, t } from "../src/client/i18n/index.ts";
import { RequirementChanges } from "../src/client/components/work-item/RequirementChanges.tsx";
const revision = {
  id: "rev1",
  workItemId: "w1",
  revisionNo: 2,
  workItemVersion: 4,
  title: "原需求",
  description: "原文",
  source: "EDIT",
  authorId: "m1",
  authorName: "成员",
  createdAt: "2026-11-25T08:00:00Z",
};
const context = {
  workItemId: "w1",
  projectId: "p1",
  workItemVersion: 4,
  baseRevision: revision,
  impactFingerprint: "a".repeat(64),
  impacts: [],
  canCreate: true,
};
beforeEach(() => setLocale("zh-CN"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function open() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RequirementChanges workItemId="w1" workItemVersion={4} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText(t("change.section"), { exact: true }));
}
it("变更列表读取失败显示重试，不显示空态", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "读取失败" }), { status: 503 }),
    ),
  );
  open();
  expect(
    await screen.findByRole("button", { name: t("common.reload") }),
  ).toBeTruthy();
  expect(screen.queryByText(t("change.empty"))).toBeNull();
});
it("变更提交携带固定基线，冲突保留拟议正文与原因", async () => {
  const fetcher = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? { message: "需求已更新" }
            : String(url).endsWith("/context")
              ? context
              : { items: [], nextCursor: null },
        ),
        { status: init?.method === "POST" ? 409 : 200 },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  open();
  fireEvent.click(
    await screen.findByRole("button", {
      name: t("change.create"),
      exact: true,
    }),
  );
  const title = await screen.findByLabelText(t("change.proposedTitle"));
  fireEvent.change(title, { target: { value: "拟议新需求" } });
  fireEvent.change(screen.getByLabelText(t("change.reason")), {
    target: { value: "规则调整" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("change.submit"), exact: true }),
  );
  expect(await screen.findByText("需求已更新")).toBeTruthy();
  expect(
    (screen.getByLabelText(t("change.proposedTitle")) as HTMLInputElement)
      .value,
  ).toBe("拟议新需求");
  expect(
    JSON.parse(
      String(
        fetcher.mock.calls.find(([, i]) => i?.method === "POST")?.[1]?.body,
      ),
    ),
  ).toMatchObject({
    title: "拟议新需求",
    reason: "规则调整",
    baseRevisionId: "rev1",
    expectedWorkItemVersion: 4,
    impactFingerprint: "a".repeat(64),
  });
});
it("已批准变更只在明确应用时提交，并带工作项与提案版本", async () => {
  const change = {
    id: "c1",
    number: 1,
    workItemId: "w1",
    projectId: "p1",
    status: "APPROVED",
    version: 2,
    proposedTitle: "新需求",
    proposedDescription: "新文",
    reason: "规则调整",
    baseRevision: revision,
    canApply: true,
    canReview: false,
    canCancel: false,
    impacts: [],
    stale: false,
    createdAt: "2026-11-25T08:00:00Z",
  };
  const fetcher = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? { ...change, status: "APPLIED", canApply: false }
            : String(url).includes("/c1")
              ? change
              : { items: [change], nextCursor: null },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  open();
  fireEvent.click(await screen.findByRole("button", { name: /#1/ }));
  await screen.findByRole("button", { name: t("change.apply"), exact: true });
  expect(fetcher.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: t("change.apply"), exact: true }),
  );
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true),
  );
  expect(
    JSON.parse(
      String(
        fetcher.mock.calls.find(([, i]) => i?.method === "POST")?.[1]?.body,
      ),
    ),
  ).toEqual({ expectedVersion: 2, expectedWorkItemVersion: 4 });
});
it("变更展示实际参与人，已确认影响使用完成语义", async () => {
  const change = {
    id: "c1",
    number: 1,
    status: "APPLIED",
    version: 4,
    proposedTitle: "新需求",
    proposedDescription: "新文",
    reason: "规则调整",
    baseRevision: revision,
    createdAt: "2026-11-25T08:00:00Z",
    requestedBy: "m1",
    decidedBy: "m2",
    decidedAt: "2026-11-25T09:00:00Z",
    appliedBy: "m1",
    appliedAt: "2026-11-25T10:00:00Z",
    participants: [
      { id: "m1", name: "张开发" },
      { id: "m2", name: "李评审" },
    ],
    impacts: [
      {
        id: "i1",
        kind: "WORK_ITEM",
        targetId: "t1",
        title: "实现任务",
        key: "F-1",
        available: true,
        acknowledgedBy: "m2",
        acknowledgedAt: "2026-11-25T10:10:00Z",
        canAcknowledge: false,
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).includes("/c1")
              ? change
              : { items: [change], nextCursor: null },
          ),
        ),
    ),
  );
  open();
  fireEvent.click(await screen.findByRole("button", { name: /#1/ }));
  expect(
    (await screen.findByText(t("change.acknowledged"))).getAttribute(
      "data-tone",
    ),
  ).toBe("success");
  expect(screen.getAllByText(/张开发/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/李评审/).length).toBeGreaterThan(0);
});
