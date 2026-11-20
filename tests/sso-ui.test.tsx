/** SSO 界面（Round 25 第 43 项）：管理端列表/保存、登录页企业登录入口与失败提示 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { SsoSettings } from "../src/client/components/settings/SsoSettings.tsx";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "u", name: "管理员", permissions: ["setting:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function renderSso(onSuccess = vi.fn(), onError = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SsoSettings onSuccess={onSuccess} onError={onError} /></QueryClientProvider>);
  return { onSuccess, onError };
}

describe("SSO 管理", () => {
  it("列表显示身份源信息，保存新身份源发送完整字段", async () => {
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url: String(i), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ id: "idp-new" }), { status: 201 });
      }
      return new Response(JSON.stringify({ idps: [{
        id: "idp1", kind: "OIDC", issuer: "https://idp.example.com", clientId: "client-1",
        autoProvision: true, enabled: true, allowedEmailDomains: "example.com", hasSecret: true,
      }] }), { status: 200 });
    }));
    const { onSuccess } = renderSso();
    await waitFor(() => expect(screen.getByText(/OIDC · https:\/\/idp\.example\.com/)).toBeTruthy());
    expect(screen.getByText(/已配置密钥/)).toBeTruthy();
    expect(screen.getByText(/已启用/)).toBeTruthy();

    expect(screen.queryByLabelText("Issuer（https）")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建身份源" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Issuer（https）"), { target: { value: "https://idp2.example.com" } });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client-2" } });
    fireEvent.click(screen.getByRole("dialog").querySelector('button[type="submit"]')!);
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]!.body).toMatchObject({ kind: "OIDC", issuer: "https://idp2.example.com", clientId: "client-2", enabled: false, autoProvision: false });
    expect(onSuccess).toHaveBeenCalledWith("身份源已保存");
  });
});

describe("登录页 SSO 入口", () => {
  it("存在启用的身份源时显示企业登录按钮", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/sso/providers")) {
        return new Response(JSON.stringify({ providers: [{ id: "idp1", kind: "OIDC", label: "idp.example.com" }] }), { status: 200 });
      }
      if (u.includes("/api/v1/setup/state")) return new Response(JSON.stringify({ passwordResetEnabled: false }), { status: 200 });
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: ["/login"] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "使用 idp.example.com 登录" })).toBeTruthy());
    expect(screen.getByText("或使用企业登录")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "使用 undefined 登录" })).toBeNull();
  });
});
