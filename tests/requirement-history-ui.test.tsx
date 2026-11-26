import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RequirementHistory } from "../src/client/components/work-item/RequirementHistory.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const revision = (n: number) => ({ id: `r${n}`, workItemId: "w1", revisionNo: n, workItemVersion: n + 3, title: `需求第${n}版`, description: n === 3 ? "保留\n新增条件" : "保留\n旧条件", authorId: n === 1 ? null : "m1", authorName: n === 1 ? null : "开发者", source: n === 1 ? "BASELINE" : "EDIT", createdAt: "2026-11-25T01:00:00Z" });
function setup(options: { failList?: boolean; failDetail?: boolean } = {}) {
  let failed = options.failList;
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url); requests.push(path);
    if (/\/revisions\?/.test(path)) {
      if (failed) { failed = false; return json({ code: "INTERNAL", message: "历史读取失败" }, 500); }
      const list = path.includes("before=2") ? [revision(1)] : [revision(3), revision(2)];
      return json({ items: list.map(({ description: _description, ...meta }) => meta), nextCursor: path.includes("before=2") ? null : 2 });
    }
    if (path.endsWith("/revisions/r3") && options.failDetail) return json({ code: "FORBIDDEN", message: "无权访问该资源" }, 403);
    return json(revision(Number(path.at(-1))));
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc);
  const view = render(<QueryClientProvider client={qc}><RequirementHistory workItemId="w1" workItemVersion={7} /></QueryClientProvider>);
  return { requests, qc, view };
}
function openHistory() {
  const details = screen.getByText("正文历史").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

it("折叠时不请求历史，展开后查看正文，再按固定版本比较", async () => {
  const { requests } = setup();
  expect(requests).toHaveLength(0);
  openHistory();
  await screen.findByText("新增条件", { exact: false });
  expect(requests.some(path => path.endsWith("/r2"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "比较版本" }));
  await screen.findByText("旧条件", { exact: false });
  expect(screen.getByText("新增")).toBeTruthy();
  expect(screen.getByText("删除")).toBeTruthy();
  expect(requests.some(path => path.endsWith("/r2"))).toBe(true);
});

it("可加载更早版本并查看真实基线，基线作者与时间不冒充原始历史", async () => {
  setup(); openHistory();
  fireEvent.click(await screen.findByRole("button", { name: "加载更早版本" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "加载更早版本" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "查看版本" }));
  fireEvent.click(await screen.findByRole("option", { name: /V1/ }));
  expect(await screen.findByText("历史基线")).toBeTruthy();
  expect(screen.getByText("作者未记录")).toBeTruthy();
  expect(screen.getByText("这是启用历史记录时保存的当前内容，更早的修改未记录。")).toBeTruthy();
});

it("加载失败可重试，详情拒绝访问时不展示伪正文", async () => {
  setup({ failList: true, failDetail: true }); openHistory();
  await screen.findByText("历史读取失败");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("无权访问该资源");
  expect(screen.queryByText("新增条件", { exact: false })).toBeNull();
});

it("工作项保存后历史查询随当前版本刷新", async () => {
  const { view, qc, requests } = setup(); openHistory();
  await screen.findByText("新增条件", { exact: false });
  const count = requests.filter(path => path.includes("/revisions?")).length;
  view.rerender(<QueryClientProvider client={qc}><RequirementHistory workItemId="w1" workItemVersion={8} /></QueryClientProvider>);
  await waitFor(() => expect(requests.filter(path => path.includes("/revisions?")).length).toBe(count + 1));
});
