/** 在线头像组（Round 25 第 48 项）：真实接口数量渲染、空态不渲染 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PresenceAvatars } from "../src/client/components/PresenceAvatars.tsx";
import { setLocale } from "../src/client/i18n/index.ts";
import { queryKeys } from "../src/client/lib/query-keys.ts";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";

const clients: QueryClient[] = [];
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); setLocale("zh-CN"); });

const actor = { memberId: "current-member", username: "me", name: "当前用户" } as Actor;

function renderComponent() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  return { ...render(<QueryClientProvider client={qc}><ActorContext.Provider value={actor}><PresenceAvatars /></ActorContext.Provider></QueryClientProvider>), client: qc };
}

describe("在线头像组", () => {
  it("展示在线成员头像与人数", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      online: [
        { memberId: "m1", name: "演示管理员", username: "demo", lastSeen: Date.now() },
        { memberId: "m2", name: "研发成员", username: "dev", lastSeen: Date.now() },
      ],
      count: 2,
    }), { status: 200, headers: { "content-type": "application/json" } })));
    renderComponent();
    await waitFor(() => expect(screen.getByText("2 人在线")).toBeTruthy());
    expect(screen.getByLabelText("演示管理员 @demo")).toBeTruthy();
    expect(screen.getByLabelText("研发成员 @dev")).toBeTruthy();
  });

  it("无人在线时不渲染", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ online: [], count: 0 }), { status: 200, headers: { "content-type": "application/json" } })));
    const { container, client } = renderComponent();
    await waitFor(() => expect(client.getQueryState(queryKeys.presence())?.status).toBe("success"));
    expect(container.querySelector(".presence-avatars")).toBeNull();
  });

  it("不重复显示当前用户头像，但在线总人数包含当前用户", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ online: [
      { memberId: "current-member", name: "当前用户", username: "me", lastSeen: 123 },
      { memberId: "other-member", name: "协作者", username: "other", lastSeen: 123 },
    ], count: 2 }), { headers: { "content-type": "application/json" } }));
    const { container } = renderComponent();
    expect(await screen.findByRole("group", { name: "2 人在线" })).toBeTruthy();
    expect(container.querySelectorAll(".presence-avatar")).toHaveLength(1);
    expect(screen.getByLabelText("协作者 @other")).toBeTruthy();
    expect(screen.queryByLabelText("当前用户 @me")).toBeNull();
  });

  it("只有当前用户在线时不显示重复头像", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ online: [
      { memberId: "current-member", name: "当前用户", username: "me", lastSeen: 123 },
    ], count: 1 }), { headers: { "content-type": "application/json" } }));
    const { container, client } = renderComponent();
    await waitFor(() => expect(client.getQueryState(queryKeys.presence())?.status).toBe("success"));
    expect(container.querySelector(".presence-avatars")).toBeNull();
  });

  it.each([
    [1, 1, null, "1 人在线"],
    [3, 3, null, "3 人在线"],
    [50, 3, "+47", "50 人在线"],
    [1000, 3, "+997", "1000 人在线"],
  ] as const)("%i 人在线时限制头像并保留完整人数", async (count, avatars, more, label) => {
    const online = Array.from({ length: count }, (_, i) => ({ memberId: `m${i}`, name: `成员${i}`, username: `member${i}`, lastSeen: 123 }));
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ online, count }), { headers: { "content-type": "application/json" } }));
    const { container } = renderComponent();
    expect(await screen.findByRole("group", { name: label })).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
    expect(container.querySelectorAll(".presence-avatar")).toHaveLength(avatars);
    expect(container.querySelector(".presence-more")?.textContent ?? null).toBe(more);
  });

  it.each([
    ["👩🏽‍💻研发负责人", "dev", "👩🏽‍💻"],
    ["🇨🇳中国成员", "cn", "🇨🇳"],
    ["e\u0301quipe", "accent", "e\u0301"],
    ["长姓名成员".repeat(30), "long", "长"],
    ["", "🙂fallback", "🙂"],
    ["   ", "fallback", "f"],
    ["", "", "?"],
  ])("姓名 %s 保留完整首字并正确回退", async (name, username, initial) => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ online: [{ memberId: "m1", name, username, lastSeen: 123 }], count: 1 }), { headers: { "content-type": "application/json" } }));
    const { container } = renderComponent();
    await screen.findByRole("group", { name: "1 人在线" });
    const avatar = container.querySelector(".presence-avatar");
    expect(avatar?.textContent).toBe(initial);
    expect(avatar?.getAttribute("title")).toBe(`${name} @${username}`);
  });
});
