/** 在线头像组（Round 25 第 48 项）：真实接口数量渲染、空态不渲染 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PresenceAvatars } from "../src/client/components/PresenceAvatars.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function renderComponent() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PresenceAvatars /></QueryClientProvider>);
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
    const { container } = renderComponent();
    await waitFor(() => expect(container.querySelector(".presence-avatars")).toBeNull());
  });
});
