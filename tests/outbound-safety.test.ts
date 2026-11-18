import { afterEach, beforeEach, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ lookup: vi.fn(), options: null as null | { connect: { lookup: (...args: unknown[]) => void } }, close: vi.fn(async () => {}) }));
vi.mock("node:dns/promises", () => ({ lookup: transport.lookup }));
vi.mock("undici", () => ({ Agent: class { constructor(options: typeof transport.options) { transport.options = options; } close = transport.close; }, Dispatcher1Wrapper: class {} }));
import { isBlockedAddress, assertSafeOutboundUrl } from "../src/server/lib/url-safety.ts";
import { safeOutboundFetch } from "../src/server/lib/safe-fetch.ts";

beforeEach(() => { transport.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]); transport.close.mockClear(); transport.options = null; });
afterEach(() => vi.unstubAllEnvs());

it.each(["febf::1", "fe90::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:192.168.1.1", "::ffff:c0a8:101", "2001:db8::1", "192.0.0.1", "198.18.0.1"])("拒绝非公网地址 %s", ip => {
  expect(isBlockedAddress(ip)).toBe(true);
});
it("公网 IPv4/IPv6 仍可使用，含映射公网 IPv4", () => {
  expect(isBlockedAddress("1.1.1.1")).toBe(false);
  expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  expect(isBlockedAddress("::ffff:101:101")).toBe(false);
  expect(isBlockedAddress("192.0.78.24")).toBe(false);
  expect(isBlockedAddress("192.2.0.1")).toBe(false);
  expect(isBlockedAddress("192.0.2.1")).toBe(true);
});
it("拒绝 URL 中的内嵌凭据", async () => {
  await expect(assertSafeOutboundUrl("https://user:secret@example.test/path")).rejects.toMatchObject({ code: "VALIDATION" });
});
it("校验后的地址被固定在实际连接lookup，不再次信任DNS", async () => {
  let selected: unknown;
  const response = await safeOutboundFetch("https://example.test/api", {}, async (_url, init) => {
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeTruthy();
    transport.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    transport.options!.connect.lookup("example.test", { all: true }, (error: unknown, addresses: unknown) => { expect(error).toBeNull(); selected = addresses; });
    return new Response("ok");
  });
  expect(selected).toEqual([{ address: "1.1.1.1", family: 4 }]);
  expect(await response.text()).toBe("ok");
  expect(transport.lookup).toHaveBeenCalledTimes(1);
});
it("即使注入的传输返回重定向也拒绝，原请求体不发送到目标", async () => {
  const targets: string[] = [];
  await expect(safeOutboundFetch("https://example.test/hook", { method: "POST", body: "private" }, async (url) => {
    targets.push(String(url));
    return new Response(null, { status: 307, headers: { location: "http://127.0.0.1/admin" } });
  })).rejects.toMatchObject({ code: "VALIDATION" });
  expect(targets).toEqual(["https://example.test/hook"]);
});
it("DNS或初始URL不合法时不会调用传输", async () => {
  const fetcher = vi.fn();
  transport.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  await expect(safeOutboundFetch("https://example.test/api", {}, fetcher)).rejects.toMatchObject({ code: "VALIDATION" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("DNS迟迟不返回时仍可取消，不会继续发起请求", async () => {
  transport.lookup.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const fetcher = vi.fn();
  const request = safeOutboundFetch("https://example.test/api", { signal: controller.signal }, fetcher);
  controller.abort(new Error("cancelled"));
  await expect(request).rejects.toThrow("cancelled");
  expect(fetcher).not.toHaveBeenCalled();
});
