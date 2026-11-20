/** 设置页与字段管理页（第八期 W5/W6） */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试",
  permissions: ["work_item:manage_field", "setting:manage", "ai:configure", "integration:manage", "apikey:manage_any"], dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};
function stub(routes: Record<string, [number, unknown]>) {
  const fetchMock = vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    for (const [k, [status, body]] of Object.entries(routes)) {
      if (u.includes(k)) return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  // jsdom 的 URL 在用例间会保留；SettingsPage 从 URL 读取初始 tab，必须在每个用例前复位
  window.history.replaceState(null, "", "/");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const P = "11111111-1111-1111-1111-111111111111";

describe("个人设置页", () => {
  it("密码留空说明只在字段标签展示一次", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: null, density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: {}, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [200, { settings: [] }],
      "/api/v1/webhooks": [200, { endpoints: [] }],
      "/api/v1/knowledge/ai-status": [200, { configured: false, dimensionOk: false }],
      "/api/v1/ai/providers": [200, { providers: [] }],
      "/api/v1/ai/usage": [200, { usage: [] }],
      "/api/v1/skills": [200, { skills: [] }],
      "/api/v1/auth/2fa": [200, { enabled: false, pending: false }],
      "/api/v1/projects": [200, { projects: [] }],
      "/api/v1/notifications": [200, { notifications: [] }],
    });
    renderAt("/settings/instance");
    await screen.findByLabelText("SMTP 密码");
    expect(screen.getAllByText("密码（留空=不改）")).toHaveLength(1);
  });

  it("Webhook 签名提示将十六进制占位符显示为尖括号", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: "Asia/Shanghai", density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: {}, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [200, { settings: [] }],
    });
    renderAt("/settings/integrations");
    fireEvent.click(await screen.findByRole("tab", { name: "消息与 Webhook" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加 Webhook" }));
    expect(await screen.findByText(/sha256=<hex>/)).toBeTruthy();
  });

  it("回显偏好与 SMTP（密码不显示明文）", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/me/preferences": [200, { theme: "dark", locale: "zh-CN", timezone: "Asia/Shanghai", density: "compact" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: {}, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [200, { settings: [
        { key: "smtp.host", value: "smtp.example.com", isSecret: false },
        { key: "smtp.password", value: "********", isSecret: true },
      ] }],
    });
    renderAt("/settings/personal");
    await waitFor(() => expect(screen.getByRole("tab", { name: "外观与区域" })).toBeTruthy());
    // ⚠️ 标题先渲染、数据后回填 —— 必须等 select 的值真的变成回显值再断言
    // 主题控件已从原生 <select> 换为自绘 Select（用户要求第 4 条）：
    // 不再有 .value 属性，改为断言触发按钮上显示的文案（= 真实用户看到的东西）
    await waitFor(() => expect(screen.getByLabelText("界面主题").textContent).toContain("深色"));
    // 时区已从自由文本改为**可搜索下拉**（同一套下拉触发器断言文案，不再有 .value）
    await waitFor(() => expect(screen.getByLabelText("时区").textContent).toContain("Asia/Shanghai"));
  });

  it("SMTP 回显（密码不显示明文）", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/settings": [200, { settings: [
        { key: "smtp.host", value: "smtp.example.com", isSecret: false },
        { key: "smtp.password", value: "********", isSecret: true },
      ] }],
    });
    renderAt("/settings/instance");
    await waitFor(() => expect((screen.getByLabelText("SMTP 主机") as HTMLInputElement).value).toBe("smtp.example.com"));
    expect((screen.getByLabelText("SMTP 密码") as HTMLInputElement).value).toBe("");
  });

  it("无 setting:manage 时不显示 SMTP 区块（后端 403 静默隐藏）", async () => {
    stub({
      "/api/v1/auth/me": [200, { ...ACTOR, permissions: [] }],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: null, density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: {}, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [403, { code: "FORBIDDEN", message: "无权", details: null }],
    });
    renderAt("/settings/personal");
    await waitFor(() => expect(screen.getByRole("tab", { name: "外观与区域" })).toBeTruthy());
    expect(screen.queryByText("SMTP（发信）")).toBeNull();
  });

  it("分类开关落在 categoryPrefs 上", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: null, density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: { ASSIGN: { inApp: false } }, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [403, { code: "FORBIDDEN", message: "无权", details: null }],
    });
    renderAt("/settings/personal");
    fireEvent.click(await screen.findByRole("tab", { name: "通知" }));
    // 勾选控件已从原生 input 换为 role=checkbox 的按钮（用户要求第 4 条）→ 断言 aria-checked（等价语义）
    await waitFor(() => expect(screen.getByLabelText("指派给我 站内").getAttribute("aria-checked")).toBe("false"));
  });

  it("显示邮件通知的真实设置方式，并把强通知标为始终开启", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: null, density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: { MENTION: { inApp: false } }, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [403, { code: "FORBIDDEN", message: "无权", details: null }],
    });
    renderAt("/settings/personal");

    fireEvent.click(await screen.findByRole("tab", { name: "通知" }));
    expect(await screen.findByText(/邮件投递由工作项关注渠道控制/)).toBeTruthy();
    const mention = screen.getByLabelText("@提及（强通知，不受免打扰影响） 站内");
    expect(mention.getAttribute("aria-checked")).toBe("true");
    expect(mention.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByLabelText("指派给我 邮件")).toBeNull();
  });

  it("删除 Webhook 时使用服务端定义的 DELETE 端点", async () => {
    const webhookId = "22222222-2222-2222-2222-222222222222";
    const fetchMock = stub({
      "/api/v1/auth/me": [200, ACTOR],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: null, density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: {}, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [200, { settings: [] }],
      "/api/v1/knowledge/ai-status": [200, { configured: false, message: "未配置" }],
      "/api/v1/ai/providers": [200, { providers: [] }],
      "/api/v1/ai/usage": [200, { usage: [] }],
      "/api/v1/webhooks": [200, { endpoints: [{ id: webhookId, name: "Build event", url: "https://example.com/hooks", events: ["work_item.created"], isActive: true }] }],
      [webhookId]: [200, { ok: true }],
      "/api/v1/skills": [200, { skills: [] }],
    });
    renderAt("/settings/integrations");
    fireEvent.click(await screen.findByRole("tab", { name: "消息与 Webhook" }));

    await screen.findByText("Build event");
    // Round 98：危险操作需要二次确认
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes(webhookId) && init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes(webhookId) && init?.method === "DELETE")).toBe(true);
    });
  });
});

describe("设置页权限边界", () => {
  it("setting:manage 不会开放 AI、Skill 或 Webhook 管理入口", async () => {
    const fetchMock = stub({
      "/api/v1/auth/me": [200, { ...ACTOR, permissions: ["setting:manage"] }],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: null, density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: {}, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/settings": [200, { settings: [] }],
      "/api/v1/knowledge/ai-status": [200, { configured: false, message: "未配置" }],
    });
    renderAt("/settings/instance");

    expect(await screen.findByLabelText("SMTP 主机")).toBeTruthy();
    expect(screen.queryByLabelText("LLM Base URL")).toBeNull();
    expect(screen.queryByLabelText("Webhook 名称")).toBeNull();
    expect(screen.queryByLabelText("Skill 名称")).toBeNull();
    const requested = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requested.some((url) => url.includes("/api/v1/ai/providers"))).toBe(false);
    expect(requested.some((url) => url.includes("/api/v1/webhooks"))).toBe(false);
    expect(requested.some((url) => url.includes("/api/v1/skills"))).toBe(false);
  });

  it("AI 与集成权限分别开放各自入口，不依赖 SMTP 设置权限", async () => {
    const fetchMock = stub({
      "/api/v1/auth/me": [200, { ...ACTOR, permissions: ["ai:configure", "integration:manage"] }],
      "/api/v1/me/preferences": [200, { theme: "system", locale: "zh-CN", timezone: null, density: "comfortable" }],
      "/api/v1/notification-preferences": [200, { categoryPrefs: {}, dndStart: null, dndEnd: null, dndTimezone: "Asia/Shanghai" }],
      "/api/v1/knowledge/ai-status": [200, { configured: false, message: "未配置" }],
      "/api/v1/ai/providers": [200, { providers: [] }],
      "/api/v1/ai/usage": [200, { usage: [] }],
      "/api/v1/webhooks": [200, { endpoints: [] }],
      "/api/v1/skills": [200, { skills: [] }],
    });
    renderAt("/settings/integrations");

    expect(await screen.findByText("对话模型（LLM）")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "添加供应商" })[0]!);
    await waitFor(() => expect(screen.getByLabelText("LLM Base URL")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("tab", { name: "消息与 Webhook" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加 Webhook" }));
    await waitFor(() => expect(screen.getByLabelText("Webhook 名称")).toBeTruthy());
    expect(screen.queryByLabelText("SMTP 主机")).toBeNull();
    const requested = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requested.some((url) => url.includes("/api/v1/settings"))).toBe(false);
  });
});

describe("自定义字段管理页", () => {
  it("列表行使用统一行样式（图标头像 + 名称）—— 结构断言", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      [`/api/v1/projects/${P}/custom-fields`]: [200, [
        { id: "f1", key: "customer", name: "客户", type: "TEXT", options: [], isRequired: true, archivedAt: null },
      ]],
    });
    renderAt(`/projects/${P}/fields`);
    // 左树里也会出现字段名（同一份数据两个视图），因此按表格行定位而不是全局文本
    await waitFor(() => expect(document.querySelector("tbody tr .row-name")?.textContent).toBe("客户"));
    const row = document.querySelector("tbody tr")!;
    // 只断言**确实存在**的结构：stub 里 archivedAt 为 null，因此这里不涉及"已归档药丸"（不硬套断言）
    expect(row.querySelector(".row-avatar")).toBeTruthy();
    expect(row.querySelector(".row-name")?.textContent).toBe("客户");
  });

  it("空态 + 选项输入仅在选择类类型时出现", async () => {
    stub({ "/api/v1/auth/me": [200, ACTOR], [`/api/v1/projects/${P}/custom-fields`]: [200, []] });
    renderAt(`/projects/${P}/fields`);
    await waitFor(() => expect(screen.getByText(/还没有自定义字段/)).toBeTruthy());
    expect(screen.queryByLabelText("选项")).toBeNull();
    // 类型控件已从原生 <select> 换为系统自绘 Select（用户要求第 4 条）：
    // 原生 selectOptions/change 不再适用，改为"点开触发器 → 点选项"，这也是真实用户路径。
    fireEvent.click(screen.getByRole("button", { name: "新建字段", exact: true }));
    fireEvent.click(screen.getByLabelText("字段类型"));
    fireEvent.click(screen.getByRole("option", { name: "单选" }));
    await waitFor(() => expect(screen.getByLabelText("选项")).toBeTruthy());
  });

  it("列表展示类型中文名与归档标记，归档字段不给归档按钮", async () => {
    stub({
      "/api/v1/auth/me": [200, ACTOR],
      [`/api/v1/projects/${P}/custom-fields`]: [200, [
        { id: "f1", key: "customer", name: "客户", type: "TEXT", options: [], isRequired: true, archivedAt: null },
        { id: "f2", key: "channel", name: "渠道", type: "SINGLE_SELECT", options: [{ value: "web", label: "网页" }], isRequired: false, archivedAt: "2026-10-01T00:00:00Z" },
      ]],
    });
    renderAt(`/projects/${P}/fields`);
    await waitFor(() => expect(document.querySelector("tbody tr .row-name")?.textContent).toBe("客户"));
    // 类型名在下拉选项 / 左树分组里也出现，故容许多匹配
    expect(screen.getAllByText("文本").length).toBeGreaterThan(0);
    expect(screen.getAllByText("单选").length).toBeGreaterThan(0);
    expect(screen.getByText(/已归档（值仍保留）/)).toBeTruthy();
    // 已归档行不再提供归档按钮：只剩 1 个
    expect(screen.getAllByText("归档").length).toBe(1);
  });
});
