import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { WorkItemDrawer } from "../src/client/components/work-item/WorkItemDrawer.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const actor: Actor = { memberId: "m1", username: "dev", name: "开发者", permissions: ["work_item:transition"], dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false, locale: "zh-CN", theme: null, timezone: "Asia/Shanghai" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const clients: QueryClient[] = [];
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); });

function setup(options: { failure?: "conflict" | "approval" | "fields"; canTransition?: boolean } = {}) {
  let detail = { id: "w1", key: "FN-1", title: "详情处理入口", description: "真实业务上下文", type: "TASK", priority: "HIGH", dueDate: null, assigneeId: "m1", projectId: "p1", version: 7, statusName: "待办", statusKey: "TODO", iterationId: "i1", releaseId: "r1", allowedTransitions: [{ toStateKey: "IN_PROGRESS", toName: "处理中", label: "开始处理", requiredFields: [] }] };
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/v1/work-items/w1/transition") {
      const payload = JSON.parse(String(init?.body)); writes.push(payload);
      if (options.failure === "conflict") {
        detail = { ...detail, version: 8, statusName: "已完成", statusKey: "DONE", allowedTransitions: [] };
        return json({ code: "VERSION_CONFLICT", message: "工作项已变化，请刷新后重试", details: null }, 409);
      }
      if (options.failure === "approval") return json({ code: "BLOCKED_BY_PREREQUISITE", message: "已提交审批，等待审批人处理", details: { approvalId: "a1" } }, 409);
      if (options.failure === "fields" && !payload.fields?.reason) return json({ code: "VALIDATION", message: "该流转需要填写必填字段", details: { requiredFields: ["reason"] } }, 400);
      detail = { ...detail, version: 8, statusName: "处理中", statusKey: "IN_PROGRESS", allowedTransitions: [] };
      return json(detail);
    }
    if (path === "/api/v1/work-items/w1") return json(detail);
    if (path.endsWith("/links")) return json({ links: [] });
    if (path.endsWith("/children")) return json({ children: [] });
    if (path.endsWith("/approvals")) return json({ approvals: [] });
    if (path.endsWith("/sla")) return json({ sla: null });
    if (path.endsWith("/transfers")) return json({ transfers: [] });
    if (path.endsWith("/watchers")) return json({ watchers: [] });
    if (path.endsWith("/members")) return json({ members: [{ id: "m1", name: "开发者", username: "dev" }] });
    if (path.endsWith("/iterations")) return json([{ id: "i1", name: "日常流程迭代" }]);
    if (path.endsWith("/releases")) return json([{ id: "r1", name: "研发流程候选版" }]);
    if (path.endsWith("/comments")) return json([]);
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc);
  render(<ActorContext.Provider value={{ ...actor, permissions: options.canTransition === false ? [] : actor.permissions }}><QueryClientProvider client={qc}><WorkItemDrawer workItemId="w1" onClose={() => {}} /></QueryClientProvider></ActorContext.Provider>);
  return writes;
}

it("详情首屏给出当前状态、负责人和关联迭代版本", async () => {
  setup();
  await screen.findByText("待办");
  expect(await screen.findByText("日常流程迭代")).toBeTruthy();
  expect(await screen.findByText("研发流程候选版")).toBeTruthy();
  expect(screen.getAllByText("开发者").length).toBeGreaterThan(0);
});

it("直接执行服务端允许的动作并带当前版本，成功后回读真实状态", async () => {
  const writes = setup();
  fireEvent.click(await screen.findByRole("button", { name: "开始处理" }));
  await screen.findByText("处理中");
  expect(writes).toEqual([{ toStateKey: "IN_PROGRESS", version: 7, fields: {} }]);
  expect(screen.queryByRole("button", { name: "开始处理" })).toBeNull();
});

it("并发冲突回读最新状态，保留服务端原因且不误报成功", async () => {
  setup({ failure: "conflict" });
  fireEvent.click(await screen.findByRole("button", { name: "开始处理" }));
  await screen.findByText("已完成");
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "工作项已变化，请刷新后重试");
  expect(screen.queryByText("状态已更新")).toBeNull();
});

it("提交审批后保留原状态并显示等待信息", async () => {
  setup({ failure: "approval" });
  fireEvent.click(await screen.findByRole("button", { name: "开始处理" }));
  await screen.findByText("已提交审批，等待审批人处理");
  expect(screen.getByText("待办")).toBeTruthy();
  expect(screen.queryByText("状态已更新")).toBeNull();
});

it("缺必填字段可补齐重试，不能把失败当作状态改变", async () => {
  const writes = setup({ failure: "fields" });
  fireEvent.click(await screen.findByRole("button", { name: "开始处理" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "reason" }), { target: { value: "开始自研验证" } });
  fireEvent.click(screen.getByRole("button", { name: "继续流转" }));
  await screen.findByText("处理中");
  expect(writes.at(-1)).toEqual({ toStateKey: "IN_PROGRESS", version: 7, fields: { reason: "开始自研验证" } });
});

it("没有流转权限仍能看状态，但没有可执行动作", async () => {
  setup({ canTransition: false });
  await screen.findByText("待办");
  await waitFor(() => expect(screen.queryByRole("button", { name: "开始处理" })).toBeNull());
});
