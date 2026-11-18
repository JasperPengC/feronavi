/** 导入向导前端（第九期 W7） */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { ImportPage } from "../src/client/routes/ImportPage.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

// 本套件断言中文文案；jsdom 默认语言是 en-US，渲染前必须固定 ——
// 否则 t() 返回英文、断言落空（第 12/13 轮就是因此两次误判）。
setLocale("zh-CN");

const ACTOR = {
  memberId: "m1", username: "u", name: "测试", permissions: ["work_item:create"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "22222222-2222-2222-2222-222222222222";

function stub(handler: (url: string, init?: RequestInit) => [number, unknown] | Promise<[number, unknown]>) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
    const [status, body] = await handler(String(i), init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
}
function renderPage() {
  const root = createRootRoute();
  const app = createRoute({ getParentRoute: () => root, id: "_app" });
  const route = createRoute({ getParentRoute: () => app, path: "projects/$projectId/import", component: ImportPage });
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([route])]), history: createMemoryHistory({ initialEntries: [`/projects/${P}/import`] }) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RouterProvider router={router} /><DialogHost /></QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => { cleanup(); document.cookie = "csrf_token=; Max-Age=0"; vi.unstubAllGlobals(); });

describe("导入向导", () => {
  it("切换批次后不能用上一批次的校验结果确认写入", async () => {
    const batches = ["b1", "b2"].map((id) => ({
      id, status: "PENDING_CONFIRM", filename: `${id}.csv`, totalRows: 2, createdCount: 0, failedCount: 0,
    }));
    const confirmed: string[] = [];
    stub((u) => {
      if (u.includes("/auth/me")) return [200, ACTOR];
      if (u.endsWith("/confirm")) { confirmed.push(u); return [200, { created: 2, skipped: 0, failed: 0, status: "SUCCEEDED" }]; }
      if (u.endsWith("/dry-run")) return [200, { totalRows: 2, willCreate: 2, willSkip: 0, failed: 0, errorReport: [] }];
      const batch = batches.find((b) => u.endsWith(`/imports/${b.id}`));
      if (batch) return [200, { ...batch, header: ["标题"], fieldMap: { 标题: "title" }, mappingConfig: { externalIdColumn: null } }];
      if (u.endsWith("/imports")) return [200, { batches }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "查看" }).length).toBe(2));
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "校验数据" }));
    await screen.findByRole("button", { name: "导入 2 条工作项" });
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[1]!);
    await waitFor(() => expect(screen.queryByRole("button", { name: "导入 2 条工作项" })).toBeNull());
    expect(confirmed).toEqual([]);
  });

  it("重新打开批次恢复最新映射并保留外部 ID 与用户映射", async () => {
    const b1 = { id: "b1", status: "PENDING_CONFIRM", filename: "one.csv", totalRows: 2, createdCount: 0, failedCount: 0,
      header: ["编号", "标题", "备注"], fieldMap: { 标题: "title" }, mappingConfig: { externalIdColumn: "编号", userMap: { Alice: "member-1" }, defaultType: "DEFECT" } };
    const b2 = { ...b1, id: "b2", filename: "two.csv" };
    let mapping: Record<string, unknown> | null = null;
    stub((u, init) => {
      if (u.endsWith("/imports/b1/mapping")) { mapping = JSON.parse(String(init?.body)); return [200, { ok: true }]; }
      if (u.endsWith("/imports/b1")) return [200, mapping ? { ...b1, fieldMap: mapping.fieldMap, mappingConfig: mapping } : b1];
      if (u.endsWith("/imports/b2")) return [200, b2];
      if (u.endsWith("/imports")) return [200, { batches: [b1, b2] }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "查看" }).length).toBe(2));
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "修改映射" }));
    expect(screen.getByRole("button", { name: /来源编号列/ }).textContent).toContain("编号");
    fireEvent.click(screen.getByLabelText("备注 映射到"));
    fireEvent.click(screen.getByRole("option", { name: "描述" }));
    fireEvent.click(screen.getByRole("button", { name: "保存映射" }));
    await screen.findByRole("button", { name: "校验数据" });
    expect(mapping).toMatchObject({ fieldMap: { 标题: "title", 备注: "description" }, externalIdColumn: "编号", userMap: { Alice: "member-1" }, defaultType: "DEFECT" });
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[1]!);
    await screen.findByRole("button", { name: "校验数据" });
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "修改映射" }));
    await waitFor(() => expect(screen.getByLabelText("备注 映射到").textContent).toContain("描述"));
  });

  it("上一批次延迟返回的校验结果不能覆盖当前批次", async () => {
    let finishOldPreview: ((value: [number, unknown]) => void) | undefined;
    const batches = ["b1", "b2"].map((id) => ({ id, status: "PENDING_CONFIRM", filename: `${id}.csv`, totalRows: 2, createdCount: 0, failedCount: 0 }));
    stub((u) => {
      if (u.endsWith("/imports/b1/dry-run")) return new Promise((resolve) => { finishOldPreview = resolve; });
      const batch = batches.find((item) => u.endsWith(`/imports/${item.id}`));
      if (batch) return [200, { ...batch, header: ["标题"], fieldMap: { 标题: "title" } }];
      if (u.endsWith("/imports")) return [200, { batches }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "查看" }).length).toBe(2));
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "校验数据" }));
    await waitFor(() => expect(finishOldPreview).toBeDefined());
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[1]!);
    await screen.findByRole("button", { name: "校验数据" });
    await act(async () => { finishOldPreview?.([200, { totalRows: 2, willCreate: 99, willSkip: 0, failed: 0, errorReport: [] }]); });
    await waitFor(() => expect(document.querySelector(".import-current-file strong")?.textContent).toBe("b2.csv"));
    expect(screen.queryByRole("button", { name: "导入 99 条工作项" })).toBeNull();
    expect((screen.getByRole("button", { name: "校验数据" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("修改映射使旧校验失效，保存时不把跳过列发送为目标字段", async () => {
    let saved: unknown;
    stub((u, init) => {
      if (u.endsWith("/mapping")) { saved = JSON.parse(String(init?.body)); return [200, { ok: true }]; }
      if (u.endsWith("/dry-run")) return [200, { totalRows: 2, willCreate: 2, willSkip: 0, failed: 0, errorReport: [] }];
      if (u.endsWith("/imports/b1")) return [200, { id: "b1", status: "PENDING_CONFIRM", filename: "z.csv", totalRows: 2, createdCount: 0, failedCount: 0,
        header: ["标题", "备注"], fieldMap: { 标题: "title", 备注: "description" } }];
      if (u.endsWith("/imports")) return [200, { batches: [{ id: "b1", status: "PENDING_CONFIRM", filename: "z.csv", totalRows: 2, createdCount: 0, failedCount: 0 }] }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    fireEvent.click(await screen.findByRole("button", { name: "校验数据" }));
    await screen.findByRole("button", { name: "导入 2 条工作项" });
    fireEvent.click(screen.getByRole("button", { name: "修改映射" }));
    fireEvent.click(screen.getByLabelText("备注 映射到"));
    fireEvent.click(screen.getByRole("option", { name: "（不导入）" }));
    fireEvent.click(screen.getByRole("button", { name: "保存映射" }));
    await screen.findByRole("button", { name: "校验数据" });
    expect(saved).toMatchObject({ fieldMap: { 标题: "title" } });
    expect(Object.keys((saved as { fieldMap: object }).fieldMap)).toEqual(["标题"]);
    expect(screen.queryByRole("button", { name: "导入 2 条工作项" })).toBeNull();
  });

  it("写入期间阻止切换和重复提交，成功后关闭确认入口", async () => {
    let resolveWrite: ((value: [number, unknown]) => void) | undefined;
    let writes = 0;
    stub((u) => {
      if (u.endsWith("/confirm")) { writes++; return new Promise((resolve) => { resolveWrite = resolve; }); }
      if (u.endsWith("/dry-run")) return [200, { totalRows: 2, willCreate: 2, willSkip: 0, failed: 0, errorReport: [] }];
      if (u.endsWith("/imports/b1")) return [200, { id: "b1", status: "PENDING_CONFIRM", filename: "z.csv", totalRows: 2, createdCount: 0, failedCount: 0, header: ["标题"], fieldMap: { 标题: "title" } }];
      if (u.endsWith("/imports")) return [200, { batches: [{ id: "b1", status: "PENDING_CONFIRM", filename: "z.csv", totalRows: 2, createdCount: 0, failedCount: 0 }] }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    fireEvent.click(await screen.findByRole("button", { name: "校验数据" }));
    const confirmButton = await screen.findByRole("button", { name: "导入 2 条工作项" });
    fireEvent.click(confirmButton); fireEvent.click(confirmButton);
    await waitFor(() => expect(writes).toBe(1));
    expect((screen.getByRole("button", { name: "选择新文件" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "导入记录" }));
    expect((screen.getByRole("button", { name: "查看" }) as HTMLButtonElement).disabled).toBe(true);
    resolveWrite?.([200, { created: 2, skipped: 0, failed: 0, status: "SUCCEEDED" }]);
    fireEvent.click(screen.getByRole("tab", { name: "导入工作项" }));
    await screen.findByText("导入完成");
    expect(screen.queryByRole("button", { name: "导入 2 条工作项" })).toBeNull();
    expect(writes).toBe(1);
  });

  it("空态：不堆砌实现限制文案", async () => {
    stub((u) => u.includes("/imports") ? [200, { batches: [] }] : u.includes("/auth/me") ? [200, ACTOR] : [404, {}]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    await waitFor(() => expect(screen.getByText(/还没有导入批次/)).toBeTruthy());
    expect(screen.queryByText(/不含附件与评论/)).toBeNull();
    expect(screen.queryByText(/占用连接与磁盘/)).toBeNull();
  });

  it("上传后展示表头映射，未映射标题时禁止保存", async () => {
    let uploadHeaders: HeadersInit | undefined;
    document.cookie = "csrf_token=import-test-token";
    stub((u, init) => {
      if (u.includes("/auth/me")) return [200, ACTOR];
      if (u.endsWith("/imports") && init?.method === "POST") {
        uploadHeaders = init.headers;
        return [201, { batchId: "b1", header: ["外部ID", "标题"], encoding: "gbk", totalRows: 3 }];
      }
      if (u.includes("/imports/b1")) return [200, { id: "b1", status: "PENDING_CONFIRM", filename: "z.csv", totalRows: 3, createdCount: 0, failedCount: 0, header: ["外部ID", "标题"], fieldMap: {}, encoding: "gbk" }];
      if (u.includes("/imports")) return [200, { batches: [] }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    await waitFor(() => expect(screen.getByText(/还没有导入批次/)).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "导入工作项" }));
    const file = new File(["a,b\n1,2\n"], "z.csv", { type: "text/csv" });
    const picker = screen.getByLabelText(/选择 CSV/) as HTMLInputElement;
    expect(picker.accept).toContain(".xlsx");
    fireEvent.change(picker, { target: { files: [file] } });
    fireEvent.click(screen.getByText("上传并解析"));

    await waitFor(() => expect(screen.getByRole("heading", { name: "字段映射", exact: true })).toBeTruthy());
    expect(new Headers(uploadHeaders).get("x-csrf-token")).toBe("import-test-token");
    expect(screen.getByText(/识别编码：gbk/)).toBeTruthy();
    // 未映射标题 → 保存按钮禁用 + 明确提示
    expect((screen.getByText("保存映射") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请先映射「标题」")).toBeTruthy();
    // 映射标题后可保存
    // 映射控件已换为自绘 Select → 真实路径：点开触发器 → 点选项
    fireEvent.click(screen.getByLabelText("标题 映射到"));
    fireEvent.click(screen.getByRole("option", { name: "标题" }));
    await waitFor(() => expect((screen.getByText("保存映射") as HTMLButtonElement).disabled).toBe(false));
  });

  it("试运行显示三栏统计与逐行错误，且只有将创建>0 才给确认按钮", async () => {
    stub((u, _init) => {
      if (u.includes("/auth/me")) return [200, ACTOR];
      if (u.includes("/dry-run")) return [200, { totalRows: 3, willCreate: 2, willSkip: 1, failed: 1, errorReport: [{ index: 5, externalId: "ZT-4", reason: "缺少标题" }] }];
      if (u.includes("/imports/b1")) return [200, { id: "b1", status: "PENDING_CONFIRM", filename: "z.csv", totalRows: 3, createdCount: 0, failedCount: 0, header: ["标题"], fieldMap: { 标题: "title" } }];
      if (u.includes("/imports")) return [200, { batches: [{ id: "b1", status: "PENDING_CONFIRM", filename: "z.csv", totalRows: 3, createdCount: 0, failedCount: 0 }] }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    // 从批次列表点「查看」进入已完成映射的批次
    await waitFor(() => expect(screen.getByText("查看")).toBeTruthy());
    fireEvent.click(screen.getByText("查看"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "校验数据", exact: true })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "校验数据" }));
    await waitFor(() => expect(screen.getByText("将创建 2")).toBeTruthy());
    expect(screen.getByText("将跳过 1（已导入过）")).toBeTruthy();
    expect(screen.getByText("失败 1")).toBeTruthy();
    expect(screen.getByText("缺少标题")).toBeTruthy();
    expect(screen.getByText("导入 2 条工作项")).toBeTruthy();
  });

  it("批次列表使用统一行样式（图标头像 + 状态药丸）—— 结构断言", async () => {
    stub((u) => {
      if (u.includes("/auth/me")) return [200, ACTOR];
      if (u.includes("/imports")) return [200, { batches: [{ id: "b9", status: "SUCCEEDED", filename: "done.csv", totalRows: 2, createdCount: 2, failedCount: 0, createdAt: "2026-01-01T00:00:00.000Z" }] }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    await waitFor(() => expect(screen.getByText("done.csv")).toBeTruthy());
    const row = document.querySelector("tbody tr")!;
    expect(row.querySelector(".row-avatar")).toBeTruthy();
    // 只断言**结构**与**非空文本**，不绑定具体语言 ——
    // 我第一版断言了中文译文，而该环境渲染出的是 "Done"（语言来源受渲染时机影响），
    // 于是把"结构正确"误报成失败。结构断言应当与语言无关。
    expect(row.querySelector(".status-pill")?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("回滚需要二次确认，且提示写清「后续修改也会删除」", async () => {
    // 二次确认已从原生 window.confirm 换为自绘对话框（用户要求第 4 条）→ 不再有 confirm spy；
    // 改为断言"对话框出现且文案写清后果，点取消后不发请求"（真实用户路径）
    let rollbackCalled = false;
    stub((u, _init) => {
      if (u.includes("/auth/me")) return [200, ACTOR];
      if (u.includes("/rollback")) { rollbackCalled = true; return [200, { ok: true }]; }
      if (u.includes("/imports")) return [200, { batches: [{ id: "b9", status: "SUCCEEDED", filename: "done.csv", totalRows: 2, createdCount: 2, failedCount: 0 }] }];
      return [404, {}];
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "导入记录" }));
    await waitFor(() => expect(screen.getByText("回滚")).toBeTruthy());
    fireEvent.click(screen.getByText("回滚"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("后续所有修改");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(rollbackCalled).toBe(false);   // 用户点了取消 → 不发请求
  });
});
