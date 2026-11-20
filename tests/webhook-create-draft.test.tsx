import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebhookSettings } from "../src/client/components/settings/WebhookSettings.tsx";
import { setLocale } from "../src/client/i18n/index.ts";
import { confirmDialog } from "../src/client/components/Dialog.tsx";

vi.mock("../src/client/components/Dialog.tsx", () => ({ confirmDialog: vi.fn() }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const endpoint = { id: "w1", name: "构建事件", url: "https://example.com/hook", events: ["work_item.created"], isActive: true };

beforeEach(() => { setLocale("zh-CN"); vi.mocked(confirmDialog).mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(post: (body: unknown) => Promise<Response> = async () => json({ endpoint, secret: "one-time-signing-secret" }), compact = false) {
  const requests: unknown[] = [];
  const onSuccess = vi.fn();
  const onError = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/v1/webhooks") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return post(body);
    }
    if (String(input).endsWith("/api/v1/webhooks")) return json({ endpoints: [] });
    return json({}, 404);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><WebhookSettings compact={compact} onSuccess={onSuccess} onError={onError} /></QueryClientProvider>);
  return { requests, onSuccess, onError };
}

function openAndFill() {
  fireEvent.click(screen.getByRole("button", { name: "新建 Webhook" }));
  fireEvent.change(screen.getByLabelText("Webhook 名称"), { target: { value: "构建事件" } });
  fireEvent.change(screen.getByLabelText("Webhook 地址"), { target: { value: "https://example.com/hook" } });
}

describe("Webhook 按需创建与草稿", () => {
  it("紧凑行将空态收为未配置提示，添加按钮保留完整名称，签名详情按需展示", async () => {
    setup(undefined, true);
    await screen.findByText("未配置");
    expect(screen.queryByText("还没有 Webhook")).toBeNull();
    expect(screen.queryByText(/sha256=<hex>/)).toBeNull();
    const add = screen.getByRole("button", { name: "添加 Webhook" });
    expect(add.textContent).toBe("添加");
    fireEvent.click(add);
    expect(screen.getByText(/sha256=<hex>/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByLabelText("Webhook 名称")).toBeNull());
  });
  it("默认只展示空态，共享弹窗接管焦点，未编辑关闭无需丢稿确认", async () => {
    setup();
    await screen.findByText("还没有 Webhook");
    expect(screen.queryByLabelText("Webhook 名称")).toBeNull();
    const add = screen.getByRole("button", { name: "新建 Webhook" });
    add.focus();
    fireEvent.click(add);
    expect(screen.getByRole("dialog", { name: "新建 Webhook" })).toBeTruthy();
    expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
    expect(add.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByLabelText("Webhook 名称")).toBeNull());
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(add);
  });

  it("取消已编辑草稿可拒绝丢弃，确认后重开恢复默认值", async () => {
    setup();
    vi.mocked(confirmDialog).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    openAndFill();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("Webhook 名称") as HTMLInputElement).value).toBe("构建事件");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "新建 Webhook" }));
    expect((screen.getByLabelText("Webhook 名称") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Webhook 事件") as HTMLInputElement).value).toBe("work_item.created");
  });

  it("提交中锁定字段和取消并防止重复请求，成功折叠且密钥持续展示", async () => {
    let resolve!: (response: Response) => void;
    const { requests, onSuccess } = setup(() => new Promise<Response>(done => { resolve = done; }));
    openAndFill();
    fireEvent.change(screen.getByLabelText("Webhook 事件"), { target: { value: "work_item.created, work_item.updated, " } });
    const submit = screen.getByRole("button", { name: "创建" });
    fireEvent.click(submit);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Webhook 名称") as HTMLInputElement).matches(":disabled")).toBe(true);
    fireEvent.click(submit);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.mouseDown(document.querySelector(".ui-modal-scrim")!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ name: "构建事件", url: "https://example.com/hook", events: ["work_item.created", "work_item.updated"] });
    resolve(json({ endpoint, secret: "one-time-signing-secret" }));
    await screen.findByText("one-time-signing-secret");
    expect(screen.getByRole("status").textContent).toContain("只显示这一次");
    expect(screen.queryByLabelText("Webhook 名称")).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith("Webhook 已创建");
    fireEvent.click(screen.getByRole("button", { name: "新建 Webhook" }));
    expect(screen.getByText("one-time-signing-secret")).toBeTruthy();
  });

  it("服务器拒绝时在表单内显示原因并保留输入，允许修正后重试", async () => {
    let attempt = 0;
    const { requests } = setup(async () => ++attempt === 1
      ? json({ code: "VALIDATION", message: "不允许访问该地址", details: null }, 400)
      : json({ endpoint, secret: "retry-secret" }));
    openAndFill();
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect((await screen.findByRole("alert")).textContent).toContain("不允许访问该地址");
    expect((screen.getByLabelText("Webhook 名称") as HTMLInputElement).value).toBe("构建事件");
    expect((screen.getByLabelText("Webhook 地址") as HTMLInputElement).value).toBe("https://example.com/hook");
    fireEvent.change(screen.getByLabelText("Webhook 地址"), { target: { value: "https://example.org/hook" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await screen.findByText("retry-secret");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ url: "https://example.org/hook" });
  });
});
