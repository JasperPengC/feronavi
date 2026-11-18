/**
 * 第四期前端测试（W5-D11 失效映射 + W6-D13 配置界面）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

// 本套件断言中文文案；jsdom 默认语言是 en-US，渲染前必须固定 ——
// 否则 t() 返回英文、断言全部落空（第 12 轮就是因此误判为"组件有问题"）。
setLocale("zh-CN");
import { invalidateFor } from "../src/client/lib/useEvents.ts";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const P = "11111111-1111-1111-1111-111111111111";
const ACTOR = {
  memberId: "m1", username: "u", name: "测试",
  permissions: ["work_item:manage_workflow", "work_item:read_any"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ code: "NOT_FOUND", message: "x", details: null }), { status: 404, headers: { "content-type": "application/json" } });
  });
}

// ── D11 失效映射 ─────────────────────────────────────────────
describe("业务事件失效映射", () => {
  it("workitem.changed 标记真实详情、看板和工作台缓存失效", () => {
    const qc = new QueryClient();
    const keys = [["work-item-detail", "w1"], ["board", "p1"], ["workbench"]];
    for (const key of keys) qc.setQueryData(key, {});
    invalidateFor(qc, "workitem.changed", { id: "w1" });
    for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    qc.clear();
  });

  it("notification.new 先更新缓存中的 unreadCount", () => {
    const qc = new QueryClient();
    qc.setQueryData(["notifications"], { items: [], unreadCount: 2 });
    invalidateFor(qc, "notification.new", { unreadCount: 5 });
    expect(qc.getQueryData(["notifications"])).toMatchObject({ unreadCount: 5 });
    qc.clear();
  });

  it("comment.created 失效评论与活动", () => {
    const qc = new QueryClient();
    const keys = [["comments", "WORK_ITEM", "w1"], ["project-activity", "p1"]];
    for (const key of keys) qc.setQueryData(key, {});
    invalidateFor(qc, "comment.created", { id: "c1", targetType: "WORK_ITEM", targetId: "w1" });
    for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    qc.clear();
  });
});

// ── D13 工作流配置界面 ───────────────────────────────────────
describe("工作流配置页", () => {
  it("渲染状态列表与流转（含添加流转表单）", async () => {
    vi.stubGlobal("fetch", mockFetch({
      "/api/v1/auth/me": ACTOR,
      // ⚠️ 精确 pattern 必须排在宽 pattern 前：mockFetch 按 includes 首个命中返回
      "/api/v1/workflows/wf1/states": [
        { id: "s1", key: "TODO", name: "待办", category: "NOT_STARTED", color: "#71717a" },
        { id: "s2", key: "DONE", name: "完成", category: "TERMINAL", color: "#047857" },
      ],
      "/api/v1/workflows/wf1/transitions": [{ id: "t1", fromStateId: "s1", toStateId: "s2" }],
      "/api/v1/workflows": [{ id: "wf1", name: "任务流", appliesToType: "TASK", isDefault: true }],
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/workflow`] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error test */}<RouterProvider router={router} /></QueryClientProvider>);
    // 侧栏/标签等多处可能出现同名文本，一律容许多匹配
    await waitFor(() => expect(screen.getAllByText("待办").length).toBeGreaterThan(0));
    expect(screen.getAllByText("完成").length).toBeGreaterThan(0);
    // 出边列表：完整文本「待办 → 完成」（读屏可懂，不靠连线）。
    // ⚠️ 文本被拆成多元素（名称与箭头是不同节点），按 textContent 判定
    expect(document.body.textContent).toMatch(/待办\s*→\s*完成/u);
    // 添加流转表单存在
    expect(screen.getByText("添加流转")).toBeTruthy();
    // 状态分类中文标注（下拉选项里也有同名词，容许多匹配）
    // 类别文案现在位于自绘 Select 的**展开面板**里（原生 <option> 已移除，自绘组件只在展开时渲染选项）
    // → 按真实用户路径：先点开「状态」下拉，再断言选项存在（预期变更，非产品退化）
    fireEvent.click(screen.getByLabelText("状态"));
    expect(screen.getAllByRole("option", { name: "未开始" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("终态").length).toBeGreaterThan(0);
  });

  it("空态", async () => {
    vi.stubGlobal("fetch", mockFetch({
      "/api/v1/auth/me": ACTOR,
      "/api/v1/workflows": [],
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/workflow`] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error test */}<RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("工作流配置")).toBeTruthy());
  });
});
