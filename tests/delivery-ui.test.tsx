import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";
import { DeliveryPanel } from "../src/client/components/delivery/DeliveryPanel.tsx";
import { DeliveryEvidenceEditor } from "../src/client/components/delivery/DeliveryEvidenceEditor.tsx";
import { DeliverySourceEditor } from "../src/client/components/delivery/DeliverySourceEditor.tsx";
const actor = { permissions: ["work_item:update_any"] } as Actor;
const workItemId = "11111111-1111-4111-8111-111111111111";
function show(component: React.ReactNode) {
  setLocale("zh-CN");
  return render(
    <ActorContext.Provider value={actor}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {component}
      </QueryClientProvider>
    </ActorContext.Provider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("配置来源传当前版本，密钥留空不覆盖，并可重新绑定恢复后的来源", async () => {
  const projectId = "22222222-2222-4222-8222-222222222222",
    integrationId = "33333333-3333-4333-8333-333333333333",
    sourceId = "44444444-4444-4444-8444-444444444444";
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        requests.push(JSON.parse(String(init.body)));
        return Response.json({ id: sourceId });
      }
      return Response.json([
        {
          id: sourceId,
          integrationId,
          projectId,
          version: 4,
          enabled: true,
          configCurrent: true,
          hasWebhookSecret: true,
          repository: "acme/app",
        },
      ]);
    }),
  );
  show(
    <DeliverySourceEditor
      projectId={projectId}
      integrationId={integrationId}
      onClose={() => {}}
    />,
  );
  await screen.findByDisplayValue(/\/api\/v1\/delivery\/hooks\/github\//);
  expect(
    (screen.getByLabelText("Webhook 密钥") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "保存来源" }));
  await waitFor(() => expect(requests.length).toBe(1));
  expect(requests[0]).toMatchObject({
    integrationId,
    sourceId,
    expectedVersion: 4,
    enabled: true,
  });
  expect(requests[0]).not.toHaveProperty("webhookSecret");
});
it("自报成功保留待核验语义；失效来源不显示为当前已核验", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        items: [
          {
            id: "e",
            title: "本地测试",
            kind: "CI",
            status: "SUCCEEDED",
            verification: "SELF_REPORTED",
            sourceCurrent: false,
            build: "local",
            commitSha: "a".repeat(40),
            repository: "acme/app",
            url: "https://example.com/log",
            receivedAt: "2026-11-25T11:00:00Z",
            workItems: [],
          },
          {
            id: "old",
            title: "旧来源",
            kind: "CI",
            status: "FAILED",
            verification: "PROVIDER_API",
            sourceCurrent: false,
            build: "old",
            commitSha: "b".repeat(40),
            repository: "acme/app",
            url: "https://example.com/old",
            receivedAt: "2026-11-25T11:00:00Z",
            workItems: [],
          },
        ],
        nextCursor: null,
      }),
    ),
  );
  show(<DeliveryPanel projectId="p" workItemId="w" />);
  fireEvent.click(screen.getByText("交付证据"));
  await screen.findByText("本地测试");
  expect(screen.getByText("自报 · 待核验")).toBeTruthy();
  expect(screen.getByText("来源已失效")).toBeTruthy();
  expect(screen.queryByText("已核验")).toBeNull();
  expect(screen.getByText("成功").getAttribute("data-tone")).toBe("success");
  expect(screen.getByText("失败").getAttribute("data-tone")).toBe("danger");
});
it("网络失败保留登记内容，重复保存沿用同一幂等键", async () => {
  const requests: { body: Record<string, unknown>; key: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init.body)),
        key: new Headers(init.headers).get("idempotency-key"),
      });
      return Response.json(
        { code: "INTERNAL", message: "暂时失败" },
        { status: 500 },
      );
    }),
  );
  show(
    <DeliveryEvidenceEditor
      projectId="p"
      workItemId={workItemId}
      onClose={() => {}}
      onSaved={async () => {}}
    />,
  );
  for (const [label, value] of [
    ["证据标题", "本地构建"],
    ["仓库", "acme/app"],
    ["提交 SHA", "a".repeat(40)],
    ["构建标识", "local-123"],
    ["证据链接", "https://example.com/log"],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "登记证据" }));
  await screen.findByText("暂时失败");
  expect((screen.getByLabelText("证据标题") as HTMLInputElement).value).toBe(
    "本地构建",
  );
  fireEvent.click(screen.getByRole("button", { name: "登记证据" }));
  await waitFor(() => expect(requests.length).toBe(2));
  expect(requests[0]!.key).toBeTruthy();
  expect(requests[1]!.key).toBe(requests[0]!.key);
  expect(requests[0]!.body).not.toHaveProperty("verification");
});
it("失焦后说明无效证据链接和提交哈希，修正后清除错误", () => {
  show(<DeliveryEvidenceEditor projectId="p" workItemId={workItemId} onClose={() => {}} onSaved={async () => {}} />);
  const url = screen.getByLabelText("证据链接", { exact: false });
  fireEvent.change(url, { target: { value: "/Users/dev/test.log" } });
  fireEvent.blur(url);
  expect(url.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("alert").textContent).toContain("http(s)");
  fireEvent.change(url, { target: { value: "https://example.com/test" } });
  expect(screen.queryByRole("alert")).toBeNull();
  const sha = screen.getByLabelText("提交 SHA", { exact: false });
  fireEvent.change(sha, { target: { value: "abc1234" } });
  fireEvent.blur(sha);
  expect(sha.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("alert").textContent).toContain("40或64");
});
