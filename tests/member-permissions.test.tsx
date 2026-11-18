/** 成员权限抽屉（Round 25 第 53 项）：角色/作用域/权限 chips 渲染与空态 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemberPermissionsDrawer } from "../src/client/components/MemberPermissionsDrawer.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemberPermissionsDrawer member={{ id: "m1", name: "演示管理员" }} onClose={vi.fn()} /></QueryClientProvider>);
}

describe("成员权限抽屉", () => {
  it("展示角色作用域与权限 key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      member: { id: "m1", username: "demo", name: "演示管理员" },
      assignments: [{ id: "a1", scopeType: "ORG", scopeId: null, role: { id: "r1", key: "ADMIN", name: "管理员" } }],
      permissions: ["setting:manage", "member:manage", "work_item:create"],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    renderDrawer();
    await waitFor(() => expect(screen.getByText("管理员")).toBeTruthy());
    expect(screen.getByText("ORG")).toBeTruthy();
    expect(screen.getByText("setting:manage")).toBeTruthy();
    expect(screen.getByText("work_item:create")).toBeTruthy();
    expect(screen.getByText(/权限（3）/)).toBeTruthy();
  });

  it("无角色/无权限时显示空态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      member: { id: "m2", username: "guest", name: "访客" }, assignments: [], permissions: [],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    renderDrawer();
    await waitFor(() => expect(screen.getByText("该成员没有任何角色指派。")).toBeTruthy());
    expect(screen.getByText("该成员没有任何权限。")).toBeTruthy();
  });
});
