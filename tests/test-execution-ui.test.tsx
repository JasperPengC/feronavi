import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale } from "../src/client/i18n/index.ts";
import { TestRunPanel } from "../src/client/components/testing/TestRunPanel.tsx";
import { TestStatusTag } from "../src/client/components/testing/testing-ui.tsx";
import type { TestRunDetail } from "../src/shared/schemas/test-execution.ts";
const row = {
  id: "run",
  projectId: "p",
  planId: "plan",
  planCaseId: "pc",
  caseId: "case",
  caseKey: "F-TC-1",
  planTitle: "验收",
  build: "abc",
  environment: "local",
  attempt: 1,
  retestOf: null,
  status: "IN_PROGRESS",
  version: 2,
  source: "MANUAL",
  sourceReference: null,
  sourceVerification: "SELF_REPORTED",
  executorId: "m",
  executorName: "开发者",
  startedAt: "2026-11-25T00:00:00Z",
  finishedAt: null,
  cancelReason: null,
  results: [],
  defects: [],
  canExecute: true,
  canRetest: false,
  canCreateDefect: false,
  canLinkDefect: false,
  revision: {
    id: "rev",
    caseId: "case",
    revisionNo: 1,
    title: "登录",
    preconditions: "",
    steps: [{ action: "登录", expected: "返回首页" }],
    requirements: [],
    createdBy: "m",
    authorName: "开发者",
    createdAt: "2026-11-25T00:00:00Z",
  },
} satisfies TestRunDetail;
beforeEach(() => setLocale("zh-CN"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function show(run: TestRunDetail) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TestRunPanel
        projectId="p"
        runId="run"
        onClose={() => {}}
        onSaved={async () => {}}
        initialRun={run}
      />
    </QueryClientProvider>,
  );
}
it("测试状态标签保留文字并区分通过、失败、执行中", () => {
  const { container } = render(
    <>
      <TestStatusTag status="PASSED" />
      <TestStatusTag status="FAILED" />
      <TestStatusTag status="RUNNING" />
    </>,
  );
  expect(
    [...container.querySelectorAll(".wi-tag")].map((el) =>
      el.getAttribute("data-tone"),
    ),
  ).toEqual(["success", "danger", "primary"]);
  expect(screen.getByText("通过")).toBeTruthy();
});
it("未填写逐步结果不能完成；保存冲突保留草稿和固定版本", async () => {
  const fetcher = vi.fn(
    async (_u: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "PATCH"
            ? { message: "执行已更新，请重新读取" }
            : row,
        ),
        { status: init?.method === "PATCH" ? 409 : 200 },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  show(row);
  expect(
    (screen.getByRole("button", { name: "完成执行" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("实际结果 1"), {
    target: { value: "返回首页，导航正确" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存进展" }));
  expect(await screen.findByText("执行已更新，请重新读取")).toBeTruthy();
  expect(
    (screen.getByLabelText("实际结果 1") as HTMLTextAreaElement).value,
  ).toBe("返回首页，导航正确");
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(
      true,
    ),
  );
  const body = JSON.parse(
    String(
      fetcher.mock.calls.find(([, i]) => i?.method === "PATCH")?.[1]?.body,
    ),
  );
  expect(body.expectedVersion).toBe(2);
});
it("已结束执行只读，展示原始结果和复测入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...row,
            status: "FAILED",
            canExecute: false,
            canRetest: true,
            results: [
              {
                stepIndex: 0,
                status: "FAILED",
                actual: "接口错误",
                evidence: [],
              },
            ],
          }),
        ),
    ),
  );
  show({
    ...row,
    status: "FAILED",
    canExecute: false,
    canRetest: true,
    results: [
      { stepIndex: 0, status: "FAILED", actual: "接口错误", evidence: [] },
    ],
  });
  expect(screen.queryByRole("button", { name: "保存进展" })).toBeNull();
  expect(await screen.findByText("接口错误")).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建复测" })).toBeTruthy();
});
