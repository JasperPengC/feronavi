import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const actor = {
  memberId: "m1", username: "admin", name: "管理员", permissions: ["setting:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};

type RequestCall = { method: string; path: string; body?: unknown };
type FakeRoute = [number, unknown] | ((call: RequestCall) => Response | Promise<Response>);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stub(routes: Record<string, FakeRoute> = {}, permissions = actor.permissions) {
  const calls: RequestCall[] = [];
  const defaults: Record<string, FakeRoute> = {
    "GET /api/v1/auth/me": [200, { ...actor, permissions }],
    "GET /api/v1/system/status": [200, { ok: true, version: "1.0.0" }],
    "GET /api/v1/system/migrations": [200, { applied: 1, files: 1, consistent: true, latestAppliedAt: null, externalDatabase: false, upgradeFlow: [], notes: [] }],
    "GET /api/v1/knowledge/ai-status": [200, { configured: false, dimensionOk: true }],
    "GET /api/v1/auth/2fa": [200, { enabled: false, pending: false }],
    "GET /api/v1/system/operations": [403, { code: "FORBIDDEN", message: "无权限" }],
    "GET /api/v1/system/ipgeo": [403, { code: "FORBIDDEN", message: "无权限" }],
    "GET /api/v1/system/update-check": [403, { code: "FORBIDDEN", message: "无权限" }],
    "GET /api/v1/system/backups": [200, { backups: [] }],
    "GET /api/v1/system/restores/current": [200, null],
    "POST /api/v1/system/backups/preflight": [200, safeEstimate],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    const call = { method, path: url.pathname, body };
    calls.push(call);
    const match = Object.entries({ ...defaults, ...routes }).find(([key]) => {
      const split = key.indexOf(" ");
      const expectedMethod = key.slice(0, split);
      const expectedPath = key.slice(split + 1);
      return method === expectedMethod && (expectedPath.endsWith("*")
        ? url.pathname.startsWith(expectedPath.slice(0, -1))
        : url.pathname === expectedPath);
    });
    if (!match) return json(404, { code: "NOT_FOUND", message: "未找到" });
    const route = match[1];
    return typeof route === "function" ? route(call) : json(route[0], route[1]);
  }));
  return calls;
}

function renderSystemPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/system"] }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}>
    {/* @ts-expect-error 测试用 */}<RouterProvider router={router} />
  </QueryClientProvider>);
  return { ...view, queryClient };
}

async function openDataTab() {
  await waitFor(() => expect(screen.getAllByText("系统自检").length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("tab", { name: "数据" }));
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const safeEstimate = {
  mode: "safe" as const,
  datasets: [{ name: "organization", rows: 2 }, { name: "member", rows: 4 }],
  totalRows: 6,
  blobCount: 2,
  blobBytes: 1_048_576,
  excludedData: [{ key: "session", reason: "登录会话始终不迁移" }],
  warnings: [],
};
const fullEstimate = {
  ...safeEstimate,
  mode: "full" as const,
  datasets: [...safeEstimate.datasets, { name: "integration_secret", rows: 3 }],
  totalRows: 9,
  excludedData: [...safeEstimate.excludedData, { key: "jobs", reason: "任务始终不迁移" }],
  warnings: ["完整迁移包含敏感凭据，请仅在可信环境使用"],
};
const backupId = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";
const backup = (overrides: Record<string, unknown> = {}) => ({
  id: backupId,
  mode: "safe" as const,
  status: "SUCCEEDED" as const,
  failureCode: null,
  bytes: 2_048,
  manifestSummary: null,
  downloadsRemaining: 3,
  expiresAt: "2026-12-10T00:00:00.000Z",
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  ...overrides,
});

describe("系统数据备份面板", () => {
  it("管理员在数据页看到系统数据备份与恢复入口", async () => {
    stub();
    renderSystemPage();
    await openDataTab();

    expect(await screen.findByRole("heading", { name: "系统数据备份与恢复" })).toBeTruthy();
  });

  it("默认以安全迁移显示逐项估算、排除项、记录数和附件体积", async () => {
    stub();
    renderSystemPage();
    await openDataTab();

    expect(await screen.findByText("organization")).toBeTruthy();
    expect(screen.getByText("member")).toBeTruthy();
    expect(screen.getByText("登录会话始终不迁移")).toBeTruthy();
    expect(screen.getByText("1,048,576 字节")).toBeTruthy();
    expect(screen.getByText("安全迁移")).toBeTruthy();
    expect(screen.getByText("6 条")).toBeTruthy();
    expect(screen.getByText("2 个")).toBeTruthy();
  });

  it("切换完整模式会重新估算并隐藏上一个模式的估算", async () => {
    let resolveFull!: (response: Response) => void;
    const fullResponse = new Promise<Response>((resolve) => { resolveFull = resolve; });
    const calls = stub({
      "POST /api/v1/system/backups/preflight": ({ body }) => body && (body as { mode: string }).mode === "full"
        ? fullResponse
        : json(200, safeEstimate),
    });
    renderSystemPage();
    await openDataTab();
    expect(await screen.findByText("organization")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "备份模式" }));
    fireEvent.click(screen.getByRole("option", { name: "加密完整迁移" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "/api/v1/system/backups/preflight")).toHaveLength(2));
    expect(screen.queryByText("organization")).toBeNull();
    expect(screen.getByText("正在估算…")).toBeTruthy();
    resolveFull(json(200, fullEstimate));
    expect(await screen.findByText("integration_secret")).toBeTruthy();
    expect(screen.getByText("任务始终不迁移")).toBeTruthy();
    expect(screen.getByText("加密完整迁移")).toBeTruthy();
  });

  it("创建完整迁移时校验长度、确认密码和高风险确认，并在请求结束清除凭据", async () => {
    const calls = stub({
      "POST /api/v1/system/backups/preflight": ({ body }) => json(200, body && (body as { mode: string }).mode === "full" ? fullEstimate : safeEstimate),
      "POST /api/v1/system/backups": [201, { id: backupId, status: "PENDING" }],
    });
    const { queryClient } = renderSystemPage();
    await openDataTab();
    await screen.findByText("organization");
    fireEvent.click(screen.getByRole("button", { name: "备份模式" }));
    fireEvent.click(screen.getByRole("option", { name: "加密完整迁移" }));
    await screen.findByText("integration_secret");
    const submit = screen.getByRole("button", { name: "创建加密备份" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "我已了解完整模式会迁移敏感凭据" }));
    fireEvent.change(screen.getByLabelText("独立迁移密码"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("确认迁移密码"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("当前管理员密码"), { target: { value: "Admin-password-123" } });
    fireEvent.click(submit);
    expect(await screen.findByText("迁移密码必须为 12 至 256 个字符")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("独立迁移密码"), { target: { value: "Migration-secret-123" } });
    fireEvent.change(screen.getByLabelText("确认迁移密码"), { target: { value: "Migration-secret-456" } });
    fireEvent.click(submit);
    expect(await screen.findByText("两次输入的迁移密码不一致")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("确认迁移密码"), { target: { value: "Migration-secret-123" } });
    fireEvent.change(screen.getByLabelText("动态验证码（可选）"), { target: { value: "123456" } });
    fireEvent.click(submit);
    await screen.findByText("备份任务已提交");
    const request = calls.find((call) => call.method === "POST" && call.path === "/api/v1/system/backups");
    expect(request?.body).toEqual({
      mode: "full",
      migrationPassword: "Migration-secret-123",
      currentPassword: "Admin-password-123",
      totpCode: "123456",
    });
    expect((screen.getByLabelText("独立迁移密码") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("确认迁移密码") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("当前管理员密码") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("动态验证码（可选）") as HTMLInputElement).value).toBe("");
    const cached = JSON.stringify(queryClient.getQueryCache().getAll().map((query) => ({ key: query.queryKey, data: query.state.data })));
    expect(cached).not.toContain("Migration-secret-123");
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain("Admin-password-123");
  });

  it("成功备份显示到期和剩余下载次数，并禁用到期或耗尽的下载", async () => {
    const calls = stub({
      "GET /api/v1/system/backups": [200, { backups: [
        backup(),
        backup({ id: "33333333-3333-4333-8333-333333333333", downloadsRemaining: 0 }),
        backup({ id: "44444444-4444-4444-8444-444444444444", expiresAt: "2026-11-13T00:00:00.000Z" }),
        backup({ id: "55555555-5555-4555-8555-555555555555", status: "PENDING", bytes: null }),
      ] }],
      "GET /api/v1/system/backups/*/download": () => new Response(new Blob(["fnbak"]), { status: 200 }),
      "DELETE /api/v1/system/backups/*": () => new Response(null, { status: 204 }),
    });
    renderSystemPage();
    await openDataTab();

    const downloads = await screen.findAllByRole("button", { name: "下载备份包" });
    expect(downloads).toHaveLength(3);
    expect(downloads[0]!.disabled).toBe(false);
    expect(downloads[1]!.disabled).toBe(true);
    expect(downloads[2]!.disabled).toBe(true);
    expect(document.body.textContent).toContain("剩余下载次数：3");
    expect(document.body.textContent).toContain("已过期");

    fireEvent.click(downloads[0]!);
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/download"))).toBe(true));
    const deleteButton = screen.getAllByRole("button", { name: /删除备份/ })[0]!;
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.path === `/api/v1/system/backups/${backupId}`)).toBe(true));
  });

  it("失败备份历史显示固定脱敏说明", async () => {
    stub({
      "GET /api/v1/system/backups": [200, { backups: [
        backup({ status: "FAILED", failureCode: "INSUFFICIENT_STORAGE" }),
        backup({
          id: "33333333-3333-4333-8333-333333333333",
          status: "FAILED",
          failureCode: "BACKUP_INTERRUPTED",
        }),
        backup({
          id: "44444444-4444-4444-8444-444444444444",
          status: "FAILED",
          failureCode: "BACKUP_FAILED",
        }),
      ] }],
    });
    renderSystemPage();
    await openDataTab();

    expect(await screen.findByText("存储空间不足，无法生成备份包。")).toBeTruthy();
    expect(screen.getByText("备份任务中断，未生成完整备份包；请重新发起。")).toBeTruthy();
    expect(screen.getByText("备份包未能生成，请重新发起备份。")).toBeTruthy();
  });

  it("备份任务轮询到终态后停止", async () => {
    let reads = 0;
    const calls = stub({
      "GET /api/v1/system/backups": () => json(200, {
        backups: [backup({ status: reads++ === 0 ? "PENDING" : "SUCCEEDED" })],
      }),
    });
    renderSystemPage();
    await openDataTab();
    expect(await screen.findByText("等待中")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "下载备份包" }, { timeout: 4_000 })).toBeTruthy();
    const readsAtTerminal = calls.filter((call) => call.path === "/api/v1/system/backups").length;
    await new Promise((resolve) => setTimeout(resolve, 1_650));
    expect(calls.filter((call) => call.path === "/api/v1/system/backups")).toHaveLength(readsAtTerminal);
  });

  it("恢复后重建可发现、失败可重试，并在成功终态停止轮询", async () => {
    let rebuildReads = 0;
    let retryStarted = false;
    const failed = { status: "FAILED", message: "数据已恢复，索引重建失败", canRetry: true };
    const calls = stub({
      "GET /api/v1/system/restores/current": () => {
        if (!retryStarted) return json(200, { packageId, rebuild: failed });
        const rebuild = [
          { status: "RUNNING", message: "数据已恢复，索引重建中", canRetry: false },
          { status: "SUCCEEDED", message: "数据已恢复，索引重建完成", canRetry: false },
        ][Math.min(rebuildReads++, 1)];
        return json(200, { packageId, rebuild });
      },
      [`POST /api/v1/system/restores/${packageId}/rebuild/retry`]: () => {
        retryStarted = true;
        return json(200, { status: "PENDING", message: "数据已恢复，索引重建等待中", canRetry: false });
      },
    });
    renderSystemPage();
    await openDataTab();
    expect(await screen.findByText("数据已恢复，索引重建失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试索引重建" }));
    expect(await screen.findByText("数据已恢复，索引重建等待中")).toBeTruthy();
    expect(await screen.findByText("数据已恢复，索引重建完成", {}, { timeout: 4_000 })).toBeTruthy();
    expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/rebuild/retry"))).toBe(true);
    expect(screen.queryByRole("button", { name: "重试索引重建" })).toBeNull();
    const readsAtTerminal = calls.filter((call) => call.path === "/api/v1/system/restores/current").length;
    await new Promise((resolve) => setTimeout(resolve, 1_650));
    expect(calls.filter((call) => call.path === "/api/v1/system/restores/current")).toHaveLength(readsAtTerminal);
  });

  it("估算加载失败显示邻近错误和重试，缺少设置权限时隐藏整个面板", async () => {
    stub({
      "POST /api/v1/system/backups/preflight": [503, { code: "INTERNAL", message: "估算服务暂不可用" }],
      "GET /api/v1/system/backups": [503, { code: "INTERNAL", message: "备份列表暂不可用" }],
    });
    renderSystemPage();
    await openDataTab();
    expect(await screen.findByText("估算服务暂不可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试估算" })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();

    const calls = stub({}, []);
    renderSystemPage();
    await openDataTab();
    expect(screen.queryByRole("heading", { name: "系统数据备份与恢复" })).toBeNull();
    expect(calls.some((call) => call.path.includes("/system/backups") || call.path.includes("/system/restores/current"))).toBe(false);
  });
});
