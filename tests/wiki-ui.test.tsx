/** Wiki 页（第十二期）：树与标记、乐观锁提示、版本回滚、受限页授权 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { t, setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试",
  permissions: ["page:create", "page:update_any", "page:manage_visibility", "page:manage_permission"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "77777777-7777-7777-7777-777777777777";
const calls: string[] = [];

function stub(handlers: Record<string, [number, unknown]>) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
    const u = String(i);
    calls.push(`${init?.method ?? "GET"} ${u.replace("http://localhost", "")}`);
    for (const [k, [status, body]] of Object.entries(handlers)) {
      if (u.includes(k)) return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}
function renderPage(search = "") {
  const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/wiki${search}`] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>), qc, router };
}
beforeEach(() => {
  setLocale("zh-CN");
  calls.length = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = "csrf_token=; Max-Age=0; path=/"; });

const PAGES = { pages: [
  { id: "p1", title: "公开文档", slug: "pub", parentId: null, visibility: "PROJECT", sortOrder: 0, currentRevisionId: "r2" },
  { id: "p2", title: "受限文档", slug: "sec", parentId: null, visibility: "RESTRICTED", sortOrder: 0, currentRevisionId: "r1" },
] };
const DETAIL = { id: "p2", title: "受限文档", slug: "sec", parentId: null, visibility: "RESTRICTED",
  sortOrder: 0, currentRevisionId: "r1", content: "机密正文", revisionNo: 1, changeSummary: null };

describe("Wiki 页", () => {
  it("权限保存遇到过期 CSRF 会刷新令牌并完成授权", async () => {
    document.cookie = "csrf_token=expired; path=/";
    let permissions: unknown[] = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path.endsWith("/auth/me")) return json(ACTOR);
      if (path.endsWith("/auth/csrf")) return json({ csrfToken: "fresh" });
      if (path === `/api/v1/projects/${P}/pages`) return json(PAGES);
      if (path === `/api/v1/projects/${P}/members`) return json({ members: [{ id: "m9", name: "鲍勃" }] });
      if (path.endsWith("/pages/p2/revisions")) return json({ revisions: [] });
      if (path.endsWith("/pages/p2/permissions")) {
        if (init?.method === "PUT") {
          if (new Headers(init.headers).get("x-csrf-token") !== "fresh") return json({ message: "Invalid CSRF token" }, 403);
          permissions = JSON.parse(String(init.body)).permissions;
        }
        return json({ permissions });
      }
      if (path.endsWith("/pages/p2")) return json(DETAIL);
      return json({}, 404);
    });
    renderPage("?page=p2");
    fireEvent.click(await screen.findByRole("button", { name: t("wk.access") }));
    fireEvent.click(await screen.findByRole("button", { name: t("wiki.memberLabel") }));
    fireEvent.click(await screen.findByRole("option", { name: "鲍勃" }));
    fireEvent.click(screen.getByRole("button", { name: t("wk.grant"), exact: true }));
    await screen.findByRole("button", { name: t("wk.revoke") }, { timeout: 1500 });
    expect(permissions).toEqual([{ principalType: "MEMBER", principalId: "m9", canRead: true, canWrite: false }]);
  });

  it("目录读取失败不伪装成空目录，重试后恢复文档", async () => {
    let offline = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/auth/me")) return new Response(JSON.stringify(ACTOR));
      if (path.includes(`/projects/${P}/pages`)) return new Response(JSON.stringify(offline ? { code: "INTERNAL", message: "网络故障" } : PAGES), { status: offline ? 503 : 200 });
      if (path.endsWith("/pages/p2")) return new Response(JSON.stringify(DETAIL));
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await screen.findByText(t("wk.directoryFailed"));
    expect(screen.queryByText(t("wk.empty"))).toBeNull();
    offline = false;
    fireEvent.click(screen.getByRole("button", { name: t("common.reload") }));
    await screen.findByText("公开文档");
  });

  it.each([[503, "wk.loadFailed"], [403, "wk.notVisible"], [404, "wk.notFound"]])("详情错误 %s 保留真实原因并允许重试", async (status, key) => {
    stub({ "/auth/me": [200, ACTOR], [`/projects/${P}/pages`]: [200, PAGES],
      "/pages/p2/revisions": [200, { revisions: [] }],
      "/pages/p2": [status as number, { code: "INTERNAL", message: "请求失败" }],
    });
    renderPage("?page=p2");
    await screen.findByText(t(key as string));
    expect(screen.getByRole("button", { name: t("common.reload") })).toBeTruthy();
    if (status !== 403) expect(screen.queryByText(t("wk.notVisible"))).toBeNull();
  });

  const readableDetail = { ...DETAIL, id: "p1", title: "公开文档", visibility: "PROJECT", content: "# 发布指南\n\n先备份数据库。" };
  function stubReadablePages() {
    stub({
      "/auth/me": [200, ACTOR], [`/projects/${P}/pages`]: [200, PAGES],
      [`/projects/${P}/members`]: [200, { members: [] }],
      "/pages/p1/revisions": [200, { revisions: [] }],
      "/pages/p2/revisions": [200, { revisions: [] }],
      "/pages/p2/permissions": [200, { permissions: [] }],
      "/pages/p1": [200, readableDetail], "/pages/p2": [200, DETAIL],
    });
  }

  it("默认阅读 Markdown，显式进入编辑后才展示标题和正文输入框", async () => {
    stubReadablePages();
    renderPage();
    await screen.findByRole("heading", { name: "发布指南" });
    expect(screen.queryByRole("textbox", { name: "文档正文" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "文档标题" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect((screen.getByRole("textbox", { name: "文档正文" }) as HTMLTextAreaElement).value).toContain("# 发布指南");
  });

  it("搜索命中的文档链接打开指定文档，而不是目录中的第一篇", async () => {
    stubReadablePages();
    renderPage("?page=p2");
    await screen.findByText("机密正文");
    expect(screen.queryByRole("heading", { name: "发布指南" })).toBeNull();
  });

  it("切换文档前保护未保存的草稿，取消后仍能继续编辑", async () => {
    stubReadablePages();
    renderPage();
    await screen.findByRole("button", { name: "编辑" });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "文档正文" }), { target: { value: "未保存的新步骤" } });
    fireEvent.click(screen.getAllByText("受限文档")[0]!);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    expect((screen.getByRole("textbox", { name: "文档正文" }) as HTMLTextAreaElement).value).toBe("未保存的新步骤");
    fireEvent.click(screen.getAllByText("受限文档")[0]!);
    fireEvent.click(await screen.findByRole("button", { name: t("common.confirm"), exact: true }));
    await screen.findByText("机密正文");
    expect(screen.queryByRole("textbox", { name: "文档正文" })).toBeNull();
  });

  it("后台重新获取文档不会覆盖未保存内容，保存仍使用开始编辑时的版本", async () => {
    stubReadablePages();
    const { qc } = renderPage();
    await screen.findByRole("button", { name: "编辑" });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "文档正文" }), { target: { value: "我的修改" } });
    qc.setQueryData(["wiki-page", "p1"], { ...readableDetail, currentRevisionId: "r9", content: "其他人的新版本" });
    await waitFor(() => expect((screen.getByRole("textbox", { name: "文档正文" }) as HTMLTextAreaElement).value).toBe("我的修改"));
    fireEvent.click(screen.getByRole("button", { name: t("wk.saveChanges") }));
    await waitFor(() => {
      const saveCall = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).includes("/pages/p1") && init?.method === "PATCH");
      expect(saveCall).toBeTruthy();
      expect(JSON.parse(String(saveCall![1]!.body))).toMatchObject({ content: "我的修改", expectedRevisionId: "r1" });
    });
  });

  it("离开文档工作区前拦截未保存修改，取消保留原路由", async () => {
    stubReadablePages();
    const { router } = renderPage();
    await screen.findByRole("button", { name: "编辑" });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "文档正文" }), { target: { value: "尚未提交的正文" } });
    fireEvent.click(screen.getByRole("link", { name: "← 项目" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${P}/wiki`));
    expect((screen.getByRole("textbox", { name: "文档正文" }) as HTMLTextAreaElement).value).toBe("尚未提交的正文");
  });

  it("保存等待期间锁定草稿与选页，并从不含正文的保存响应恢复正确阅读内容", async () => {
    stubReadablePages();
    let resolveSave: (response: Response) => void = () => {};
    let persisted = false;
    const previousFetch = fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/pages/p1") && init?.method === "PATCH") {
        return new Promise<Response>((resolve) => { resolveSave = resolve; });
      }
      if (path.endsWith("/pages/p1") && persisted) {
        return new Response(JSON.stringify({ ...readableDetail, content: "已保存的发布步骤", revisionNo: 2, currentRevisionId: "r2" }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return previousFetch(input, init);
    }));
    const { router } = renderPage();
    await screen.findByRole("button", { name: "编辑" });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "文档正文" }), { target: { value: "已保存的发布步骤" } });
    fireEvent.click(screen.getByRole("button", { name: t("wk.saveChanges") }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "文档正文" }) as HTMLTextAreaElement).disabled).toBe(true));
    expect((screen.getByRole("textbox", { name: "文档标题" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "新建", exact: true }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByText("受限文档")[0]!);
    fireEvent.click(screen.getByRole("link", { name: "← 项目" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.state.location.pathname).toBe(`/projects/${P}/wiki`);
    expect((screen.getByRole("textbox", { name: "文档标题" }) as HTMLInputElement).value).toBe("公开文档");
    persisted = true;
    const { content: _content, changeSummary: _summary, ...metadata } = readableDetail;
    resolveSave(new Response(JSON.stringify({ ...metadata, revisionNo: 2, currentRevisionId: "r2" }),
      { status: 200, headers: { "content-type": "application/json" } }));
    await screen.findByText("已保存的发布步骤");
    expect(screen.queryByRole("textbox", { name: "文档正文" })).toBeNull();
    expect(screen.getByRole("heading", { name: "公开文档" })).toBeTruthy();
  });

  it("标题检索返回子文档时，即使父文档未匹配也能选择结果", async () => {
    stubReadablePages();
    renderPage();
    await screen.findByRole("button", { name: "编辑" });
    const previousFetch = fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(`/projects/${P}/pages?q=`)) {
        return new Response(JSON.stringify({ pages: [{ ...PAGES.pages[0], id: "child", parentId: "not-matched", title: "部署步骤" }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return previousFetch(input, init);
    }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索文档" }), { target: { value: "部署" } });
    await screen.findByText("部署步骤");
  });

  it("树上给受限页明确标记（否则用户以为文档丢了）", async () => {
    stub({ "/auth/me": [200, ACTOR], [`/projects/${P}/pages`]: [200, PAGES], [`/projects/${P}/members`]: [200, { members: [] }] });
    renderPage();
    await waitFor(() => expect(screen.getByText("公开文档")).toBeTruthy());
    expect(screen.getByText("受限")).toBeTruthy();
  });

  it("编辑详情：显示版本号与正文，保存走 PATCH", async () => {
    stub({
      "/auth/me": [200, ACTOR], [`/projects/${P}/pages`]: [200, PAGES],
      [`/projects/${P}/members`]: [200, { members: [] }],
      "/pages/p2/revisions": [200, { revisions: [
        { id: "r1", revisionNo: 1, changeSummary: "创建", authorId: "m1", createdAt: new Date().toISOString() },
      ] }],
      "/pages/p2/permissions": [200, { permissions: [] }],
      "/pages/p2": [200, DETAIL],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("受限文档")).toBeTruthy());
    fireEvent.click(screen.getAllByText("受限文档")[0]!);
    await screen.findByText("机密正文");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() => expect((screen.getByLabelText("文档正文") as HTMLTextAreaElement).value).toBe("机密正文"));
    expect(screen.getAllByText("第 1 版").length).toBeGreaterThan(0);   // 版本徽标与历史行都有
    fireEvent.change(screen.getByLabelText("文档正文"), { target: { value: "更新后的机密正文" } });
    fireEvent.click(screen.getByRole("button", { name: /保存修改|wk.saveChanges/ }));
    await waitFor(() => expect(calls.some((c) => c.startsWith("PATCH") && c.includes("/pages/p2"))).toBe(true));
  });

  it("乐观锁冲突给出可读提示，而不是静默覆盖", async () => {
    stub({
      "/auth/me": [200, ACTOR], [`/projects/${P}/pages`]: [200, PAGES],
      [`/projects/${P}/members`]: [200, { members: [] }],
      "/pages/p2/revisions": [200, { revisions: [] }],
      "/pages/p2/permissions": [200, { permissions: [] }],
      "/pages/p2": [200, DETAIL],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("受限文档")).toBeTruthy());
    // 覆盖 fetch：PATCH 返回 VERSION_CONFLICT
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes("/pages/p2") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ code: "VERSION_CONFLICT", message: "该文档已被他人修改，请刷新后重试", details: null }),
          { status: 409, headers: { "content-type": "application/json" } });
      }
      if (u.includes("/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes(`/projects/${P}/pages`)) return new Response(JSON.stringify(PAGES), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/revisions")) return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/permissions")) return new Response(JSON.stringify({ permissions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/members")) return new Response(JSON.stringify({ members: [] }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/pages/p2")) return new Response(JSON.stringify(DETAIL), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    fireEvent.click(screen.getAllByText("受限文档")[0]!);
    await screen.findByText("机密正文");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() => expect(screen.getByLabelText("文档正文")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("文档正文"), { target: { value: "更新后的机密正文" } });
    fireEvent.click(screen.getByRole("button", { name: /保存修改|wk.saveChanges/ }));
    await waitFor(() => expect(screen.getByText(/已被他人修改/)).toBeTruthy());
    expect(screen.getAllByText(/重新载入/).length).toBeGreaterThan(0);
  });

  it("受限页展示授权面板，说明必须保留可读主体，并可授予成员", async () => {
    stub({
      "/auth/me": [200, ACTOR], [`/projects/${P}/pages`]: [200, PAGES],
      [`/projects/${P}/members`]: [200, { members: [{ id: "m9", username: "bob", name: "鲍勃", role_key: "MEMBER", role_name: "成员" }] }],
      "/pages/p2/revisions": [200, { revisions: [] }],
      "/pages/p2/permissions": [200, { permissions: [{ principalType: "MEMBER", principalId: "m9", canRead: true, canWrite: false }] }],
      "/pages/p2": [200, DETAIL],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("受限文档")).toBeTruthy());
    fireEvent.click(screen.getAllByText("受限文档")[0]!);
    fireEvent.click(await screen.findByRole("button", { name: /可见性与授权|wk.access/ }));
    await waitFor(() => expect(screen.getByText("页面授权（受限页）")).toBeTruthy());
    expect(screen.getByText(/至少需保留一项查看授权/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/鲍勃/).length).toBeGreaterThan(0));
    expect(screen.getByText("移除")).toBeTruthy();
  });

  it("显示当前页索引与真实切片状态，并执行检索、引用问答和重建", async () => {
    const p1 = { ...PAGES.pages[0]!, content: "备份数据库与密钥", revisionNo: 2, changeSummary: "更新" };
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      let body: unknown = {};
      if (url.includes("/auth/me")) body = ACTOR;
      else if (url.includes(`/projects/${P}/pages`)) body = { pages: [PAGES.pages[0]] };
      else if (url.includes(`/projects/${P}/members`)) body = { members: [] };
      else if (url.includes("/pages/p1/revisions")) body = { revisions: [] };
      else if (url.includes("/pages/p1/chunks")) body = {
        generation: 4, revisionId: "r2", chunks: [{ id: "c1", headingPath: "运维 > 备份", content: "备份数据库与密钥。", tokenCount: 12, createdAt: "2026-10-21T00:00:00.000Z", hasVector: true }],
      };
      else if (url.includes("/pages/p1/index-jobs")) body = { jobs: [{ id: "j1", status: "SUCCEEDED", total: 1, processed: 1, failed: 0, errorMessage: null, createdAt: "2026-10-21T00:00:00.000Z" }] };
      else if (url.includes("/knowledge/ai-status")) body = { configured: true, model: "test-model" };
      else if (url.includes("/knowledge/search")) body = { mode: "vector", hits: [{ pageId: "p1", title: "公开文档", headingPath: "运维 > 备份", snippet: "备份数据库与密钥。" }] };
      else if (url.includes("/knowledge/ask")) body = { ok: true, answer: "同时备份数据库和密钥。", mode: "vector", citations: [{ pageId: "p1", title: "公开文档", headingPath: "运维 > 备份", snippet: "备份数据库与密钥。" }] };
      else if (url.includes("/pages/p1/reindex")) body = { jobId: "j2", total: 1, inserted: 1, failed: 0 };
      else if (url.includes("/pages/p1")) body = p1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));

    renderPage();
    await screen.findByText("备份数据库与密钥");

    fireEvent.click(screen.getByRole("button", { name: "知识库" }));
    await waitFor(() => expect(document.querySelector(".knowledge-panel")).toBeTruthy());
    const knowledgePanel = document.querySelector(".knowledge-panel");
    expect(knowledgePanel?.closest(".wiki-layout")).toBeTruthy();
    expect(knowledgePanel?.parentElement?.classList.contains("wiki-rag-column")).toBe(true);
    expect(document.querySelector(".wiki-layout .wiki-recent-panel")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "知识库" })).toBeTruthy();

    const preview = await screen.findByRole("button", { name: /kn\.chunkPreview|切片预览|文本切片/ });
    fireEvent.click(preview);
    await waitFor(() => expect(screen.getByText("运维 > 备份")).toBeTruthy());
    expect(screen.getByText("备份数据库与密钥。")).toBeTruthy();
    expect(screen.getByText(/kn\.hasVector|已向量化/)).toBeTruthy();

    const searchInput = screen.getByLabelText("知识检索");
    fireEvent.change(searchInput, { target: { value: "备份密钥" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    await waitFor(() => expect(calls.some((call) => call.includes("/knowledge/search?q=%E5%A4%87%E4%BB%BD%E5%AF%86%E9%92%A5"))).toBe(true));
    expect(screen.getAllByText("公开文档").length).toBeGreaterThan(1);

    const askInput = screen.getByLabelText("知识问答");
    fireEvent.change(askInput, { target: { value: "要备份什么？" } });
    fireEvent.keyDown(askInput, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("同时备份数据库和密钥。")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /kn\.reindex|重建索引/ }));
    await waitFor(() => expect(calls.some((call) => call.startsWith("POST") && call.includes("/pages/p1/reindex"))).toBe(true));
  });
});
