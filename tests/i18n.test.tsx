/** i18n（第十二期）：语言跟随账号偏好；字典缺键回落 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { t, setLocale, dictKeys } from "../src/client/i18n/index.ts";

const P = "88888888-8888-8888-8888-888888888888";
function actorWith(locale: string) {
  return {
    memberId: "m1", username: "u", name: "测试", permissions: ["audit:read"],
    dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
    locale, timezone: "Asia/Shanghai",
  };
}
function stub(locale: string) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    if (u.includes("/auth/me")) return new Response(JSON.stringify(actorWith(locale)), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/pages")) return new Response(JSON.stringify({ pages: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}
function renderAt(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => { vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

describe("i18n", () => {
  it("中英字典键一一对应", () => {
    expect(dictKeys("zh-CN")).toEqual(dictKeys("en-US"));
  });

  it("缺键回落中文并返回键名而非空白", () => {
    setLocale("en-US");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("nav.board")).toBe("Board");
    expect(t("不存在的键")).toBe("不存在的键");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("外壳语言跟随**账号偏好**（en-US 账号看到英文导航）", async () => {
    stub("en-US");
    renderAt(`/projects/${P}/wiki`);
    await waitFor(() => expect(screen.getAllByText("All projects").length).toBeGreaterThan(0));
    // "Docs" 会同时出现在导航与面包屑里（正常），故用多匹配
    expect(screen.getAllByText("Docs").length).toBeGreaterThan(0);
    expect(screen.queryByText("全部项目")).toBeNull();
  });

  it("zh-CN 账号看到中文导航", async () => {
    stub("zh-CN");
    renderAt(`/projects/${P}/wiki`);
    await waitFor(() => expect(screen.getAllByText("全部项目").length).toBeGreaterThan(0));
    expect(screen.getAllByText("文档").length).toBeGreaterThan(0);
  });
});
