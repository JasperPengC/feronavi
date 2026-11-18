import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale, t } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;
function mount(path: string, handler: Handler, permissions: string[] = [], locale: "zh-CN" | "en-US" = "zh-CN") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const response = handler(url, init);
    if (response) return response;
    if (url.pathname.endsWith("/auth/me")) return json({ memberId: "m1", username: "admin", name: "管理员", permissions, dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false, locale, timezone: "Asia/Shanghai", theme: null });
    if (url.pathname.endsWith("/projects")) return json({ items: [] });
    if (url.pathname.endsWith("/notifications")) return json({ items: [], unreadCount: 0 });
    if (url.pathname.endsWith("/system/status")) return json({ ok: true });
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } } });
  clients.push(qc);
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return { qc, router };
}
beforeEach(() => {
  localStorage.clear(); setLocale("zh-CN");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); clients.splice(0).forEach(qc => qc.clear()); vi.unstubAllGlobals(); setLocale("zh-CN"); });

it("工作流从项目一切到项目二时，不沿用项目一选中的工作流和状态", async () => {
  const { router } = mount("/projects/p1/workflow", (url) => {
    if (url.pathname === "/api/v1/workflows") {
      const ids = url.searchParams.get("projectId") === "p1" ? ["p1a", "p1b"] : ["p2a"];
      return json(ids.map(id => ({ id, name: `流程${id}`, appliesToType: "TASK", isDefault: true })));
    }
    if (url.pathname.endsWith("/states")) {
      const id = url.pathname.split("/").at(-2);
      return json([{ id: `state-${id}`, key: "OPEN", name: `状态${id}`, category: "NOT_STARTED", color: "blue" }]);
    }
    if (url.pathname.endsWith("/transitions")) return json([]);
  }, ["work_item:manage_workflow"]);
  fireEvent.click(await screen.findByRole("button", { name: /流程p1b/ }));
  await screen.findByText("状态p1b");
  await act(async () => router.navigate({ to: "/projects/$projectId/workflow", params: { projectId: "p2" } }));
  await screen.findByRole("button", { name: /流程p2a/ });
  await waitFor(() => expect(screen.queryByText("状态p1b")).toBeNull());
  expect(await screen.findByText("状态p2a")).toBeTruthy();
});

it("邀请注册成功后打开另一个邀请，显示新表单而不是上一次的成功状态", async () => {
  const { router } = mount("/invite/first", (url) => url.pathname.includes("/invites/") ? json({ valid: true }) : undefined);
  fireEvent.change(await screen.findByLabelText(/用户名/), { target: { value: "first-user" } });
  fireEvent.change(screen.getByLabelText(t("invite.name"), { exact: false }), { target: { value: "第一位成员" } });
  fireEvent.change(screen.getByLabelText(/密码/), { target: { value: "StrongPass123!" } });
  fireEvent.click(screen.getByRole("button", { name: t("invite.accept") }));
  await screen.findByText(t("invite.joined"));
  await act(async () => router.navigate({ to: "/invite/$token", params: { token: "second" } }));
  await waitFor(() => expect(screen.queryByText(t("invite.joined"))).toBeNull());
  expect((await screen.findByLabelText(/用户名/) as HTMLInputElement).value).toBe("");
});

it.each(["integrations", "instance"] as const)("无权限直达 %s 设置时提供受限说明", async (section) => {
  mount(`/settings/${section}`, () => undefined);
  await screen.findByRole("heading", { name: t(section === "instance" ? "se.groupInstance" : "se.groupIntegrations") });
  expect(await screen.findByText("你没有访问此设置页的权限")).toBeTruthy();
  expect(screen.getByText("请联系管理员调整权限，或返回个人设置。")).toBeTruthy();
  expect(within(screen.getByRole("main")).getByRole("link", { name: t("se.groupPersonal") }).getAttribute("href")).toBe("/settings/personal");
});

it("需求转换后刷新所有提交筛选和想法列表，说明转换目标", async () => {
  let converted = false;
  const pending = { id: "sub1", formId: "f1", status: "PENDING", payload: { title: "外部需求" }, createdAt: "2026-11-08T01:00:00Z" };
  const { qc, router } = mount("/projects/p1/intake", (url, init) => {
    if (url.pathname.endsWith("/intake-forms")) return json({ forms: [{ id: "f1", name: "反馈", schema: [], isActive: true }] });
    if (url.pathname.endsWith("/intake-submissions")) {
      const row = converted ? { ...pending, status: "CONVERTED", convertedIdeaId: "idea1" } : pending;
      return json({ items: !url.searchParams.get("status") || url.searchParams.get("status") === row.status ? [row] : [], total: 1 });
    }
    if (url.pathname.endsWith("/convert") && init?.method === "POST") { converted = true; return json({ idea: { id: "idea1" } }); }
    if (url.pathname.endsWith("/ideas")) return json({ items: converted ? [{ id: "idea1", title: "外部需求", status: "NEW", score: "0" }] : [], total: converted ? 1 : 0 });
  }, ["idea:manage"]);
  qc.setQueryData(["intake-subs", "p1", null], { items: [pending], total: 1 });
  qc.setQueryData(["ideas", "p1", ""], { items: [], total: 0 });
  fireEvent.click(await screen.findByRole("button", { name: t("it.convert"), exact: true }));
  await waitFor(() => expect(converted).toBe(true));
  await screen.findByText(t("it.emptyPending"));
  fireEvent.click(screen.getByRole("button", { name: t("it.all"), exact: true }));
  await screen.findByText("外部需求", { selector: "strong" });
  await waitFor(() => expect(screen.queryByRole("button", { name: t("it.convert"), exact: true })).toBeNull());
  expect(screen.getByText("已转为想法", { selector: ".tag" })).toBeTruthy();
  await act(async () => router.navigate({ to: "/projects/$projectId/ideas", params: { projectId: "p1" } }));
  expect(await screen.findByText("外部需求")).toBeTruthy();
});

it("项目集详情英文模式完整翻译指标、状态、空态和返回入口", async () => {
  setLocale("en-US");
  mount("/portfolios/pf1", (url) => url.pathname.endsWith("/summary") ? json({
    portfolio: { id: "pf1", name: "Delivery" },
    totals: { projectCount: 0, workItemCount: 0, doneCount: 0, overdueCount: 0, completionPercent: 0 },
    projects: [], risks: [], milestones: [], activity: [],
  }) : undefined, [], "en-US");
  await screen.findByRole("heading", { name: "Delivery" });
  expect(within(screen.getByRole("main")).getByRole("link", { name: "Back to portfolios" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Project progress" })).toBeTruthy();
  expect(screen.getByText("No visible projects in this portfolio yet.")).toBeTruthy();
  expect(screen.getByText("No current risk signals.")).toBeTruthy();
  expect(within(screen.getByRole("main")).queryByText(/[\u4e00-\u9fff]/)).toBeNull();
});

it.each([
  [[], false, false, false, false],
  [["idea:submit"], true, false, false, false],
  [["idea:vote"], false, true, false, false],
  [["idea:manage"], false, false, true, false],
  [["idea:manage", "work_item:create"], false, false, true, true],
] as const)("想法写入入口与权限 %j 一致，已转换对象仍可阅读", async (permissions, canSubmit, canVote, canManage, canPromote) => {
  mount("/projects/p1/ideas", (url) => url.pathname.endsWith("/ideas") ? json({ items: [
    { id: "i1", title: "待评审想法", status: "NEW", score: "0" },
    { id: "i2", title: "已转换想法", status: "PLANNED", score: "0", promotedWorkItemId: "w1" },
  ], total: 2 }) : undefined, [...permissions]);
  await screen.findByText("待评审想法");
  expect(!!screen.queryByRole("textbox", { name: t("ideas.titleLabel") })).toBe(canSubmit);
  expect(!!screen.queryByRole("button", { name: t("ideas.voteUpLabel", { title: "待评审想法" }) })).toBe(canVote);
  expect(!!screen.queryByRole("button", { name: t("ideas.convert"), exact: true })).toBe(canPromote);
  expect(screen.queryAllByRole("button", { name: t("ideas.reject"), exact: true }).length > 0).toBe(canManage);
  expect(screen.getByRole("button", { name: t("ideas.viewWorkItem"), exact: true })).toBeTruthy();
});

it.each([false, true])("自定义字段管理入口遵守 work_item:manage_field（授权=%s）", async (canManage) => {
  mount("/projects/p1/fields", (url) => url.pathname.endsWith("/custom-fields") ? json([
    { id: "f1", key: "customer", name: "客户编号", type: "TEXT", options: [], isRequired: false, archivedAt: null },
  ]) : undefined, canManage ? ["work_item:manage_field"] : []);
  await screen.findByRole("table");
  await waitFor(() => expect(within(screen.getByRole("table")).getByText("客户编号")).toBeTruthy());
  expect(!!screen.queryByRole("button", { name: t("cf.new"), exact: true })).toBe(canManage);
  expect(screen.queryByRole("button", { name: t("cf.create"), exact: true })).toBeNull();
  if (canManage) {
    fireEvent.click(screen.getByRole("button", { name: t("cf.new"), exact: true }));
    expect(screen.getByRole("button", { name: t("cf.create"), exact: true })).toBeTruthy();
  }
  expect(!!screen.queryByRole("button", { name: t("common.edit"), exact: true })).toBe(canManage);
  expect(!!screen.queryByRole("button", { name: t("cf.archive"), exact: true })).toBe(canManage);
});
