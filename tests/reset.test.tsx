/** 自助找回前端（第七期）：登录页入口按能力显示 + 重置页消费 token */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setLocale } from "../src/client/i18n/index.ts";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

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
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => {
  // ⚠️ 未登录页默认跟随**浏览器语言**（jsdom 是 en-US）→ 这些用例测的是登录/找回逻辑，显式固定中文
  setLocale("zh-CN"); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("自助找回", () => {
  it("配了 SMTP：登录页显示「忘记密码」入口", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: true }] });
    renderAt("/login");
    await waitFor(() => expect(screen.getByText("忘记密码？")).toBeTruthy());
  });

  it("未配 SMTP：**不显示**入口（规范要求）", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: false }] });
    renderAt("/login");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "登录", exact: true })).toBeTruthy());
    expect(screen.queryByText("忘记密码？")).toBeNull();
  });

  it("提交找回后提示已发送，且不暗示账号是否存在", async () => {
    stub({
      "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: true }],
      "/api/v1/auth/password/forgot": [200, { ok: true, enabled: true }],
    });
    renderAt("/login");
    await waitFor(() => expect(screen.getByText("忘记密码？")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: "someone" } });
    fireEvent.click(screen.getByText("忘记密码？"));
    fireEvent.click(screen.getByText("发送重置邮件"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("如果该账号存在"));
  });

  it("展开找回密码时，找回表单与登录表单保持分离", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: true }] });
    renderAt("/login");
    await waitFor(() => expect(screen.getByText("忘记密码？")).toBeTruthy());
    fireEvent.click(screen.getByText("忘记密码？"));

    const forms = [...document.querySelectorAll("form")];
    expect(forms).toHaveLength(2);
    expect(forms[0].contains(forms[1])).toBe(false);
  });

  it("重置页：缺 token 时明确提示且提交按钮不可用", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: true }] });
    renderAt("/reset");
    await waitFor(() => expect(screen.getByText(/缺少令牌/)).toBeTruthy());
    // 正确行为：没有令牌就不给点（不是点了才报错）
    expect((screen.getByRole("button", { name: "重置密码" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("重置页：两次输入不一致时拒绝且不发请求", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.includes("/api/v1/setup/state")) return new Response(JSON.stringify({ initialized: true, passwordResetEnabled: true }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
    renderAt("/reset?token=tok123");
    await waitFor(() => expect(screen.getByRole("heading", { name: "重置密码" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("新密码（至少 12 个字符）"), { target: { value: "aaaaaaaaaaaa" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "bbbbbbbbbbbb" } });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    await waitFor(() => expect(screen.getByText("两次输入的密码不一致")).toBeTruthy());
    expect(calls.some((c) => c.includes("password/reset"))).toBe(false);
  });

  it("重置页：带 token 且两次一致 → 调接口并跳登录", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      calls.push(`${init?.method ?? "GET"} ${u.replace(location.origin, "")}`);
      if (u.includes("/api/v1/setup/state")) return new Response(JSON.stringify({ initialized: true, passwordResetEnabled: true }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/api/v1/auth/password/reset")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    renderAt("/reset?token=tok123");
    await waitFor(() => expect(screen.getByRole("heading", { name: "重置密码" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("新密码（至少 12 个字符）"), { target: { value: "newpassword12345" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpassword12345" } });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    await waitFor(() => expect(calls.some((c) => c.startsWith("POST /api/v1/auth/password/reset"))).toBe(true));
  });
});
