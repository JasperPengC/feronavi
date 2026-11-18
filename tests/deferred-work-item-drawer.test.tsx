import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkItemDrawer } from "../src/client/components/work-item/DeferredWorkItemDrawer.tsx";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";

const actor: Actor = { memberId: "m1", username: "demo", name: "测试", permissions: [], dataScopes: [],
  mustChangePassword: false, locale: "zh-CN", theme: null, timezone: "Asia/Shanghai" };
const clients: QueryClient[] = [];
const detailRequests: string[] = [];

function Harness({ initial = null }: { initial?: string | null }) {
  const [selected, setSelected] = useState(initial);
  return <><button onClick={() => setSelected("w1")}>打开第一项</button>
    <button onClick={() => setSelected("w2")}>打开第二项</button>
    <WorkItemDrawer workItemId={selected} onClose={() => setSelected(null)} />
    <WorkItemDrawer workItemId={null} onClose={() => {}} /></>;
}
function mount(initial?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<ActorContext.Provider value={actor}><QueryClientProvider client={client}><Harness initial={initial} /></QueryClientProvider></ActorContext.Provider>);
}
beforeEach(() => {
  setLocale("zh-CN");
  detailRequests.length = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const id = /^\/api\/v1\/work-items\/(w[12])$/u.exec(path)?.[1];
    if (id) detailRequests.push(id);
    const body = id ? { id, key: id === "w1" ? "TEST-1" : "TEST-2", title: `工作项${id}`, description: `正文${id}`,
      projectId: "p1", type: "TASK", priority: null, dueDate: null, assigneeId: null, version: 1 }
      : path.endsWith("/comments") ? [] : { links: [], children: [], approvals: [], sla: null, items: [], members: [], watchers: [], transfers: [], collaborators: [], logs: [], total: 0 };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

it("关闭的多个入口不请求详情，首次打开后保留退出动画和焦点，重开读取新事项", async () => {
  const { container } = mount();
  expect(detailRequests).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
  const first = screen.getByRole("button", { name: "打开第一项" });
  first.focus(); fireEvent.click(first);
  expect(await screen.findByText("正文w1")).toBeTruthy();
  const panel = screen.getByRole("dialog", { name: "TEST-1" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(within(panel).getByRole("button", { name: "关闭" }));
  expect(panel.isConnected).toBe(true);
  expect(panel.classList.contains("is-closing")).toBe(true);
  expect(panel.textContent).toContain("正文w1");
  expect(container.hasAttribute("inert")).toBe(true);
  await waitFor(() => expect(panel.isConnected).toBe(false));
  expect(document.activeElement).toBe(first);
  expect(container.hasAttribute("inert")).toBe(false);
  const second = screen.getByRole("button", { name: "打开第二项" });
  second.focus(); fireEvent.click(second);
  expect(await screen.findByText("正文w2")).toBeTruthy();
  expect(screen.queryByText("正文w1")).toBeNull();
  expect(detailRequests).toEqual(["w1", "w2"]);
});

it("初始即打开的入口加载对应详情", async () => {
  mount("w2");
  expect(await screen.findByText("正文w2")).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "TEST-2" })).toBeTruthy();
  expect(detailRequests).toEqual(["w2"]);
});
