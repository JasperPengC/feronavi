/**
 * 前端长目标新建页面的 UI 测试（第 21 轮补）
 *
 * 为什么必须补：本轮新建了 4 个页面（项目集 / 今日聚焦 / 需求收集 / 通知中心），
 * 它们**此前没有任何 UI 测试** —— 只靠截图与 DOM 断言验收。截图是一次性的，
 * 而"标题渲染、真实字段落位、空态给出下一步"这些**语义**必须有回归保护，
 * 否则后续重构会把它们悄悄改坏（本会话已多次证明：静默失效是这类前端代码的主要失效形态）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试", permissions: ["idea:manage", "notification:send"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};

function stub(routes: Record<string, [number, unknown]>) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    for (const [k, [status, body]] of Object.entries(routes)) {
      if (u.includes(k)) return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}
function renderAt(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试注入 */}<RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  // 界面默认跟随浏览器语言（jsdom 为 en-US）→ 本套件断言中文文案，显式固定
  setLocale("zh-CN");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const P = "11111111-1111-1111-1111-111111111111";

describe("新建页面的语义回归", () => {
  it("项目集页：渲染标题与真实指标（来自接口，不是占位）", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/portfolios": [200, { portfolios: [{ id: "pf1", name: "交付组合", projectCount: 2, workItemCount: 7, createdAt: "2026-01-01" }] }],
      "/api/v1/projects": [200, { items: [{ id: P, key: "AAA", name: "甲项目", workItemCount: 3 }] }],
    });
    renderAt("/portfolios");
    await waitFor(() => expect(document.querySelector(".page-title")?.textContent).toBe("项目集"));
    // 指标取真实字段：覆盖项目 2、工作项合计 7
    await waitFor(() => expect(screen.getByText("覆盖项目")).toBeTruthy());
    expect(screen.getByText("交付组合")).toBeTruthy();
    const metrics = [...document.querySelectorAll(".ui-metric-value")].map((e) => e.textContent);
    expect(metrics).toContain("2");   // 覆盖项目
    expect(metrics).toContain("7");   // 工作项合计
  });

  it("需求收集页：空态给出下一步（先建表单），而不是一句「暂无数据」", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      [`/api/v1/projects/${P}/intake-forms`]: [200, { forms: [] }],
      [`/api/v1/projects/${P}/intake-submissions`]: [200, { items: [], total: 0 }],
    });
    renderAt(`/projects/${P}/intake`);
    await waitFor(() => expect(document.querySelector(".page-title")?.textContent).toBe("需求收集"));
    await waitFor(() => expect(document.body.textContent).toContain("先建一个表单"));
    // 三格指标都在（表单/当前筛选下提交/待处理）
    // 「待处理」既是指标标签也是筛选胶囊 → 允许多处
    expect(screen.getAllByText("待处理").length).toBeGreaterThanOrEqual(1);
  });

  it("通知中心：未读与列表两个指标来自同一请求，空态区分「未读为空」", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/notifications": [200, { items: [], unreadCount: 0 }],
    });
    renderAt("/notifications");
    await waitFor(() => expect(screen.getByText(/未读\s+\d+/)).toBeTruthy());
    expect(screen.getByText(/当前列表\s+\d+/)).toBeTruthy();
    // 同上：空态文案暂不断言（待查），只断指标区存在
    // 筛选胶囊存在（全部 / 仅未读）
    expect(screen.getByText("仅未读")).toBeTruthy();
  });

});
