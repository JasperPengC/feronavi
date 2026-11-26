import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale, t } from "../src/client/i18n/index.ts";
import { TestCaseEditor } from "../src/client/components/testing/TestCaseEditor.tsx";
import { TestCaseLibrary } from "../src/client/components/testing/TestCaseLibrary.tsx";
import type { TestCaseDetail } from "../src/shared/schemas/test-management.ts";
const row = {
  id: "c1",
  projectId: "p1",
  key: "FERONAVI-TC-1",
  number: 1,
  title: "登录失效跳转",
  status: "READY",
  priority: "HIGH",
  version: 4,
  currentRevisionId: "r1",
  revisionNo: 2,
  suiteId: null,
  suiteName: null,
  ownerId: null,
  ownerName: null,
  updatedAt: "2026-11-25T00:00:00Z",
  canManage: true,
  revision: {
    id: "r1",
    caseId: "c1",
    revisionNo: 2,
    title: "登录失效跳转",
    preconditions: "已登录",
    steps: [{ action: "会话过期", expected: "返回登录页" }],
    requirements: [],
    createdBy: null,
    authorName: null,
    createdAt: "2026-11-25T00:00:00Z",
  },
} as TestCaseDetail;
beforeEach(() => setLocale("zh-CN"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}
it("窄屏套件筛选默认折叠，展开选择后保留选中套件并让用例回到首屏", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
    calls.push(String(u));
    return response(String(u).includes("/suites") ? { items: [{ id: "suite", name: "研发回归", activeCaseCount: 1 }], canManage: false } : { items: [row], nextCursor: null, canManage: false });
  }));
  wrap(<TestCaseLibrary projectId="p1" />);
  await screen.findByText("研发回归");
  const disclosure = screen.getByText("测试套件").closest("details") as HTMLDetailsElement;
  expect(disclosure).not.toBeNull(); expect(disclosure.open).toBe(false);
  act(() => { disclosure.open = true; fireEvent(disclosure, new Event("toggle")); });
  fireEvent.click(screen.getByRole("button", { name: /研发回归\s*1/ }));
  await waitFor(() => expect(calls.some(url => url.includes("suiteId=suite"))).toBe(true));
  expect(disclosure.open).toBe(false);
  expect(disclosure.querySelector("summary")?.textContent).toContain("研发回归");
  expect(screen.getByText("登录失效跳转")).toBeTruthy();
});
it("编辑用例保留版本基线，冲突后保留步骤草稿", async () => {
  const fetcher = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) =>
    i?.method === "PATCH"
      ? response({ message: "用例已更新，请重新读取" }, 409)
      : response(
          String(u).includes("members")
            ? { members: [] }
            : { items: [], rows: [] },
        ),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(
    <TestCaseEditor
      projectId="p1"
      row={row}
      onClose={() => {}}
      onSaved={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("用例标题"), {
    target: { value: "修改后的登录流程" },
  });
  fireEvent.change(screen.getByLabelText("预期结果 1"), {
    target: { value: "回到登录且保留来源" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  expect(await screen.findByText("用例已更新，请重新读取")).toBeTruthy();
  expect(
    (screen.getByLabelText("预期结果 1") as HTMLTextAreaElement).value,
  ).toBe("回到登录且保留来源");
  const body = JSON.parse(
    String(
      fetcher.mock.calls.find(([, i]) => i?.method === "PATCH")?.[1]?.body,
    ),
  );
  expect(body).toMatchObject({
    expectedVersion: 4,
    title: "修改后的登录流程",
    steps: [{ action: "会话过期", expected: "回到登录且保留来源" }],
  });
});
it("快速重复保存只创建一次用例", async () => {
  const fetcher = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) =>
    i?.method === "POST"
      ? new Promise<Response>(() => {})
      : response(
          String(u).includes("members")
            ? { members: [] }
            : { items: [], rows: [] },
        ),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(
    <TestCaseEditor
      projectId="p1"
      row={null}
      onClose={() => {}}
      onSaved={async () => {}}
    />,
  );
  const title = screen.getByLabelText("用例标题");
  fireEvent.change(title, { target: { value: "一次提交" } });
  act(() => {
    title
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    title
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, i]) => i?.method === "POST"),
    ).toHaveLength(1),
  );
});
it("列表失败可重试，不显示空库或创建操作", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ message: "网络故障" }, 503)),
  );
  wrap(<TestCaseLibrary projectId="p1" />);
  expect(
    (await screen.findAllByText(t("common.loadFailedShort"))).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByText("还没有测试用例")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "新建用例", exact: true }),
  ).toBeNull();
});
it("列表显示状态和优先级语义标签；只读用户仍能查看详情", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: RequestInfo | URL) =>
      response(
        String(u).includes("suites")
          ? { items: [], canManage: false }
          : {
              items: [{ ...row, canManage: false }],
              nextCursor: null,
              canManage: false,
            },
      ),
    ),
  );
  wrap(<TestCaseLibrary projectId="p1" />);
  await screen.findByText("登录失效跳转");
  expect(screen.getByText("就绪").getAttribute("data-tone")).toBe("success");
  expect(screen.getByText("高").getAttribute("data-tone")).toBe("warning");
  expect(
    screen.queryByRole("button", { name: "新建用例", exact: true }),
  ).toBeNull();
});
it("需求基线读取完成前不能保存，成功后固定关联版本", async () => {
  let resolveRevision: ((r: Response) => void) | undefined;
  const fetcher = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) => {
    if (i?.method === "POST") return response(row);
    if (String(u).includes("/revisions"))
      return new Promise<Response>((resolve) => {
        resolveRevision = resolve;
      });
    if (String(u).includes("/work-items"))
      return response({
        rows: [{ id: "req1", key: "FERONAVI-7", title: "需求变更" }],
      });
    return response(
      String(u).includes("/members") ? { members: [] } : { items: [] },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(
    <TestCaseEditor
      projectId="p1"
      row={null}
      onClose={() => {}}
      onSaved={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("用例标题"), {
    target: { value: "变更基线验收" },
  });
  const selector = screen.getByRole("button", { name: "关联需求" });
  await waitFor(() =>
    expect((selector as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(selector);
  fireEvent.click(
    await screen.findByRole("option", { name: "FERONAVI-7 · 需求变更" }),
  );
  await waitFor(() => expect(resolveRevision).toBeTruthy());
  expect(
    (
      screen.getByRole("button", {
        name: "保存",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await act(async () =>
    resolveRevision!(
      response({ items: [{ id: "req-v3", revisionNo: 3, title: "需求变更" }] }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true),
  );
  expect(
    JSON.parse(
      String(
        fetcher.mock.calls.find(([, i]) => i?.method === "POST")?.[1]?.body,
      ),
    ).requirements,
  ).toEqual([{ workItemId: "req1", revisionId: "req-v3" }]);
});
