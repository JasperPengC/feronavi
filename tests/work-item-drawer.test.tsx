/** 工作项详情抽屉（Round 25 第 35 项）：基本信息、关联列表/移除、评论面板挂载 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkItemDrawer } from "../src/client/components/work-item/WorkItemDrawer.tsx";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

const ACTOR: Actor = {
  memberId: "m1", username: "demo", name: "演示管理员",
  permissions: ["work_item:assign", "work_item:update_any"], dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", theme: null, timezone: "Asia/Shanghai",
};
const DETAIL = {
  id: "w1", key: "FINOK-9", title: "抽屉验收工作项", description: "这是描述",
  type: "TASK", priority: "HIGH", dueDate: "2026-11-01", assigneeId: null, projectId: "p1", version: 1,
};
const LINK = { id: "l1", direction: "outgoing", target: { type: "IDEA", id: "i1", title: "关联的想法", key: null } };

function renderDrawer(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<ActorContext.Provider value={ACTOR}><QueryClientProvider client={qc}><WorkItemDrawer workItemId="w1" onClose={onClose} /></QueryClientProvider></ActorContext.Provider>);
  return { onClose };
}

describe("工作项详情抽屉", () => {
  it("展示编号/标题/描述/关联/评论，并可移除关联", async () => {
    const calls: string[] = [];
    let links = [LINK];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.includes("/api/v1/work-item-links/l1") && init?.method === "DELETE") { links = []; return new Response("{}", { status: 200 }); }
      if (u.includes("/work-items/w1/links")) return new Response(JSON.stringify({ links }), { status: 200 });
      if (u.includes("/work-items/w1/comments")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/work-items/w1/transfers")) return new Response(JSON.stringify({ transfers: [] }), { status: 200 });
      if (u.includes("/work-items/w1/watchers")) return new Response(JSON.stringify({ watchers: [] }), { status: 200 });
      if (u.endsWith("/api/v1/members")) return new Response(JSON.stringify({ members: [] }), { status: 200 });
      if (u.includes("/api/v1/work-items/w1")) return new Response(JSON.stringify(DETAIL), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderDrawer();
    await waitFor(() => expect(screen.getAllByText(/FINOK-9/).length).toBeGreaterThan(0));
    expect(screen.getByText("这是描述")).toBeTruthy();
    expect(screen.getByText("关联的想法")).toBeTruthy();
    expect(screen.getByText("评论")).toBeTruthy();
    fireEvent.click(screen.getByText("关联与子项"));
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    await waitFor(() => expect(calls.some((c) => c.startsWith("DELETE") && c.includes("/work-item-links/l1"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("关联的想法")).toBeNull());
  });

  it("在评论面板发评论会 POST 到工作项评论端点", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.includes("/comments") && init?.method === "POST") return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
      if (u.includes("/work-items/w1/links")) return new Response(JSON.stringify({ links: [] }), { status: 200 });
      if (u.includes("/comments")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/work-items/w1/transfers")) return new Response(JSON.stringify({ transfers: [] }), { status: 200 });
      if (u.includes("/work-items/w1/watchers")) return new Response(JSON.stringify({ watchers: [] }), { status: 200 });
      if (u.endsWith("/api/v1/members")) return new Response(JSON.stringify({ members: [] }), { status: 200 });
      if (u.includes("/api/v1/work-items/w1")) return new Response(JSON.stringify(DETAIL), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderDrawer();
    await waitFor(() => expect(screen.getByText("还没有关联")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/写评论/), { target: { value: "抽屉评论验收" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(calls.some((c) => c.startsWith("POST") && c.includes("/work-items/w1/comments"))).toBe(true));
  });
});
