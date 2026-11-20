/** 系统自检页（第十四期）：迁移一致性告警、备份三件套提示、AI 降级说明、我的安全 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试", permissions: ["setting:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
function stub(routes: Record<string, [number, unknown]>) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    for (const [k, [status, body]] of Object.entries(routes)) {
      if (u.includes(k)) return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}
function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/system"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}
// 页签化后：断言非概览内容前先切页签（概览只保留状态横幅 + KPI）；路由挂载是异步的，先等壳渲染
async function switchTab(label: string) {
  await waitFor(() => expect(screen.getAllByText("系统自检").length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("tab", { name: label }));
}
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const MIG_OK = { applied: 25, files: 25, consistent: true, latestAppliedAt: "2026-11-01", externalDatabase: false,
  upgradeFlow: ["1 备份（数据库 + 附件 + 密钥，三者缺一不可）", "2 拉取新镜像", "3 执行迁移（多副本需分布式锁，只跑一次）", "4 健康检查（/api/v1/system/status）", "5 失败则回滚镜像并恢复备份"], notes: [] };
const OPS = {
  generatedAt: "2026-10-23T00:00:00.000Z",
  webhooks: { endpoints: 2, pending: 1, retrying: 3, dead: 4, succeeded: 10 },
  retention: { auditDays: 365, activityDays: 90, auditRows: 120, activityRows: 340 },
  integrations: { total: 2, active: 1 },
  featureFlags: { total: 3, enabled: 2 },
  mcp: { clients: 1, calls: 7, policies: 2 },
  knowledge: { queries30d: 12 },
  jobs: { PENDING: 0, RUNNING: 0, SUCCEEDED: 3, FAILED: 0, DEAD: 0 },
  schedulers: { snapshotIntervalMs: 3_600_000, retentionSweepIntervalMs: 86_400_000, webhookRetryIntervalMs: 30_000, integrationSyncIntervalMs: 21_600_000, jobWorkerIntervalMs: 5_000 },
};
const MIG_BAD = { ...MIG_OK, applied: 23, files: 25, consistent: false, notes: ["迁移账本 23 条与文件 25 个不一致 —— 手工补写的迁移文件必须登记进 drizzle.__drizzle_migrations，否则会静默跳过或重放"] };

describe("系统自检页", () => {
  it("迁移一致时显示绿色标记与升级流程", async () => {
    stub({ "/auth/me": [200, ACTOR], "/system/status": [200, { ok: true, version: "1.0.0" }],
      "/system/migrations": [200, MIG_OK], "/knowledge/ai-status": [200, { configured: false, dimensionOk: true, message: "未配置 AI（BYOK）；知识检索将使用关键词模式" }],
      "/auth/2fa": [200, { enabled: true, pending: false }] });
    renderPage();
    await waitFor(() => expect(screen.getAllByText("系统自检").length).toBeGreaterThan(0));
    switchTab("数据");
    await waitFor(() => expect(document.body.textContent).toContain("一致"));
    expect(document.body.textContent).toMatch(/1 备份（数据库 \+ 附件 \+ 密钥/);
    expect(document.body.textContent).toContain("正常");
  });

  it("迁移账本与文件不一致时**显眼告警**（升级失败最常见根因）", async () => {
    stub({ "/auth/me": [200, ACTOR], "/system/status": [200, { ok: true, version: "1.0.0" }],
      "/system/migrations": [200, MIG_BAD], "/knowledge/ai-status": [200, { configured: false, dimensionOk: true, message: "未配置" }],
      "/auth/2fa": [200, { enabled: false, pending: false }] });
    renderPage();
    await switchTab("数据");
    await waitFor(() => expect(document.body.textContent).toContain("不一致"));
    expect(document.body.textContent).toMatch(/静默跳过或重放/);
  });

  it("数据库灾备与同构恢复说明默认折叠在运维区域", async () => {
    stub({ "/auth/me": [200, ACTOR], "/system/status": [200, { ok: true, version: "1" }],
      "/system/migrations": [200, MIG_OK], "/knowledge/ai-status": [200, { configured: false, dimensionOk: true, message: "未配置" }],
      "/auth/2fa": [200, { enabled: false, pending: false }] });
    renderPage();
    await switchTab("运维");
    const details = screen.getByText("数据库灾备与同构恢复");
    fireEvent.click(details);
    await waitFor(() => expect(document.body.textContent).toMatch(/备份必须包含/));
    expect(details.closest("details")?.open).toBe(true);
    expect(document.body.textContent).toMatch(/少了密钥，敏感设置的密文将永远解不开/);
    expect(screen.getByText(/scripts\/backup\.sh/)).toBeTruthy();
    expect(document.body.textContent).toContain("恢复步骤（演练过再上生产）");
  });

  it("未配置 AI 时说明会退化为关键词（不是错误状态）", async () => {
    stub({ "/auth/me": [200, ACTOR], "/system/status": [200, { ok: true, version: "1" }],
      "/system/migrations": [200, MIG_OK],
      "/knowledge/ai-status": [200, { configured: false, dimensionOk: true, message: "未配置 AI（BYOK）；知识检索将使用关键词模式" }],
      "/auth/2fa": [200, { enabled: false, pending: true }] });
    renderPage();
    await switchTab("集成与更新");
    await waitFor(() => expect(document.body.textContent).toMatch(/未配置 AI（BYOK）/));
    expect(document.body.textContent).toMatch(/退化为关键词模式/);
    // 个人安全在独立页签
    await switchTab("安全");
    expect(document.body.textContent).toContain("已生成密钥待激活");
    expect(document.body.textContent).toContain("下载我的数据（JSON）");
  });

  it("外部数据库时明确写出备份责任转移", async () => {
    stub({ "/auth/me": [200, ACTOR], "/system/status": [200, { ok: true, version: "1" }],
      "/system/migrations": [200, { ...MIG_OK, externalDatabase: true, notes: ["检测到外部数据库：迁移仍会执行，但**备份不由平台保证**"] }],
      "/knowledge/ai-status": [200, { configured: false, dimensionOk: true, message: "未配置" }],
      "/auth/2fa": [200, { enabled: false, pending: false }] });
    renderPage();
    await switchTab("数据");
    // 外部数据库提示：迁移备注与备份区都写明备份责任（页面级告警在概览页签）
    await waitFor(() => expect(screen.getAllByText(/外部数据库/).length).toBeGreaterThan(0));
    expect(document.body.textContent).toMatch(/备份不由平台保证/);
  });

  it("运维状态卡展示 Webhook 投递、保留期与后台调度聚合", async () => {
    stub({ "/auth/me": [200, ACTOR], "/system/status": [200, { ok: true, version: "1" }],
      "/system/migrations": [200, MIG_OK], "/knowledge/ai-status": [200, { configured: false, dimensionOk: true, message: "未配置" }],
      "/auth/2fa": [200, { enabled: false, pending: false }], "/system/operations": [200, OPS] });
    renderPage();
    await switchTab("运维");
    await waitFor(() => expect(document.body.textContent).toContain("运维状态"));
    // 仪表盘化后是「标签 + 数值」两列（textContent 没有空格），且调度明细默认收起
    await waitFor(() => expect(document.body.textContent).toContain("死信4"));
    expect(document.body.textContent).toContain("启用集成");
    expect(document.body.textContent).toContain("近 30 天查询");
    expect(document.body.textContent).toContain("任务队列");
    fireEvent.click(screen.getByText("后台调度间隔"));
    await waitFor(() => expect(document.body.textContent).toContain("集成同步"));
    expect(document.body.textContent).toContain("30s");
    expect(document.body.textContent).toContain("Webhook 重试");
  });
});
