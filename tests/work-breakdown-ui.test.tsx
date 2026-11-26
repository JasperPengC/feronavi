import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { WorkItemEditor } from "../src/client/components/work-item/WorkItemEditor.tsx";
import { WorkItemDrawer } from "../src/client/components/work-item/WorkItemDrawer.tsx";
import { invalidateResourceBatch } from "../src/client/lib/query-keys.ts";
import { setLocale } from "../src/client/i18n/index.ts";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { useState } from "react";

const actor: Actor = { memberId: "m1", username: "dev", name: "开发者", permissions: ["work_item:create"], dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false, locale: "zh-CN", theme: null, timezone: "Asia/Shanghai" };
const parent = { id: "p", key: "FN-1", projectId: "project", type: "REQUIREMENT", title: "登录需求", description: "需求内容", priority: "HIGH", assigneeId: "m1", dueDate: "2026-12-02", startDate: "2026-11-26", version: 2, milestoneId: "ms1", iterationId: "i1", releaseId: "r1", moduleId: "mod1", parentId: null };
const child = { ...parent, id: "c", key: "FN-2", title: "实现登录", type: "TASK", parentId: "p", statusKey: "IN_PROGRESS", statusCategory: "IN_PROGRESS", statusName: "开发中", assigneeName: "开发者", version: 3 };
const related = { ...child, id: "other", key: "FN-3", title: "接口依赖", parentId: null };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const clients: QueryClient[] = [];
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); });

function setup({ failChildren = false, conflict = false } = {}) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const searches: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost"), path = url.pathname;
    if (init?.method === "POST" || init?.method === "PATCH") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return conflict ? json({ code: "VERSION_CONFLICT", message: "工作项已变化，请刷新后重试", details: null }, 409) : json({ ...child, id: "saved" });
    }
    if (path.endsWith("/children")) return failChildren ? json({ code: "FORBIDDEN", message: "无权读取", details: null }, 403) : json({ children: path.includes("/p/") ? [child] : [] });
    if (path.endsWith("/relations")) return json({ blocks: path.includes("/p/") ? [{ id: "relation-id", workItemId: "other", key: "FN-3", title: "接口依赖" }] : [], blockedBy: [], others: [] });
    if (path.endsWith("/work-items/p")) return json(parent);
    if (path.endsWith("/work-items/c")) return json(child);
    if (path.endsWith("/work-items/other")) return json(related);
    if (path.endsWith("/work-items")) { searches.push(url.searchParams.get("q") ?? ""); return json({ items: url.searchParams.get("q") ? [related] : [], total: 1 }); }
    if (path.endsWith("/members")) return json({ members: [{ id: "m1", name: "开发者", username: "dev" }] });
    if (path.endsWith("/milestones")) return json([{ id: "ms1", name: "第一阶段" }]);
    if (path.endsWith("/iterations")) return json([{ id: "i1", name: "当前迭代" }, { id: "finished", name: "已结束迭代", completedAt: "2026-11-01" }]);
    if (path.endsWith("/releases")) return json([{ id: "r1", name: "本地候选" }]);
    if (path.endsWith("/modules")) return json([{ id: "mod1", name: "工作项" }]);
    if (path.endsWith("/links")) return json({ links: [] });
    if (path.endsWith("/approvals")) return json({ approvals: [] });
    if (path.endsWith("/comments")) return json([]);
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(qc);
  const wrap = (ui: React.ReactNode, permissions = actor.permissions) => render(<ActorContext.Provider value={{ ...actor, permissions }}><QueryClientProvider client={qc}>{ui}</QueryClientProvider></ActorContext.Provider>);
  return { writes, searches, wrap, qc };
}

it("编辑普通任务保留父项和计划归属，保存只使用打开时版本", async () => {
  const { wrap, writes } = setup();
  wrap(<WorkItemEditor open projectId="project" workItem={child} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "修改实现范围" } });
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body).toMatchObject({ parentId: "p", version: 3, iterationId: "i1", milestoneId: "ms1", releaseId: "r1", moduleId: "mod1" });
});

it("从需求拆任务预填父项与排期，负责人仍需明确选择", async () => {
  const { wrap, writes } = setup();
  wrap(<WorkItemEditor open projectId="project" initialParent={parent} onClose={() => {}} />);
  expect(await screen.findByRole("button", { name: "父工作项", exact: true })).toHaveProperty("textContent", expect.stringContaining("FN-1 登录需求"));
  expect(await screen.findByText("当前迭代")).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "开发登录" } });
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body).toMatchObject({ type: "TASK", parentId: "p", priority: "HIGH", assigneeId: null, iterationId: "i1", releaseId: "r1", milestoneId: "ms1", moduleId: "mod1" });
});

it("从计划范围新建预填四类计划，创建请求保留归属", async () => {
  const { wrap, writes } = setup();
  wrap(<WorkItemEditor open projectId="project" initialPlanning={{ iterationId: "i1", milestoneId: "ms1", releaseId: "r1", moduleId: "mod1" }} onClose={() => {}} />);
  await screen.findByText("当前迭代");
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "范围内的新任务" } });
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body).toMatchObject({ iterationId: "i1", milestoneId: "ms1", releaseId: "r1", moduleId: "mod1", parentId: null });
});

it("父项支持服务端搜索，当前父项不在第一页仍显示正确标题", async () => {
  const { wrap, searches, writes } = setup();
  wrap(<WorkItemEditor open projectId="project" workItem={child} onClose={() => {}} />);
  const picker = await screen.findByRole("button", { name: "父工作项", exact: true });
  await waitFor(() => expect(picker.textContent).toContain("FN-1 登录需求"));
  fireEvent.click(picker);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "接口依赖" } });
  fireEvent.click(await screen.findByRole("option", { name: /FN-3 接口依赖/ }));
  expect(searches).toContain("接口依赖");
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(writes[0]?.body.parentId).toBe("other"));
});

it("子项显示执行信息，打开和返回保持在同一个抽屉，依赖用工作项ID导航", async () => {
  const { wrap } = setup();
  wrap(<WorkItemDrawer workItemId="p" onClose={() => {}} />);
  const children = await screen.findByRole("region", { name: "子工作项" });
  expect(await within(children).findByText("开发中")).toBeTruthy();
  expect(within(children).getByText("开发者")).toBeTruthy();
  expect(within(children).getByText("2026-12-02")).toBeTruthy();
  fireEvent.click(within(children).getByRole("button", { name: /FN-2 实现登录/ }));
  await screen.findByRole("heading", { name: "实现登录" });
  fireEvent.click(screen.getByRole("button", { name: /返回.*FN-1/ }));
  await screen.findByRole("heading", { name: "登录需求" });
  fireEvent.click(screen.getByText("关联与依赖"));
  fireEvent.click(screen.getByRole("button", { name: "FN-3 接口依赖" }));
  await screen.findByRole("heading", { name: "接口依赖" });
});

it("子项加载失败提供重试，不能伪装成没有子项", async () => {
  const { wrap } = setup({ failChildren: true });
  wrap(<WorkItemDrawer workItemId="p" onClose={() => {}} />);
  const children = await screen.findByRole("region", { name: "子工作项" });
  await within(children).findByText("无权读取");
  expect(within(children).getByRole("button", { name: "重新载入" })).toBeTruthy();
  expect(within(children).queryByText("没有子工作项")).toBeNull();
});

it("父子往返保留抽屉外壳，关闭恢复列表入口焦点，再打开从原项开始", async () => {
  const { wrap } = setup();
  function Harness() {
    const [id, setId] = useState<string | null>(null);
    return <><button onClick={() => setId("p")}>查看需求</button><WorkItemDrawer workItemId={id} onClose={() => setId(null)} /></>;
  }
  wrap(<Harness />);
  const trigger = screen.getByRole("button", { name: "查看需求" });
  trigger.focus(); fireEvent.click(trigger);
  await screen.findByRole("heading", { name: "登录需求" });
  const panel = screen.getByRole("dialog", { name: "FN-1" });
  const children = await screen.findByRole("region", { name: "子工作项" });
  fireEvent.click(within(children).getByRole("button", { name: /FN-2 实现登录/ }));
  await screen.findByRole("heading", { name: "实现登录" });
  expect(screen.getByRole("dialog", { name: "FN-2" })).toBe(panel);
  fireEvent.click(within(panel).getByRole("button", { name: "关闭", exact: true }));
  expect(panel.isConnected).toBe(true);
  await waitFor(() => expect(panel.isConnected).toBe(false));
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("heading", { name: "登录需求" });
  expect(screen.queryByRole("button", { name: /返回.*FN-1/ })).toBeNull();
});

it("没有创建权限时不给出拆分入口", async () => {
  const { wrap } = setup();
  wrap(<WorkItemDrawer workItemId="p" onClose={() => {}} />, []);
  await screen.findByRole("heading", { name: "登录需求" });
  expect(screen.queryByRole("button", { name: "拆分任务" })).toBeNull();
});

it("版本冲突保留编辑草稿及父项，不能自动提交新版本", async () => {
  const { wrap, writes } = setup({ conflict: true });
  const onClose = vi.fn();
  wrap(<WorkItemEditor open projectId="project" workItem={child} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "冲突草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText(/标题/)).toHaveProperty("value", "冲突草稿");
  expect(writes[0]!.body.parentId).toBe("p");
  expect(onClose).not.toHaveBeenCalled();
  expect(writes).toHaveLength(1);
});

it("收到Agent对子项的更新会刷新父项子列表和可选父项", async () => {
  const { qc } = setup();
  const keys = [["work-item-children", "p"], ["work-item-picker", "project", ""], ["work-item-children", "other"]];
  keys.forEach(key => qc.setQueryData(key, {}));
  await invalidateResourceBatch(qc, [{ domain: "workitem", projectId: "project", resourceId: "c", resourceType: "WORK_ITEM" }]);
  keys.forEach(key => expect(qc.getQueryState(key)?.isInvalidated, key.join("/")).toBe(true));
});

it("从任务创建SUBTASK并允许在保存前更改排期", async () => {
  const { wrap, writes } = setup();
  wrap(<WorkItemEditor open projectId="project" initialParent={child} onClose={() => {}} />);
  await screen.findByText("当前迭代");
  fireEvent.click(screen.getByRole("button", { name: "迭代", exact: true }));
  expect(screen.queryByRole("option", { name: /已结束迭代/ })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "不设置" }));
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "接口联调" } });
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body).toMatchObject({ type: "SUBTASK", parentId: "c", iterationId: null });
});

it("SUBTASK清空父项不能提交", async () => {
  const { wrap, writes } = setup();
  wrap(<WorkItemEditor open projectId="project" workItem={{ ...child, type: "SUBTASK" }} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /父工作项/ }));
  fireEvent.click(await screen.findByRole("option", { name: "无（顶级工作项）" }));
  expect(screen.getByRole("button", { name: "保存", exact: true })).toHaveProperty("disabled", true);
  expect(writes).toHaveLength(0);
});

it("创建新子项必须重新选择有效计划", async () => {
  const { wrap } = setup();
  wrap(<WorkItemEditor open projectId="project" initialParent={{ ...parent, iterationId: "finished" }} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "新任务" } });
  await screen.findByText("该计划已结束、归档或不可用，请选择其他计划或清空。");
  expect(screen.getByRole("button", { name: "创建", exact: true })).toHaveProperty("disabled", true);
});

it("普通TASK明确清空后才解除父项，历史已结束计划可保留", async () => {
  const { wrap, writes } = setup();
  wrap(<WorkItemEditor open projectId="project" workItem={{ ...child, iterationId: "finished" }} onClose={() => {}} />);
  await screen.findByText("已结束迭代 · 已完成");
  fireEvent.click(screen.getByRole("button", { name: "父工作项", exact: true }));
  fireEvent.click(await screen.findByRole("option", { name: "无（顶级工作项）" }));
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(writes[0]?.body).toMatchObject({ parentId: null, iterationId: "finished" }));
});

it("详情内跳到子项前保护未发送评论，取消保留正文，确认后才导航", async () => {
  const { wrap } = setup();
  wrap(<><WorkItemDrawer workItemId="p" onClose={() => {}} /><DialogHost /></>);
  const comment = await screen.findByRole("textbox", { name: /写评论/ });
  fireEvent.change(comment, { target: { value: "尚未发送的分析" } });
  fireEvent.click(await screen.findByRole("button", { name: "FN-2 实现登录" }));
  const dialog = await screen.findByRole("dialog", { name: "有未保存的修改。确认放弃修改并关闭？" });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "取消" })); });
  expect(comment).toHaveProperty("value", "尚未发送的分析");
  expect(screen.getByRole("heading", { name: "登录需求" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "FN-2 实现登录" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认", exact: true }));
  await screen.findByRole("heading", { name: "实现登录" });
});
