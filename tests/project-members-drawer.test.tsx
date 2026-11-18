/** 项目成员抽屉（Round 25 第 55 项）：名单、加人请求体、移除请求 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectMembersDrawer } from "../src/client/components/ProjectMembersDrawer.tsx";
import { ActorContext } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "demo", name: "管理员",
  permissions: ["project:manage_member", "role:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function renderDrawer(actor = ACTOR) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {/* @ts-expect-error 测试用最小 actor */}
      <ActorContext.Provider value={actor}>
        <ProjectMembersDrawer project={{ id: "p1", name: "测试项目" }} onClose={vi.fn()} />
      </ActorContext.Provider>
    </QueryClientProvider>,
  );
}

describe("项目成员抽屉", () => {
  it("展示名单；选择成员与角色后发送 POST；移除发送 DELETE", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    let removed = false;
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const url = String(i); const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/projects/p1/members") && method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } });
      if (url.includes("/projects/p1/members/") && method === "DELETE") { removed = true; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }
      if (url.includes("/projects/p1/members")) return new Response(JSON.stringify({ members: removed ? [] : [
        { id: "m1", username: "demo", name: "管理员", role_key: "ADMIN", role_name: "管理员" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/api/v1/members")) return new Response(JSON.stringify({ members: [
        { id: "m1", username: "demo", name: "管理员" }, { id: "m2", username: "dev", name: "研发成员" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/api/v1/roles")) return new Response(JSON.stringify({ roles: [
        { id: "r1", name: "管理员", key: "ADMIN" }, { id: "r2", name: "成员", key: "MEMBER" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    renderDrawer();
    await waitFor(() => expect(screen.getByText("@demo")).toBeTruthy());
    expect(screen.getAllByText("管理员").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: "成员", exact: true }));
    await waitFor(() => expect(screen.getByRole("option", { name: /研发成员/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("option", { name: /研发成员/ }));
    fireEvent.click(screen.getByRole("button", { name: "项目角色：成员", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "加入项目" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/projects/p1/members"))).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ memberId: "m2", roleId: "r2", roleIds: ["r2"] });

    // 重新渲染后移除
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/projects/p1/members/m1"))).toBe(true));
  });

  it("无 role:manage 时隐藏加人表单并提示", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const url = String(i);
      if (url.includes("/projects/p1/members")) return new Response(JSON.stringify({ members: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    renderDrawer({ ...ACTOR, permissions: ["project:manage_member"] });
    await waitFor(() => expect(screen.getByText("需要 role:manage 才能选择项目角色。")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "加入项目" })).toBeNull();
  });
});
