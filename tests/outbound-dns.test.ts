// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const dns = vi.hoisted(() => ({ lookup: vi.fn(async () => [{ address: "198.18.0.240", family: 4 }]) }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup }));
import { assertSafeOutboundUrl } from "../src/server/lib/url-safety.ts";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function serve(answers: (type: string) => unknown, status = 200) {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const url = new URL(String(input));
    // 只允许固定可信解析器，不向上游传任何业务认证头。
    expect(url.origin + url.pathname).toBe("https://1.1.1.1/dns-query");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(init.redirect).toBe("error");
    return new Response(JSON.stringify(answers(url.searchParams.get("type")!)), { status });
  });
}

it("显式HTTPS解析模式取得真实公网IPv4/IPv6，系统Fake-IP仍不作为连接地址", async () => {
  vi.stubEnv("OUTBOUND_DNS_MODE", "cloudflare");
  serve(type => ({ Status: 0, Answer: type === "A"
    ? [{ type: 5, data: "vendor.example." }, { type: 1, data: "39.96.25.223" }]
    : [{ type: 28, data: "2606:4700:4700::1111" }] }));
  const result = await assertSafeOutboundUrl("https://vendor.example/v1");
  expect(result.addresses).toEqual(["39.96.25.223", "2606:4700:4700::1111"]);
});

it.each(["127.0.0.1", "169.254.169.254", "198.18.0.1", "fd00::1"])("HTTPS解析结果仍拒绝非公网地址%s", async address => {
  vi.stubEnv("OUTBOUND_DNS_MODE", "cloudflare");
  serve(type => ({ Status: 0, Answer: type === (address.includes(":") ? "AAAA" : "A")
    ? [{ type: address.includes(":") ? 28 : 1, data: address }] : [] }));
  await expect(assertSafeOutboundUrl("https://vendor.example/v1")).rejects.toMatchObject({ code: "VALIDATION" });
});

it.each([
  { Status: 2 },
  { Status: 0, Answer: [] },
  { Status: 0, Answer: [{ type: 1, data: "not-an-ip" }] },
])("HTTPS解析失败或畸形响应时不回退到系统Fake-IP：%j", async payload => {
  vi.stubEnv("OUTBOUND_DNS_MODE", "cloudflare");
  serve(() => payload);
  await expect(assertSafeOutboundUrl("https://vendor.example/v1")).rejects.toMatchObject({ code: "VALIDATION" });
});

it("拒绝过大DNS响应，避免解析器无限返回数据", async () => {
  vi.stubEnv("OUTBOUND_DNS_MODE", "cloudflare");
  vi.stubGlobal("fetch", async () => new Response(" ".repeat(16_385) + JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "1.1.1.1" }] })));
  await expect(assertSafeOutboundUrl("https://vendor.example/v1")).rejects.toMatchObject({ code: "VALIDATION" });
});

it("未显式开启时仍使用系统解析并拒绝Fake-IP，未知解析模式也拒绝", async () => {
  vi.stubEnv("OUTBOUND_DNS_MODE", "system");
  await expect(assertSafeOutboundUrl("https://vendor.example/v1")).rejects.toMatchObject({ code: "VALIDATION" });
  vi.stubEnv("OUTBOUND_DNS_MODE", "typo");
  await expect(assertSafeOutboundUrl("https://vendor.example/v1")).rejects.toMatchObject({ code: "VALIDATION" });
});

it("HTTPS解析遵守调用者取消信号", async () => {
  vi.stubEnv("OUTBOUND_DNS_MODE", "cloudflare");
  vi.stubGlobal("fetch", (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }));
  const controller = new AbortController();
  const pending = assertSafeOutboundUrl("https://vendor.example/v1", { signal: controller.signal });
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
});
