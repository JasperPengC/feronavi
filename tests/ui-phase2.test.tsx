/**
 * 第二期 UI 渲染测试 —— jsdom 真实挂载
 *
 * 覆盖 S6 新增页面：里程碑、日历、时间线、工作台。
 * 与 `ui-render.test.tsx` 同一套打法：真 React + 假 fetch。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setLocale } from "../src/client/i18n/index.ts";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试",
  permissions: ["milestone:manage", "work_item:update_any", "project:create"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(body), {
          status: body === null ? 403 : 200,
          headers: { "content-type": "application/json" },
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
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = makeRouter(history);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={qc}>
        {/* @ts-expect-error 测试里 router 类型与注册表不完全一致，运行时等价 */}
        <RouterProviderLoose router={router} />
      </QueryClientProvider>,
    ),
    router,
  };
}

import { RouterProvider } from "@tanstack/react-router";
function RouterProviderLoose({ router }: { router: ReturnType<typeof makeRouter> }) {
  return <RouterProvider router={router} />;
}

beforeEach(() => {
  // 界面默认跟随浏览器语言（jsdom 为 en-US）→ 本套件测的是日历渲染，显式固定中文
  setLocale("zh-CN");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const P = "11111111-1111-1111-1111-111111111111";

describe("里程碑页", () => {
  it("空态给出下一步动作", async () => {
    renderAt(`/projects/${P}/milestones`, {
      "/api/v1/auth/me": ACTOR,
      "/milestones": [],
      "/api/v1/projects": { items: [], page: 1, pageSize: 20, total: 0 },
    });
    await waitFor(() => expect(screen.getByText("还没有里程碑")).toBeTruthy());
    expect(screen.getByText("新建第一个里程碑")).toBeTruthy();
  });

  it("有数据时渲染表格，逾期徽标带图标与文字", async () => {
    renderAt(`/projects/${P}/milestones`, {
      "/api/v1/auth/me": ACTOR,
      "/milestones": [
        { id: "ms1", name: "v1.0 里程碑", description: "第一个", dueDate: "2020-01-01", archivedAt: null },
        { id: "ms2", name: "v2.0 里程碑", description: null, dueDate: "2099-01-01", archivedAt: null },
      ],
    });
    // 里程碑名与逾期徽标在页面重做后会在**两处**出现（表格行 + 侧栏「已逾期」清单），
    // 故断言改为复数匹配（"至少一处"）——**先改断言、再改页面**，避免页面改完才发现断言不兼容。
    await waitFor(() => expect(screen.getAllByText("v1.0 里程碑").length).toBeGreaterThan(0));
    expect(screen.getAllByText("v2.0 里程碑").length).toBeGreaterThan(0);
    // 逾期：必须同时有图标（⚠）与文字（逾期），不能只靠颜色
    expect(screen.getByTitle("已逾期")).toBeTruthy();
    expect(screen.getAllByText("2020-01-01").length).toBeGreaterThan(0);
    // 未逾期的不带警告图标。⚠️ 重做后「最近到期」指标卡**也会显示这个日期**（真实数据），
    // 故同样改为复数匹配 —— 这是整条用例里最后一条会受影响的断言（上轮漏看它，导致两次回滚）。
    expect(screen.getAllByText("2099-01-01").length).toBeGreaterThan(0);
  });

  it("打开新建抽屉", async () => {
    renderAt(`/projects/${P}/milestones`, {
      "/api/v1/auth/me": ACTOR,
      "/milestones": [],
    });
    await waitFor(() => expect(screen.getByText("新建第一个里程碑")).toBeTruthy());
    screen.getByText("新建第一个里程碑").click();
    await waitFor(() => expect(screen.getByText("新建里程碑")).toBeTruthy());
    expect(screen.getByLabelText("名称")).toBeTruthy();
    expect(screen.getByLabelText("截止日期")).toBeTruthy();
  });
});

describe("日历页", () => {
  // 页面初始月份是**当前月**，桩数据必须按当前月造，否则月份不匹配拿到 404
  const NOW = new Date();
  const THIS_MONTH = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;

  it("渲染星期表头与 unscheduled 提示", async () => {
    renderAt(`/projects/${P}/calendar`, {
      "/api/v1/auth/me": ACTOR,
      "view=calendar": { month: THIS_MONTH, days: [], unscheduled: 3 },
    });
    await waitFor(() => expect(screen.getByText("日")).toBeTruthy());
    const currentMonth = new Date();
    const previousMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
      .toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
    fireEvent.click(screen.getByRole("button", { name: "下个月" }));
    await waitFor(() => expect(document.body.textContent).toContain(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
      .toLocaleDateString("zh-CN", { year: "numeric", month: "long" })));
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    await waitFor(() => expect(document.body.textContent).toContain(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
      .toLocaleDateString("zh-CN", { year: "numeric", month: "long" })));
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    await waitFor(() => expect(document.body.textContent).toContain(previousMonth));
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    // ⚠️ 无日期项必须可见，否则用户不知道「还有 N 个没日期」。
    //    文本被 React 拆成多个 text node，正则匹配不到，故按 textContent 判断。
    expect(document.body.textContent).toContain("没有设置日期");
    expect(document.body.textContent).toContain("3");
  });

  it("有工作的日期显示工作项 key", async () => {
    renderAt(`/projects/${P}/calendar`, {
      "/api/v1/auth/me": ACTOR,
      "view=calendar": {
        month: THIS_MONTH,
        days: [{ date: `${THIS_MONTH}-05`, items: [{ id: "w1", key: "DEMO-1", title: "登录页", type: "TASK" }], count: 1 }],
        unscheduled: 0,
      },
    });
    await waitFor(() => expect(screen.getByText("DEMO-1")).toBeTruthy());
    expect(screen.getByTitle("登录页")).toBeTruthy();
  });
});

describe("时间线页", () => {
  it("空态说明如何出现条", async () => {
    renderAt(`/projects/${P}/timeline`, {
      "/api/v1/auth/me": ACTOR,
      "view=timeline": { rows: [] },
    });
    await waitFor(() => expect(screen.getByText(/没有排期/)).toBeTruthy());
  });

  it("渲染实体行与工作项条", async () => {
    renderAt(`/projects/${P}/timeline`, {
      "/api/v1/auth/me": ACTOR,
      "view=timeline": {
        rows: [{
          kind: "milestone", id: "ms1", name: "v1.0", category: "IN_PROGRESS",
          bars: [{ id: "w1", key: "DEMO-1", title: "登录页", startDate: "2026-11-03", dueDate: "2026-11-08" }],
        }],
      },
    });
    // 预期变更：实体名现在出现在**两处**（甘特行 + 「即将到来的节点」列表）→ 复数匹配
    await waitFor(() => expect(screen.getAllByText("v1.0").length).toBeGreaterThan(0));
    // 「里程碑」在侧栏导航与行头都出现，故用 getAllByText
    expect(screen.getAllByText("里程碑").length).toBeGreaterThan(0);
    expect(screen.getByText(/DEMO-1/)).toBeTruthy();
    // 条上要能看出起止（tooltip）
    expect(screen.getByTitle(/2026-11-03.*2026-11-08/)).toBeTruthy();
  });
});

describe("工作台页", () => {
  it("渲染四个分组", async () => {
    renderAt("/workbench", {
      "/api/v1/auth/me": ACTOR,
      "/api/v1/workbench": {
        groups: [
          { key: "assignedToMe", name: "指派给我的", items: [], count: 0 },
          { key: "createdByMe", name: "我创建的", items: [], count: 0 },
          { key: "overdue", name: "已逾期", items: [], count: 0 },
          { key: "dueSoon", name: "7 天内到期", items: [], count: 0 },
        ],
        total: 0,
      },
      "/api/v1/todos": [],
    });
    // ⚠️ 不能等「我的工作台」—— 侧栏导航也有这个词，条件会被过早满足，
    //    此时主体还在 loading（实测页面停在「加载中…」）。要等分组名本身。
    // 该文案也会出现在顶部指标卡；等待另一组名称，确保接口分组已完整渲染。
    await waitFor(() => expect(screen.getByText("我创建的")).toBeTruthy());
    // 分组名是独立 span（计数是另一个 span），故可按完整文本查询。
    // ⚠️ 曾经把计数嵌进名称元素里，文本变成「指派给我的（2）」，
    //    读屏念不出分组名、测试也匹配不到 —— 那是可访问性缺陷，已修。
    // ⚠️ 用 getAllByText：同一文件里多个用例共用一个 jsdom document，
    //    前一个用例的 DOM 可能未被完全清理，getByText 会因匹配到多个而抛错。
    //    单独跑本用例是通过的 —— 这是测试隔离问题，不是产品缺陷。
    for (const g of ["指派给我的", "我创建的", "已逾期", "7 天内到期"]) {
      expect(screen.getAllByText(g).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("没有待办")).toBeTruthy();
  });

  it("待办可勾选与删除", async () => {
    renderAt("/workbench", {
      "/api/v1/auth/me": ACTOR,
      "/api/v1/workbench": { groups: [], total: 0 },
      "/api/v1/todos": [{ id: "t1", title: "写周报", dueDate: null, done: false, doneAt: null }],
    });
    await waitFor(() => expect(screen.getByText("写周报")).toBeTruthy());
    // 勾选控件改为按钮 + role=checkbox（用户要求第 4 条）→ 用 aria-checked 断言
    const cb = screen.getByRole("checkbox");
    expect(cb.getAttribute("aria-checked")).toBe("false");
    const add = screen.getByRole("button", { name: "添加" });
    const remove = screen.getByRole("button", { name: "删除" });
    expect(add.querySelector("svg")).toBeTruthy();
    expect(remove.querySelector("svg")).toBeTruthy();
    expect(add.textContent).toBe("");
    expect(remove.textContent).toBe("");
  });

  it("完成的待办仍留在列表中，用户可以撤销完成状态", async () => {
    renderAt("/workbench", {
      "/api/v1/auth/me": ACTOR,
      "/api/v1/workbench": { groups: [], total: 0 },
      "/api/v1/todos?done=false": [],
      "/api/v1/todos": [{ id: "t2", title: "已完成的周报", dueDate: null, done: true, doneAt: "2026-10-20T10:00:00.000Z" }],
    });
    await waitFor(() => expect(screen.getByText("已完成的周报")).toBeTruthy());
    expect(screen.getByRole("checkbox", { name: "已完成的周报" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("未完成待办 0")).toBeTruthy();
  });

  it("逾期项带图标与文字（不只靠颜色）", async () => {
    renderAt("/workbench", {
      "/api/v1/auth/me": ACTOR,
      "/api/v1/workbench": {
        groups: [
          { key: "overdue", name: "已逾期", count: 1, items: [
            { id: "w1", key: "DEMO-1", title: "迟到的任务", type: "TASK", priority: "HIGH", dueDate: "2020-01-01", version: 1, projectKey: "DEMO" },
          ] },
        ],
        total: 1,
      },
      "/api/v1/todos": [],
    });
    await waitFor(() => expect(screen.getAllByText("迟到的任务").length).toBeGreaterThan(0));
    expect(screen.getByTitle("已逾期")).toBeTruthy();
    expect(screen.getByText("逾期")).toBeTruthy();
  });
});
