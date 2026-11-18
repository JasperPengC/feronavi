/** 想法页（第十一期）：列表与热度、投票/撤票、转工作项、筛选、空态 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试", permissions: ["idea:submit", "idea:vote", "idea:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "66666666-6666-6666-6666-666666666666";
const calls: string[] = [];

function stub(list: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
    const u = String(i);
    calls.push(`${init?.method ?? "GET"} ${u.replace("http://localhost", "")}`);
    if (u.includes("/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/ideas") && (init?.method === "POST" || init?.method === "DELETE")) return new Response(JSON.stringify({ ok: true, score: "3.00" }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/ideas")) return new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}
function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/ideas`] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => { calls.length = 0; vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const IT = { id: "i1", title: "支持导出 Excel", description: "财务要", status: "NEW", score: "5.00", submittedByMemberId: "m9", submitterDisplay: "小王", promotedWorkItemId: null };

describe("想法页", () => {
  it("空态给出「先收集再决策」的指引", async () => {
    stub({ items: [], total: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/还没有想法/)).toBeTruthy());
    expect(screen.getByText(/每人可投一票.*改票或撤票/)).toBeTruthy();
    expect(screen.getByText(/提交建议.*讨论和投票/)).toBeTruthy();
  });

  it("列表展示热度与提交者，投票/反对/撤票都能触发请求", async () => {
    stub({ items: [IT], total: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText("支持导出 Excel")).toBeTruthy());
    expect(screen.getByText("5")).toBeTruthy();                       // 热度（投票净和）
    expect(screen.getByText(/内部提交/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("赞成 支持导出 Excel"));
    await waitFor(() => expect(calls.some((c) => c.startsWith("POST") && c.includes("/vote"))).toBe(true));
    fireEvent.click(screen.getByLabelText("反对 支持导出 Excel"));
    await waitFor(() => expect(calls.filter((c) => c.includes("/vote")).length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByLabelText("撤票 支持导出 Excel"));
    await waitFor(() => expect(calls.some((c) => c.startsWith("DELETE") && c.includes("/vote"))).toBe(true));
  });

  it("转工作项后提供查看入口，不再重复转换", async () => {
    stub({ items: [{ ...IT, promotedWorkItemId: "w1" }], total: 1 });
    renderPage();
    await screen.findByRole("button", { name: "查看工作项", exact: true });
    expect(screen.queryByRole("button", { name: "转工作项", exact: true })).toBeNull();
  });

  it("提交按钮在标题为空时禁用；筛选切换会带 status 参数", async () => {
    stub({ items: [], total: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/还没有想法/)).toBeTruthy());
    expect((screen.getByText("提交") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("想法标题"), { target: { value: "新点子" } });
    await waitFor(() => expect((screen.getByText("提交") as HTMLButtonElement).disabled).toBe(false));
    // 筛选控件已从原生 <select> 换为自绘 Select（用户要求第 4 条）：
    // 改为"点开触发器 → 点选项"（真实用户路径），不再驱动原生控件
    fireEvent.click(screen.getByLabelText("按状态筛选"));
    fireEvent.click(screen.getByRole("option", { name: "已驳回" }));
    await waitFor(() => expect(calls.some((c) => c.includes("status=REJECTED"))).toBe(true));
  });
});
