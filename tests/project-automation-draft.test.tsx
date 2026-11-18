import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectAutomationPage } from "../src/client/routes/ProjectAutomationPage.tsx";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const actor: Actor = { memberId: "m1", name: "管理员", username: "admin", permissions: ["project:update"], dataScopes: [{ scopeType: "ORG", scopeId: null }], locale: "zh-CN", timezone: "Asia/Shanghai", theme: null, mustChangePassword: false };
const clients: QueryClient[] = [];
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const select = (label: string, option: string) => {
  fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
  fireEvent.click(screen.getByRole("option", { name: option, exact: true }));
};
const tab = (name: string) => {
  fireEvent.click(screen.getByRole("tab", { name }));
  const create = screen.queryByRole("button", { name: name === "SLA 策略" ? "新建 SLA 策略" : "新建规则", exact: true });
  if (create) fireEvent.click(create);
};

beforeEach(() => { setLocale("zh-CN"); vi.stubGlobal("scrollTo", () => {}); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

async function mount() {
  const rules: Record<string, unknown>[] = [], policies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const path = String(url);
    if (path.endsWith("/automation-rules")) {
      if (init?.method === "POST") { const rule = { id: "r1", ...JSON.parse(String(init.body)) }; rules.push(rule); return json(rule); }
      return json({ rules });
    }
    if (path.endsWith("/sla-policies")) {
      if (init?.method === "POST") { const policy = { id: "s1", enabled: true, ...JSON.parse(String(init.body)) }; policies.push(policy); return json(policy); }
      return json({ policies });
    }
    if (path.includes("/automation-runs")) return json({ runs: [] });
    if (path.endsWith("/members")) return json({ members: [{ id: "m1", name: "张三", username: "zhangsan" }] });
    if (path.includes("/workflows?")) return json([{ id: "w1" }]);
    if (path.endsWith("/states")) return json([{ key: "done", name: "已完成" }]);
    if (path.endsWith("/iterations") || path.endsWith("/milestones")) return json([]);
    throw new Error(`未预期的请求 ${path}`);
  }));
  const root = createRootRoute({ component: () => <><Outlet /><DialogHost /></> });
  const edit = createRoute({ getParentRoute: () => root, path: "/projects/$projectId/automation", component: ProjectAutomationPage });
  const home = createRoute({ getParentRoute: () => root, path: "/home", component: () => <h1>已离开配置</h1> });
  const router = createRouter({ routeTree: root.addChildren([edit, home]), history: createMemoryHistory({ initialEntries: ["/projects/p1/automation"] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<ActorContext.Provider value={actor}><QueryClientProvider client={client}>{/* @ts-expect-error 隔离路由测试 */}<RouterProvider router={router} /></QueryClientProvider></ActorContext.Provider>);
  await screen.findByText("还没有自动化规则。");
  expect(screen.queryByRole("button", { name: "创建规则", exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新建规则", exact: true }));
  return {
    leave: () => act(() => { void router.navigate({ to: "/home" }); }),
    expectBlocked: async () => {
      await screen.findByText("有未保存的修改。确认放弃修改并关闭？");
      expect(router.state.location.pathname).toBe("/projects/p1/automation");
      fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  };
}

it("未编辑自动化或 SLA 时可直接离开", async () => {
  const page = await mount();
  page.leave();
  await screen.findByRole("heading", { name: "已离开配置" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("收起规则配置后草稿仍受保护，重新展开保留输入", async () => {
  const page = await mount();
  change("规则名称", "工作日提醒");
  select("触发时机", "定时触发");
  change("cron 表达式", "0 10 * * 1-5");
  fireEvent.click(screen.getByRole("button", { name: "收起配置", exact: true }));
  expect(screen.queryByRole("button", { name: "创建规则", exact: true })).toBeNull();
  page.leave(); await page.expectBlocked();
  fireEvent.click(screen.getByRole("button", { name: "新建规则", exact: true }));
  expect((screen.getByLabelText("规则名称") as HTMLInputElement).value).toBe("工作日提醒");
  expect((screen.getByLabelText("cron 表达式") as HTMLInputElement).value).toBe("0 10 * * 1-5");
});

it.each([
  ["触发时机", () => select("触发时机", "工作项更新"), () => select("触发时机", "工作项创建")],
  ["条件值", () => select("条件值", "高"), () => select("条件值", "紧急")],
  ["动作成员", () => select("动作 1 成员", "张三 (zhangsan)"), () => select("动作 1 成员", "选择成员")],
  ["启用状态", () => fireEvent.click(screen.getByRole("checkbox", { name: "启用", exact: true })), () => fireEvent.click(screen.getByRole("checkbox", { name: "启用", exact: true }))],
] as const)("自动化仅修改%s也阻止离开，恢复原值后可直接离开", async (_label, edit, revert) => {
  const page = await mount(); edit();
  expect((screen.getByLabelText("规则名称") as HTMLInputElement).value).toBe("");
  page.leave(); await page.expectBlocked();
  revert(); page.leave();
  await screen.findByRole("heading", { name: "已离开配置" });
});

it.each([
  ["优先级", () => select("优先级", "高"), () => select("优先级", "不限")],
  ["严重度", () => select("严重度", "S1"), () => select("严重度", "不限")],
  ["响应时限", () => change("响应时限（分钟）", "30"), () => change("响应时限（分钟）", "60")],
  ["工作时间", () => fireEvent.click(screen.getByRole("checkbox", { name: "仅工作时间计时" })), () => fireEvent.click(screen.getByRole("checkbox", { name: "仅工作时间计时" }))],
] as const)("SLA 仅修改%s也阻止离开，恢复原值后可直接离开", async (_label, edit, revert) => {
  const page = await mount(); tab("SLA 策略"); edit();
  expect((screen.getByLabelText("策略名称") as HTMLInputElement).value).toBe("");
  page.leave(); await page.expectBlocked();
  revert(); page.leave();
  await screen.findByRole("heading", { name: "已离开配置" });
});

it("定时规则保存后使用保留配置作为基线，再只改时区仍受保护", async () => {
  const page = await mount();
  change("规则名称", "工作日提醒"); select("触发时机", "定时触发");
  change("cron 表达式", "0 10 * * 1-5"); change("时区", "UTC");
  select("动作 1", "添加评论"); change("评论文案", "请跟进");
  fireEvent.click(screen.getByRole("button", { name: "创建规则", exact: true }));
  await screen.findByText("工作日提醒");
  await waitFor(() => expect((screen.getByLabelText("规则名称") as HTMLInputElement).value).toBe(""));
  expect((screen.getByLabelText("cron 表达式") as HTMLInputElement).value).toBe("0 10 * * 1-5");
  change("时区", "Asia/Shanghai"); page.leave(); await page.expectBlocked();
  change("时区", "UTC"); page.leave();
  await screen.findByRole("heading", { name: "已离开配置" });
});

it("SLA 保存后使用保留日历作为基线，再只改节假日仍受保护", async () => {
  const page = await mount(); tab("SLA 策略");
  change("策略名称", "工作日响应"); fireEvent.click(screen.getByRole("checkbox", { name: "仅工作时间计时" }));
  change("上班时间", "08:00"); change("下班时间", "17:00");
  change("法定节假日", "2026-10-01"); change("调休上班日", "2026-10-10");
  fireEvent.click(screen.getByRole("button", { name: "创建策略", exact: true }));
  await screen.findByText("工作日响应");
  await waitFor(() => expect((screen.getByLabelText("策略名称") as HTMLInputElement).value).toBe(""));
  change("法定节假日", "2026-10-01,2026-10-02"); page.leave(); await page.expectBlocked();
  change("法定节假日", "2026-10-01"); page.leave();
  await screen.findByRole("heading", { name: "已离开配置" });
});

it("保存规则只清理规则草稿，另一个 SLA 草稿继续阻止离开", async () => {
  const page = await mount(); tab("SLA 策略"); change("解决时限（分钟）", "240");
  tab("自动化规则"); change("规则名称", "紧急指派"); select("动作 1 成员", "张三 (zhangsan)");
  fireEvent.click(screen.getByRole("button", { name: "创建规则", exact: true }));
  await screen.findByText("紧急指派"); page.leave(); await page.expectBlocked();
  tab("SLA 策略"); expect((screen.getByLabelText("解决时限（分钟）") as HTMLInputElement).value).toBe("240");
  change("策略名称", "四小时解决"); fireEvent.click(screen.getByRole("button", { name: "创建策略", exact: true }));
  await screen.findByText("四小时解决"); page.leave();
  await screen.findByRole("heading", { name: "已离开配置" });
});

it("保存 SLA 只清理 SLA 草稿，另一个规则草稿继续阻止离开", async () => {
  const page = await mount(); select("条件值", "高");
  tab("SLA 策略"); change("策略名称", "升级跟进"); change("超时通知角色", "ADMIN,OWNER");
  fireEvent.click(screen.getByRole("button", { name: "创建策略", exact: true }));
  await screen.findByText("升级跟进"); page.leave(); await page.expectBlocked();
  tab("自动化规则"); expect(screen.getByRole("button", { name: "条件值", exact: true }).textContent).toContain("高");
  change("规则名称", "高优先级"); fireEvent.click(screen.getByRole("button", { name: "创建规则", exact: true }));
  await screen.findByText("高优先级"); page.leave();
  await screen.findByRole("heading", { name: "已离开配置" });
});
