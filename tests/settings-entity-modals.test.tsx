import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScimSettings } from "../src/client/components/settings/ScimSettings.tsx";
import { SsoSettings } from "../src/client/components/settings/SsoSettings.tsx";
import { McpClientSettings } from "../src/client/components/settings/McpClientSettings.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const idp = { id: "i1", kind: "LDAP", issuer: "ldaps://ldap.example.com", clientId: "cn=reader", hasSecret: true, enabled: false, autoProvision: false, allowedEmailDomains: null, config: { baseDn: "dc=example,dc=com", userFilter: "(mail={{username}})", startTls: true } };
const client = { id: "c1", tokenName: "桌面客户端", tier: "READ_WRITE", clientName: "desktop", callCount: 1, policies: [{ toolName: "ping", effect: "DENY" }] };
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}>{node}<DialogHost /></QueryClientProvider>);
}
it("身份源编辑在弹窗保留 LDAP 配置和空密钥；失败保留输入，关闭可拒绝丢稿", async () => {
  const posts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
    if (init?.method === "POST") { posts.push(JSON.parse(init.body)); return json({ code: "VALIDATION", message: "身份源地址不可用" }, 400); }
    return json({ idps: [idp] });
  }));
  mount(<SsoSettings onSuccess={vi.fn()} onError={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
  const modal = screen.getByRole("dialog");
  expect((within(modal).getByLabelText("Base DN") as HTMLInputElement).value).toBe("dc=example,dc=com");
  expect((screen.getByLabelText("Client Secret") as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "cn=changed" } });
  fireEvent.click(within(modal).getByRole("button", { name: "保存修改" }));
  expect((await screen.findByRole("alert")).textContent).toContain("身份源地址不可用");
  expect(posts[0]).toMatchObject({ id: "i1", kind: "LDAP", clientId: "cn=changed", config: { baseDn: "dc=example,dc=com", startTls: true } });
  expect(posts[0]).not.toHaveProperty("clientSecret");
  fireEvent.keyDown(document, { key: "Escape" });
  const discard = await screen.findByRole("dialog", { name: /未保存/ });
  fireEvent.click(within(discard).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  expect((screen.getByLabelText("Client ID") as HTMLInputElement).value).toBe("cn=changed");
  fireEvent.click(within(modal).getByRole("button", { name: "关闭" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: /未保存/ })).getByRole("button", { name: "确认" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("MCP 策略保存中禁止关闭及重复请求，失败保留草稿可重试", async () => {
  let resolve!: (response: Response) => void;
  const puts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
    if (init?.method === "PUT") { puts.push(JSON.parse(init.body)); return new Promise<Response>(done => { resolve = done; }); }
    return json({ clients: [client] });
  }));
  mount(<McpClientSettings onSuccess={vi.fn()} onError={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑策略" }));
  const modal = screen.getByRole("dialog");
  fireEvent.click(within(modal).getByRole("button", { name: "移除" }));
  fireEvent.click(within(modal).getByRole("button", { name: "保存策略" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((screen.getByLabelText("工具名") as HTMLInputElement).matches(":disabled")).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(within(modal).getByRole("button", { name: "关闭" }));
  fireEvent.click(within(modal).getByRole("button", { name: "保存策略" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(puts).toHaveLength(1);
  resolve(json({ code: "CONFLICT", message: "策略保存冲突" }, 409));
  expect((await screen.findByRole("alert")).textContent).toContain("策略保存冲突");
  expect(within(modal).queryByRole("button", { name: "移除" })).toBeNull();
  expect((within(modal).getByRole("button", { name: "保存策略" }) as HTMLButtonElement).disabled).toBe(false);
});

it("SCIM 令牌创建与API令牌一致使用 Modal，失败保留名称，成功后一次性明文持续展示", async () => {
  let attempt = 0;
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => init?.method === "POST"
    ? (++attempt === 1 ? json({ code: "CONFLICT", message: "令牌创建失败" }, 409) : json({ token: "scim-once-modal" }))
    : json({ tokens: [] })));
  mount(<ScimSettings onSuccess={vi.fn()} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "创建 SCIM 令牌" }));
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText("令牌名称"), { target: { value: "目录同步" } });
  fireEvent.click(within(modal).getByRole("button", { name: "创建 SCIM 令牌" }));
  expect((await screen.findByRole("alert")).textContent).toContain("令牌创建失败");
  expect((screen.getByLabelText("令牌名称") as HTMLInputElement).value).toBe("目录同步");
  fireEvent.click(within(modal).getByRole("button", { name: "创建 SCIM 令牌" }));
  await screen.findByText("scim-once-modal");
  expect(screen.queryByRole("dialog")).toBeNull();
});
