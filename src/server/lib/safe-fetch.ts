import { Agent, Dispatcher1Wrapper } from "undici";
import { isIP } from "node:net";
import { DomainError } from "../../shared/errors.ts";
import { assertSafeOutboundUrl } from "./url-safety.ts";

/** 用户配置的出站地址：固定校验后的 DNS、拒绝跳转并限制等待时间。 */
export async function safeOutboundFetch(input: string | URL, options: RequestInit & { timeoutMs?: number } = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const { timeoutMs = 15_000, ...init } = options;
  const timeout = AbortSignal.timeout(Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 90_000)) : 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  signal.throwIfAborted();
  const { url, addresses } = await assertSafeOutboundUrl(String(input), { signal });
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const resolved = addresses.map(address => ({ address, family: isIP(address) }));
  const dispatcher = new Agent({ connect: { lookup: (hostname, options, callback) => {
    if (hostname !== host) { callback(new Error("出站连接主机与校验结果不一致"), "", 0); return; }
    const family = typeof options === "number" ? options : options.family;
    const candidates = family ? resolved.filter(address => address.family === family) : resolved;
    if (!candidates.length) { callback(new Error("没有可用的安全地址"), "", 0); return; }
    if (typeof options === "object" && options.all) callback(null, candidates);
    else callback(null, candidates[0]!.address, candidates[0]!.family);
  } } });
  try {
    // Node 24 内置 fetch 使用旧版 dispatcher 回调；官方适配器保留真实 DNS 定址。
    const response = await fetchImpl(url, { ...init, redirect: "error", signal, dispatcher: new Dispatcher1Wrapper(dispatcher) } as RequestInit);
    // 自定义传输也必须遵守边界，不能向重定向地址转发凭据或请求体。
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new DomainError("VALIDATION", "出站地址发生重定向，请配置最终地址", null);
    }
    return response;
  } finally {
    // close 等待正在读取的响应完成；不能 destroy 正在消费的流。
    void dispatcher.close().catch(() => {});
  }
}
