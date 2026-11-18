/**
 * 第三期 UI 渲染测试：表格视图 / 通知铃铛 / 评论面板
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { CommentsPanel } from "../src/client/routes/CommentsPanel.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试",
  permissions: ["work_item:read_any", "comment:create"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) {
          return new Response(JSON.stringify(body), {
          status: body === null ? 403 : 200, headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ code: "NOT_FOUND", message: "未打桩", details: null }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  });
}

function renderAt(path: string, routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", mockFetch(routes));
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {/* @ts-expect-error 测试里 router 类型与注册表不完全一致，运行时等价 */}
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const P = "11111111-1111-1111-1111-111111111111";

describe("表格视图", () => {
  it("渲染列头与行", async () => {
    const { container } = renderAt(`/projects/${P}/table`, {
      "/api/v1/auth/me": ACTOR,
      "view=table": {
        rows: [
          { id: "w1", number: 1, key: "DEMO-1", title: "登录页", type: "TASK", priority: "HIGH", dueDate: null, version: 1 },
          { id: "w2", number: 2, key: "DEMO-2", title: "过期任务", type: "DEFECT", priority: null, dueDate: "2020-01-01", version: 1 },
        ],
        total: 2, page: 1, pageSize: 20,
      },
    });
    await waitFor(() => expect(screen.getByText("登录页")).toBeTruthy());
    expect(screen.getByText("DEMO-1")).toBeTruthy();
    expect(screen.getByText("过期任务")).toBeTruthy();
    // 逾期徽标：图标 + 文字
    expect(screen.getByTitle("已逾期")).toBeTruthy();
    // 窄屏以字段卡片呈现，每个值保留可读的列名。
    expect(container.querySelector(".table-view-surface")).not.toBeNull();
    expect(container.querySelectorAll(".table-view-table tbody td[data-label]")).toHaveLength(4);
    // 分页信息
    expect(screen.getByText(/共 2 条/)).toBeTruthy();
  });

  it("空态", async () => {
    renderAt(`/projects/${P}/table`, {
      "/api/v1/auth/me": ACTOR,
      "view=table": { rows: [], total: 0, page: 1, pageSize: 20 },
    });
    await waitFor(() => expect(screen.getByText("没有工作项")).toBeTruthy());
  });
});

describe("保存视图", () => {
  it("保存当前视图发 POST（viewType=TABLE + 当前筛选），保存成功后提示", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body });
      if (url.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (url.includes("view=table")) {
        return new Response(JSON.stringify({
          rows: [{ id: "w1", number: 1, key: "DEMO-1", title: "登录页", type: "TASK", priority: "HIGH", dueDate: null, version: 1 }],
          total: 1, page: 1, pageSize: 20,
        }), { status: 200 });
      }
      if (url.includes("/saved-views") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "sv-new", name: "高优先", scope: "PERSONAL", filters: {} }), { status: 201 });
      }
      if (url.includes("projectId=")) {
        return new Response(JSON.stringify([{ id: "sv-shared", name: "项目高优先", scope: "PROJECT_SHARED", filters: { prioF: "HIGH" } }]), { status: 200 });
      }
      if (url.includes("/saved-views")) return new Response(JSON.stringify([]), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/table`] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("登录页")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "保存当前视图" }));
    fireEvent.change(screen.getByLabelText("视图名称"), { target: { value: "高优先" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("视图已保存")).toBeTruthy());
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/saved-views"));
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post!.body))).toMatchObject({ name: "高优先", viewType: "TABLE", scope: "PERSONAL" });
  });
});

describe("移动端导航抽屉", () => {
  it("按 Escape 时关闭抽屉", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 1024px)", addEventListener() {}, removeEventListener() {},
    }));
    renderAt("/projects", {
      "/api/v1/auth/me": ACTOR,
      "/api/v1/projects": { items: [], page: 1, pageSize: 20, total: 0 },
      "/api/v1/notifications": { items: [], unreadCount: 0 },
    });

    await waitFor(() => expect(document.querySelector(".shell-menu-button")).toBeTruthy());
    fireEvent.click(document.querySelector(".shell-menu-button")!);
    expect(document.querySelector(".shell-sidebar")?.getAttribute("data-open")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".shell-sidebar")?.getAttribute("data-open")).toBe("false"));
  });
});

describe("通知铃铛", () => {
  it("未读数出现在 aria-label 与徽标里", async () => {
    renderAt("/projects", {
      "/api/v1/auth/me": ACTOR,
      "/api/v1/notifications": {
        items: [
          { id: "n1", type: "work_item.assigned", category: "ASSIGN", title: "你被指派了", body: "DEMO-1", link: null, readAt: null, itemCount: 1, createdAt: "2026-10-14T00:00:00Z" },
        ],
        unreadCount: 3,
      },
      "/api/v1/projects": { items: [], page: 1, pageSize: 20, total: 0 },
    });
    // 预期变更：顶栏按用户要求改为「纯头像 + 展开菜单」，通知铃**收进菜单**（默认收起）
    // → 先展开账户菜单，再断言铃铛
    // 头像按钮依赖 actor 加载（异步）→ 先等它出现再点
    await waitFor(() => expect(screen.getByRole("button", { name: /账户菜单|Account menu/u })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /账户菜单|Account menu/u }));
    await waitFor(() => {
      const bell = screen.getByRole("button", { name: /通知.*3.*未读/u });
      expect(bell).toBeTruthy();
    });
  });

  it("聚合通知显示 ×N", async () => {
    renderAt("/projects", {
      "/api/v1/auth/me": ACTOR,
      "/api/v1/notifications": {
        items: [
          { id: "n2", type: "work_item.field_changed", category: "FIELD_CHANGE", title: "字段变更", body: "优先级", link: null, readAt: "2026-10-14T00:00:00Z", itemCount: 4, createdAt: "2026-10-14T00:00:00Z" },
        ],
        unreadCount: 0,
      },
      "/api/v1/projects": { items: [], page: 1, pageSize: 20, total: 0 },
    });
    // 预期变更：铃铛现在收在**账户菜单**里（默认收起）→ 先展开账户菜单，再点开铃铛
    // 头像按钮依赖 actor 加载（异步）→ 先等它出现再点
    await waitFor(() => expect(screen.getByRole("button", { name: /账户菜单|Account menu/u })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /账户菜单|Account menu/u }));
    await waitFor(() => expect(screen.getByRole("button", { name: /通知/u })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /通知/u }));
    await waitFor(() => expect(screen.getAllByText(/×4/).length).toBeGreaterThan(0));
  });
});

describe("评论面板", () => {
  const WI = "22222222-2222-2222-2222-222222222222";

  it("渲染顶层评论并高亮 @提及", async () => {
    // ⚠️ stub 必须在 render 之前：组件挂载即发请求，后 stub 拿到的是 404 → 空列表
    vi.stubGlobal("fetch", mockFetch({
      "/comments": [
        { id: "c1", targetType: "WORK_ITEM", targetId: WI, authorId: "m1", body: "请看 @user1 的修改", parentId: null, editedAt: null, createdAt: "2026-10-14T00:00:00Z" },
      ],
    }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommentsPanel targetType="WORK_ITEM" targetId={WI} />
    </QueryClientProvider>);
    // ⚠️ 直接等 strong（提及高亮）出现 —— 正文与 strong 是两次 commit,
    //    等「请看」通过时 strong 可能还没 commit（实测踩到）
    await waitFor(() => {
      const strongs = [...document.querySelectorAll("strong")].map((e) => e.textContent);
      expect(strongs).toContain("@user1");
    });
    vi.unstubAllGlobals();
  });

  it("空态与回复按钮只出现在顶层", async () => {
    vi.stubGlobal("fetch", mockFetch({
      "/comments": [
        { id: "c1", targetType: "WORK_ITEM", targetId: WI, authorId: "m1", body: "顶层", parentId: null, editedAt: null, createdAt: "2026-10-14T00:00:00Z" },
        { id: "c2", targetType: "WORK_ITEM", targetId: WI, authorId: "m2", body: "回复", parentId: "c1", editedAt: null, createdAt: "2026-10-14T00:00:00Z" },
      ],
    }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommentsPanel targetType="WORK_ITEM" targetId={WI} />
    </QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("顶层")).toBeTruthy());
    // 顶层有「回复」按钮；正文里那条叫"回复"的评论不应被误认为按钮
    const replyBtns = [...document.querySelectorAll("button")].filter((b) => b.textContent === "回复");
    expect(replyBtns.length).toBe(1);
    vi.unstubAllGlobals();
  });
});
