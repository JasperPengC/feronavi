import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssistantAction } from "../src/client/components/assistant/AssistantBusiness.tsx";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { ApiError } from "../src/client/lib/api.ts";
import { setLocale } from "../src/client/i18n/index.ts";
import type { RagActionProposal } from "../src/shared/rag.ts";

type ClosureProposal = RagActionProposal & { presentation: { title: string; fields: { label: string; value: string }[] } };
const proposal = (overrides: Partial<ClosureProposal> = {}): ClosureProposal => ({
  id: "proposal-id", projectId: "project-id", toolName: "workitem.setProgress", targetId: null,
  parameters: { projectId: "project-id", workItemId: "hidden-resource-id", progressValue: 65 }, expectedVersion: null,
  status: "pending", createdAt: "2026-11-16T10:00:00Z", expiresAt: "2099-11-16T10:00:00Z",
  presentation: { title: "记录工作项进展", fields: [{ label: "进展方式", value: "手动记录" }, { label: "完成比例", value: "65%" }, { label: "进展说明", value: "接口联调已完成" }] },
  ...overrides,
});
function mount(action: ClosureProposal, onDecide = vi.fn(async () => {}), canAct = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onDecide, ...render(<ActorContext.Provider value={{ memberId: "me" } as Actor}><QueryClientProvider client={client}>
    <AssistantAction action={action} accountId="me" projects={[{ id: "project-id", key: "DEV", name: "研发项目" }]} canAct={canAct} onDecide={onDecide} />
  </QueryClientProvider></ActorContext.Provider>) };
}
beforeEach(() => { setLocale("zh-CN"); vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("个人操作展示个人范围，排队同步不重复确认且明确仍未完成", () => {
  mount(proposal({toolName:"todo.create",projectId:null,scope:{kind:"personal",ownerId:"me"},status:"queued"}));
  expect(screen.getByText("个人范围")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("已排队");
  expect(screen.queryByRole("button",{name:"确认执行"})).toBeNull();
});

it("所有带presentation的操作优先显示完整业务标题和参数，不回退为工作项修改卡", () => {
  mount(proposal());
  expect(screen.getByRole("region", { name: "记录工作项进展" })).toBeTruthy();
  expect(screen.getByText("研发项目")).toBeTruthy();
  for (const text of ["进展方式", "手动记录", "完成比例", "65%", "进展说明", "接口联调已完成"]) expect(screen.getByText(text)).toBeTruthy();
  expect(document.querySelector(".assistant-action-changes")!.textContent).not.toContain("hidden-resource-id");
  expect(fetch).not.toHaveBeenCalled();
});

it("想法使用服务端预览的可读标题并链接到项目真实想法页", () => {
  mount(proposal({ toolName: "idea.setStatus", target: { kind: "idea", id: "hidden-idea-id", fingerprint: "fingerprint", preview: { title: "支持批量导入" } } as RagActionProposal["target"] }));
  expect(screen.getByRole("link", { name: "支持批量导入" }).getAttribute("href")).toBe("/projects/project-id/ideas");
  expect(fetch).not.toHaveBeenCalled();
});

it("确认期间锁住两个决策并阻止重复提交", async () => {
  let finish!: () => void;
  const onDecide = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  mount(proposal(), onDecide);
  const confirm = screen.getByRole("button", { name: "确认执行" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(onDecide).toHaveBeenCalledExactlyOnceWith("proposal-id", "confirm");
  expect((screen.getByRole("button", { name: "拒绝建议" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("执行中")).toBeTruthy();
  await act(async () => finish());
});

it("拒绝只发送拒绝决策；无执行权限时两个按钮禁用", async () => {
  const { onDecide } = mount(proposal());
  fireEvent.click(screen.getByRole("button", { name: "拒绝建议" }));
  await waitFor(() => expect(onDecide).toHaveBeenCalledExactlyOnceWith("proposal-id", "reject"));
  cleanup(); mount(proposal(), vi.fn(), false);
  expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "拒绝建议" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(["CONFLICT", "VERSION_CONFLICT", "FORBIDDEN", "NOT_FOUND"])("%s之后保留错误且禁止重新确认", async code => {
  mount(proposal(), vi.fn(async () => { throw new ApiError(409, { code, message: "当前数据或权限已变化", details: null }); }));
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  await screen.findByText("当前数据或权限已变化");
  expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(["rejected", "expired", "confirmed"] as const)("%s状态保留展示但不提供决策", status => {
  mount(proposal({ status }));
  expect(screen.getByText("接口联调已完成")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
  expect(screen.queryByRole("button", { name: "拒绝建议" })).toBeNull();
});

it("建议在当前页面过期后自动移除确认入口", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  mount(proposal({ expiresAt: "2026-11-16T10:00:01Z" }));
  expect(screen.getByRole("button", { name: "确认执行" })).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(1001));
  expect(screen.getByText("已过期")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
});

it("复读集合、嵌套业务对象与统计事实，不将结果假定为单个已创建对象或展示内部ID", () => {
  mount(proposal({ status: "confirmed", result: {
    observedAt: "2026-11-16T10:15:00Z", resources: [], value: { observations: [
      { toolName: "workitem.dependencies", value: { total: 1, items: [{ id: "550e8400-e29b-41d4-a716-446655440000", relationType: "BLOCKS", source: { id: "source-id", key: "DEV-1", title: "准备接口" }, target: { id: "target-id", key: "DEV-2", title: "验收测试" } }] } },
      { toolName: "workitem.getProgress", value: { progressMode: "MANUAL", progressValue: 65, completed: false, note: "仍需用户验收" } },
      { toolName: "workitem.listTimeEntries", value: [] },
    ] },
  } }));
  const facts = screen.getByRole("region", { name: "执行后核对结果" });
  for (const text of ["准备接口", "验收测试", "65", "仍需用户验收", "手动设置"]) expect(facts.textContent).toContain(text);
  expect(facts.textContent).toContain("0 条记录");
  expect(screen.getByText(/最新数据时间：/)).toBeTruthy();
  expect(facts.textContent).not.toMatch(/550e8400|source-id|target-id|已创建|\{"/);
});

it("依赖复读按真实blocks与blockedBy集合显示语义，保留空集合事实", () => {
  mount(proposal({ status: "confirmed", result: { observedAt: "2026-11-16T10:15:00Z", resources: [], value: { observations: [
    { toolName: "workitem.relations", value: { blocks: [{ id: "relation-id", key: "DEV-2", title: "验收测试" }], blockedBy: [], others: [] } },
  ] } } }));
  const facts = screen.getByRole("region", { name: "执行后核对结果" });
  expect(facts.textContent).toContain("阻塞的工作项");
  expect(facts.textContent).toContain("前置阻塞工作项");
  expect(facts.textContent).toContain("其他关联");
  expect(facts.textContent).toContain("验收测试");
  expect(facts.textContent).not.toContain("relation-id");
});

it("临时失败允许用户再次确认", async () => {
  const onDecide = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
  mount(proposal(), onDecide);
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  const retry = await screen.findByRole("button", { name: "重试确认" });
  expect((retry as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(retry);
  await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(2));
});
