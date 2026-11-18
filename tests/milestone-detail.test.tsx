/** 里程碑详情（Round 62 对标 P1）：本体/进展记录/关联工作项/参与人渲染 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "demo", name: "管理员",
  permissions: ["milestone:manage", "work_item:read_any"], dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "11111111-1111-1111-1111-111111111111";
const M = "22222222-2222-2222-2222-222222222222";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

describe("里程碑详情页", () => {
  it("渲染本体、进展记录、关联工作项与参与人", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return json(ACTOR);
      if (u.includes("/api/v1/notifications")) return json({ items: [], unreadCount: 0 });
      if (u.includes("/api/v1/presence")) return json({ online: [], count: 0 });
      if (u.includes("/milestones/" + M + "/detail")) return json({
        milestone: { id: M, projectId: P, name: "里程碑详情验收", description: "描述", startDate: "2026-12-01", dueDate: "2026-12-31", progressMode: "MANUAL", progressValue: "42.00", completedAt: null, archivedAt: null },
        project: { id: P, key: "FINOK", name: "结项终验" },
        relatedWorkItems: [{ id: "w1", key: "FINOK-1", title: "关联任务一", type: "TASK", statusName: "待办", priority: "HIGH", dueDate: null }],
        progressUpdates: [{ id: "u1", summary: "完成第一轮验收", nextSteps: "修复回归问题", blockers: "等待部署窗口", createdAt: "2026-10-20T10:00:00.000Z", authorName: "演示管理员" }],
      });
      if (u.includes("/projects/" + P + "/members")) return json({ members: [{ id: "m1", username: "demo", name: "演示管理员", role_key: "ADMIN", role_name: "管理员" }] });
      return json({});
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/milestones/${M}`] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByText(/里程碑详情验收/).length).toBeGreaterThan(0));
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("完成第一轮验收")).toBeTruthy();
    expect(screen.getByText(/修复回归问题/)).toBeTruthy();
    expect(screen.getByText(/等待部署窗口/)).toBeTruthy();
    expect(screen.getByText("关联任务一")).toBeTruthy();
    expect(screen.getAllByText(/演示管理员/).length).toBeGreaterThanOrEqual(2);
  });
});
