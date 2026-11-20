import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssistantAction } from "../src/client/components/assistant/AssistantBusiness.tsx";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";
import { ApiError } from "../src/client/lib/api.ts";
import type { RagActionProposal } from "../src/shared/rag.ts";
const P = "project-id", ID = "resource-uuid-hidden";
let calls: string[];
let rows: Record<string, unknown>;
const proposal = (toolName: string, parameters: Record<string, unknown>, overrides: Partial<RagActionProposal> = {}): RagActionProposal => ({ id: "proposal-id", projectId: P, toolName, parameters, targetId: null, expectedVersion: null, status: "pending", createdAt: "2026-11-16T10:00:00Z", expiresAt: "2099-11-16T10:00:00Z", ...overrides });
const actor = { memberId: "me" } as Actor;
function mount(action: RagActionProposal, onDecide = vi.fn(async () => {}), canAct = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onDecide, ...render(<ActorContext.Provider value={actor}><QueryClientProvider client={client}><AssistantAction action={action} accountId="me" projects={[{ id: P, key: "DEV", name: "研发项目" }]} canAct={canAct} onDecide={onDecide} /></QueryClientProvider></ActorContext.Provider>) };
}
beforeEach(() => {
  setLocale("zh-CN"); calls = []; rows = {};
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname; calls.push(path);
    return new Response(JSON.stringify(rows[path] ?? { code: "NOT_FOUND", message: "不可访问", details: null }), { status: path in rows ? 200 : 404, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(["Milestone", "Iteration", "Release", "Module"])("计划%s创建使用中文动作与业务值，不读取工作项目标", async suffix => {
  const labels: Record<string, string> = { Milestone: "里程碑", Iteration: "迭代", Release: "版本", Module: "模块" };
  const { onDecide } = mount(proposal(`plan.create${suffix}`, { projectId: P, name: "发布准备", startDate: "2026-11-20", carryOver: false }));
  expect(screen.getByRole("region", { name: `创建${labels[suffix]}` })).toBeTruthy();
  expect(screen.getByText("名称")).toBeTruthy(); expect(screen.getByText("发布准备")).toBeTruthy(); expect(screen.getByText("停用")).toBeTruthy();
  expect(document.querySelector(".assistant-action-changes")!.textContent).not.toContain(P);
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  await waitFor(() => expect(onDecide).toHaveBeenCalledWith("proposal-id", "confirm"));
  expect(calls.some(path => path.includes("work-items"))).toBe(false);
});
it("迭代更新显示当前名称、起止新旧值，拒绝或确认只提交决策", async () => {
  rows[`/api/v1/iterations/${ID}`] = { id: ID, projectId: P, name: "十一月迭代", endDate: "2026-11-20" };
  const { onDecide } = mount(proposal("plan.updateIteration", { iterationId: ID, endDate: "2026-11-27" }, { targetId: ID, target: { kind: "iteration", id: ID, fingerprint: "server-fingerprint" } }));
  await screen.findByRole("button", { name: "十一月迭代" });
  expect(screen.getByText("2026-11-20")).toBeTruthy(); expect(screen.getByText("2026-11-27")).toBeTruthy();
  expect(document.querySelector(".assistant-action-changes")!.textContent).not.toContain(ID);
  fireEvent.click(screen.getByRole("button", { name: "拒绝建议" })); await waitFor(() => expect(onDecide).toHaveBeenCalledWith("proposal-id", "reject"));
});
it("文档旧版本变化时禁用确认，parentId读取文档而非工作项", async () => {
  rows[`/api/v1/pages/${ID}`] = { id: ID, projectId: P, title: "部署手册", currentRevisionId: "new-revision", content: "旧正文" };
  rows["/api/v1/pages/parent-page"] = { id: "parent-page", projectId: P, title: "发布文档" };
  mount(proposal("page.update", { pageId: ID, expectedRevisionId: "old-revision", content: "新的部署步骤", parentId: "parent-page" }, { targetId: ID, target: { kind: "page", id: ID, fingerprint: "fingerprint" } }));
  await screen.findByRole("link", { name: "部署手册" }); await screen.findByRole("link", { name: "发布文档" });
  expect(screen.getByText("旧正文")).toBeTruthy(); expect(screen.getByText("新的部署步骤")).toBeTruthy(); expect(screen.getByText("目标已变化，请重新提问生成建议。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(true);
  expect(calls.some(path => path.includes("work-items"))).toBe(false);
});
it("评论用服务端可读快照展示新旧正文，冲突后禁用再次确认", async () => {
  const onDecide = vi.fn(async () => { throw new ApiError(409, { code: "CONFLICT", message: "内容已变化", details: null }); });
  mount(proposal("comment.update", { commentId: ID, body: "补充回归结果" }, { targetId: ID, target: { kind: "comment", id: ID, fingerprint: "fingerprint", preview: { body: "待补充结果", targetId: "work-item-id", targetType: "WORK_ITEM" } } }), onDecide);
  expect(screen.getByRole("region", { name: "修改本人评论" })).toBeTruthy(); expect(screen.getByText("待补充结果")).toBeTruthy(); expect(screen.getByText("补充回归结果")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认执行" })); await screen.findByText("内容已变化");
  expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(true); expect(calls).toHaveLength(0);
});
it("已执行文档使用真实复读内容，无确认按钮；失去权限的计划不显示确认", async () => {
  mount(proposal("page.create", { title: "建议标题", content: "建议正文" }, { status: "confirmed", result: { observedAt: "2026-11-16T10:00:00Z", resources: [{ kind: "page", id: ID }], value: { id: ID, projectId: P, title: "真实保存标题", content: "真实保存正文" } } }));
  expect(screen.getByRole("link", { name: "真实保存标题" }).getAttribute("href")).toContain("wiki?page=");
  expect(screen.getByText("真实保存正文")).toBeTruthy(); expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
  cleanup(); mount(proposal("plan.updateModule", { moduleId: ID, name: "改名" }, { targetId: ID, target: { kind: "module", id: ID, fingerprint: "fingerprint" } }));
  await screen.findByText("目标已不可访问，无法查看或执行此建议。"); expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
});

it("工作项评论显示所属业务标题，过期文档不再提供决策", async () => {
  rows["/api/v1/work-items/work-item"] = { id: "work-item", projectId: P, key: "DEV-1", title: "发布回归" };
  mount(proposal("workitem.comment", { workItemId: "work-item", body: "回归已通过" }, { targetId: "work-item", target: { kind: "workItem", id: "work-item", fingerprint: "fingerprint" } }));
  await screen.findByRole("button", { name: "DEV-1 · 发布回归" }); expect(screen.getByText("回归已通过")).toBeTruthy();
  expect(document.querySelector(".assistant-action-old")).toBeNull();
  cleanup(); mount(proposal("page.create", { title: "新文档", content: "正文" }, { expiresAt: "2000-01-01T00:00:00Z" }));
  expect(screen.getByText("已过期，请重新提问生成建议。")).toBeTruthy(); expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
});
it("长正文默认提供可读节选，展开后能核对完整内容且无执行权限时禁用确认", () => {
  const content = "发布说明正文".repeat(100);
  mount(proposal("page.create", { title: "发布说明", content }), vi.fn(), false);
  const details = document.querySelector(".assistant-action-content") as HTMLDetailsElement;
  expect(details.open).toBe(false); expect(details.querySelector("p")!.textContent).toBe(content);
  fireEvent.click(screen.getByText("展开完整内容"));
  expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(true);
});
