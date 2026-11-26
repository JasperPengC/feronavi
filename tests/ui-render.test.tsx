/**
 * UI 渲染测试 —— 在 jsdom 里**真实挂载 React 应用**
 *
 * 为什么需要它：`scripts/e2e-spa.ts` 只验证了「SPA 被正确托管」，
 * 那是「服务器把文件发出去了」，不等于「组件渲染得出来」。
 * 这里用真实 React 挂载 + 假 fetch，断言关键 DOM 结构出现。
 *
 * ⚠️ 覆盖不到的部分（诚实标注）：拖拽的实际手感、真实浏览器布局、
 *    CSS 生效情况 —— 那些只能人工在浏览器里点。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setLocale } from "../src/client/i18n/index.ts";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

/** 用假 fetch 替代真实后端 —— 测试只关心「给定数据能不能渲染出来」 */
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
  const fetchMock = mockFetch(routes);
  vi.stubGlobal("fetch", fetchMock);
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = makeRouter(history);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      {/* @ts-expect-error 测试里 router 类型与注册表不完全一致，运行时等价 */}
      <RouterProviderLoose router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, fetchMock };
}

/** 单独包一层，避免在测试文件里 import 整个 router 模块的副作用 */
import { RouterProvider } from "@tanstack/react-router";
function RouterProviderLoose({ router }: { router: ReturnType<typeof makeRouter> }) {
  return <RouterProvider router={router} />;
}

beforeEach(() => {
  // ⚠️ 未登录页默认跟随**浏览器语言**（jsdom 是 en-US）→ 这些用例测的是登录/找回逻辑，显式固定中文
  setLocale("zh-CN");
  // jsdom 没有 matchMedia，index.html 的内联主题脚本会用到；这里补一个空实现
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("安装向导", () => {
  it("渲染 6 步进度与第 1 步自检结果", async () => {
    renderAt("/setup", {
      "/api/v1/setup/state": { initialized: false, currentStep: null },
      "/api/v1/setup/precheck": {
        items: [
          { key: "database", ok: true, message: "数据库连通" },
          { key: "dataDir", ok: true, message: "数据目录可写（/data）" },
          { key: "timezone", ok: true, message: "时区 Asia/Shanghai" },
          { key: "version", ok: true, message: "0.1.0" },
        ],
        ok: true,
      },
    });
    await waitFor(() => expect(document.body.textContent).toMatch(/1\. (环境自检|Environment check)/));
    expect(await screen.findByText("数据库连通")).toBeTruthy();
    expect(screen.getByText(/数据目录可写/)).toBeTruthy();
    // 6 步进度条：应出现 6 个圆点
    expect(screen.getAllByTitle(/环境自检|数据库|管理员账号|组织信息|可选集成|完成|Environment check|Database|Admin account|Organisation|Optional integrations|Done/i).length).toBe(6);
    // 第 1 步「上一步」必须禁用（无处可回）
    expect(screen.getByRole("button", { name: "上一步" })).toHaveProperty("disabled", true);
  });

  it("自检有失败项时禁用「下一步」", async () => {
    renderAt("/setup", {
      "/api/v1/setup/state": { initialized: false, currentStep: null },
      "/api/v1/setup/precheck": {
        items: [{ key: "dataDir", ok: false, message: "数据目录不可写：/data" }],
        ok: false,
      },
    });
    await waitFor(() => expect(document.body.textContent).toMatch(/(数据目录不可写|data directory is not writable)/i));
    expect(screen.getByRole("button", { name: "下一步" })).toHaveProperty("disabled", true);
  });

  it("数据目录可展开且复制的是完整原始路径", async () => {
    const path = "/srv/非常长的部署目录/organization/attachments-and-secrets/data";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
    renderAt("/setup", {
      "/api/v1/setup/state": { initialized: false },
      "/api/v1/setup/precheck": { items: [{ key: "dataDir", ok: true, path, message: `数据目录可写（${path}）` }] },
    });
    const expand = await screen.findByRole("button", { name: "查看完整路径" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(await screen.findByText(path)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制路径" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(path));
    expect(await screen.findByText("已复制")).toBeTruthy();
  });

  it("复制目录失败时展示完整路径供手动选择并保留不可写状态", async () => {
    const path = "/srv/private/data";
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
    renderAt("/setup", {
      "/api/v1/setup/state": { initialized: false },
      "/api/v1/setup/precheck": { items: [{ key: "dataDir", ok: false, path, message: `数据目录不可写：${path}` }] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "复制路径" }));
    expect(await screen.findByText("复制失败，请手动选择文本")).toBeTruthy();
    expect(screen.getByText(path)).toBeTruthy();
    expect(screen.getByText("不可写")).toBeTruthy();
    expect(screen.getByRole("button", { name: "下一步" })).toHaveProperty("disabled", true);
  });

  it("已初始化时在安装向导挂载前转到登录，不请求预检接口", async () => {
    const { fetchMock, router } = renderAt("/setup", {
      "/api/v1/setup/state": { initialized: true, passwordResetEnabled: false },
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls.some((url) => url.includes("/api/v1/setup/precheck"))).toBe(false);
  });
});

describe("登录页", () => {
  it("渲染登录标题、账号密码和记住我控件", async () => {
    renderAt("/login", {});
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "登录", exact: true })).toBeTruthy());
    expect(screen.getByLabelText(/用户名/)).toBeTruthy();
    expect(screen.getByLabelText(/密码/)).toBeTruthy();
    expect(screen.getByText(/记住我/)).toBeTruthy();
  });
});

describe("项目列表", () => {
  it("空态给出「下一步做什么」", async () => {
    renderAt("/projects", {
      "/api/v1/auth/me": {
        memberId: "m1", username: "u", name: "测试", permissions: ["project:create"],
        dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
        locale: "zh-CN", timezone: "Asia/Shanghai",
      },
      "/api/v1/projects": { items: [], page: 1, pageSize: 20, total: 0 },
    });
    await waitFor(() => expect(screen.getByText("还没有项目")).toBeTruthy());
    expect(screen.getByText("新建第一个项目")).toBeTruthy();
  });

  it("有数据时渲染表格与状态文字（不只靠颜色）", async () => {
    renderAt("/projects", {
      "/api/v1/auth/me": {
        memberId: "m1", username: "u", name: "测试", permissions: ["project:create"],
        dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
        locale: "zh-CN", timezone: "Asia/Shanghai",
      },
      "/api/v1/projects": {
        items: [{
          id: "p1", key: "DEMO", name: "演示项目", description: null,
          status: { key: "ACTIVE", name: "进行中", category: "IN_PROGRESS", color: "info" },
          archivedAt: null, workItemCount: 3,
        }],
        page: 1, pageSize: 20, total: 1,
      },
    });
    await waitFor(() => expect(screen.getByText("演示项目")).toBeTruthy());
    expect(screen.getByText("DEMO")).toBeTruthy();
    // 状态必须同时有圆点与**文字**（色盲要求）
    // 预期变更：状态名现在出现在**两处**（筛选栏标签 + 行内药丸）→ 复数匹配；
    // 断言"至少一处"仍守住"状态不只靠颜色、必须有文字"这条要求。
    expect(screen.getAllByText("进行中").length).toBeGreaterThan(0);
    // 行必须能进项目：断言**存在指向看板的链接**（旧断言写死"打开看板"文案，
    // 换成紧凑按钮后就失效了 —— 断言应盯语义而不是某个词的写法）
    const boardLinks = document.querySelectorAll('a[href*="/board"]');
    expect(boardLinks.length).toBeGreaterThanOrEqual(1);
    // 预期变更：行内操作已改为 **icon 按钮**（照原型），文字不再渲染 ——
    // 改为断言**可访问名称**（图标按钮的语义由 aria-label 承担，这样更严格，也守住无障碍）
    expect(screen.getByRole("link", { name: "打开" })).toBeTruthy();
  });

  it("无 project:create 权限时不显示「新建项目」", async () => {
    renderAt("/projects", {
      "/api/v1/auth/me": {
        memberId: "m1", username: "u", name: "只读", permissions: [],
        dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
        locale: "zh-CN", timezone: "Asia/Shanghai",
      },
      "/api/v1/projects": { items: [], page: 1, pageSize: 20, total: 0 },
    });
    await waitFor(() => expect(screen.getByText("还没有项目")).toBeTruthy());
    expect(screen.queryByText("新建项目")).toBeNull();
    expect(screen.queryByText("新建第一个项目")).toBeNull();
  });
});

describe("看板", () => {
  it("按列渲染、空列也出现、大列给加载更多", async () => {
    renderAt("/projects/p1/board", {
      "/api/v1/auth/me": {
        memberId: "m1", username: "u", name: "测试", permissions: ["work_item:transition"],
        dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
        locale: "zh-CN", timezone: "Asia/Shanghai",
      },
      "/api/v1/projects/p1/work-items/board": {
        columns: [
          { stateKey: "TODO", name: "待办", category: "NOT_STARTED", color: "neutral",
            items: [{ id: "w1", key: "DEMO-1", number: 1, title: "第一个工作项", priority: "HIGH", assigneeId: null, version: 1 }],
            count: 3, truncated: true },
          { stateKey: "DONE", name: "已完成", category: "TERMINAL", color: "success",
            items: [], count: 0, truncated: false },
        ],
        total: 3,
      },
      "/api/v1/projects/p1": { id: "p1", key: "DEMO", name: "演示项目" },
    });
    await waitFor(() => expect(screen.getByText("演示项目")).toBeTruthy());
    expect(screen.getByText("待办")).toBeTruthy();
    expect(screen.getByText("DEMO-1")).toBeTruthy();
    expect(screen.getByText("第一个工作项")).toBeTruthy();
    expect(screen.getByText('高').getAttribute('data-kind')).toBe('priority');
    expect(screen.getByText('高').getAttribute('data-tone')).toBe('warning');
    // 空列必须出现（用户要看到「这一列现在是空的」，而不是那一列消失）
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("暂无工作项")).toBeTruthy();
    // 列内超限时给出剩余条数
    expect(screen.getByText("加载更多（还有 2 条）")).toBeTruthy();
  });
});
