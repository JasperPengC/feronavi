/** 团队面板（Round 25 第 44 项）：树渲染、新建团队请求体、成员空态 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamPanel } from "../src/client/components/TeamPanel.tsx";
import { ToastHost } from "../src/client/components/ui/Toast.tsx";
import { ActorContext } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "u", name: "管理员", permissions: ["member:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

const TEAMS = [{
  id: "root", name: "研发中心", parentId: null, sortOrder: 0, memberCount: 0,
  children: [{ id: "fe", name: "前端组", parentId: "root", sortOrder: 0, memberCount: 2, children: [] }],
}];

function stubFetch(handler?: (url: string, init?: RequestInit) => Response | null) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
    const url = String(i);
    if (url.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
    const custom = handler?.(url, init);
    if (custom) return custom;
    if (url.includes("/api/v1/teams") && init?.method === "POST") return new Response(JSON.stringify({ id: "new" }), { status: 201 });
    if (url.includes("/api/v1/teams") && url.includes("/members")) return new Response(JSON.stringify({ teamIds: ["root"], members: [] }), { status: 200 });
    if (url.includes("/api/v1/teams")) return new Response(JSON.stringify({ teams: TEAMS }), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      {/* @ts-expect-error 测试用最小 actor */}
      <ActorContext.Provider value={ACTOR}><TeamPanel /><ToastHost /></ActorContext.Provider>
    </QueryClientProvider>,
  );
}

describe("团队面板", () => {
  it("渲染团队树与成员数，新建团队发送名称与父级", async () => {
    const posts: Record<string, unknown>[] = [];
    stubFetch((_url, init) => {
      if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: "new" }), { status: 201 }); }
      return null;
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("研发中心")).toBeTruthy());
    expect(screen.getByText("前端组")).toBeTruthy();
    expect(screen.getByText("2 人")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建团队" }));
    fireEvent.change(screen.getByLabelText("团队名称"), { target: { value: "测试组" } });
    fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toEqual({ name: "测试组", parentId: null });
    await waitFor(() => expect(screen.getByText("团队已保存")).toBeTruthy());
  });

  it("查看成员空态", async () => {
    stubFetch();
    renderPanel();
    await waitFor(() => expect(screen.getByText("前端组")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "查看成员" })[1]!);
    await waitFor(() => expect(screen.getByText("该团队（含子团队）暂无成员。")).toBeTruthy());
  });
});
