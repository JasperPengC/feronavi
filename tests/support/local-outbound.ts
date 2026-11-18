/** 只在隔离测试进程中把指定公网端点映射到本地模拟服务。 */
import { createServer } from "node:http";

/** 假供应商响应仍通过真实 TCP/HTTP 请求与响应流；不连接真实外部服务。 */
export async function startLocalHttpResponder(publicOrigin: string, respond: typeof fetch) {
  if (!/^feronavi_test_[a-f0-9]{32}$/u.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) {
    throw new Error("出站模拟只允许在隔离测试库运行");
  }
  let requests = 0;
  const server = createServer(async (req, res) => {
    try {
      requests++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""]));
      const response = await respond(new URL(req.url!, publicOrigin), { method: req.method, headers, ...(body.length ? { body: body.toString() } : {}) });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode = 500; res.end("fixture response failed"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const localOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const fetchImpl: typeof fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== publicOrigin) throw new Error("测试禁止连接未配置的外部服务");
    const options = { ...init } as RequestInit & { dispatcher?: unknown };
    delete options.dispatcher;
    return fetch(new URL(`${target.pathname}${target.search}`, localOrigin), options);
  };
  return {
    fetchImpl,
    get requests() { return requests; },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

export function useLocalOutboundMock(publicOrigin: string, localOrigin: string): () => void {
  if (!/^feronavi_test_[a-f0-9]{32}$/u.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) {
    throw new Error("出站模拟只允许在隔离测试库运行");
  }
  const local = new URL(localOrigin);
  if (local.hostname !== "127.0.0.1" || local.protocol !== "http:") throw new Error("模拟服务必须是本地 HTTP");
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === publicOrigin) {
      const options = { ...init } as RequestInit & { dispatcher?: unknown };
      delete options.dispatcher;
      return original(new URL(`${url.pathname}${url.search}`, local), options);
    }
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("测试禁止连接未配置的外部服务");
    return original(input, init);
  };
  return () => { globalThis.fetch = original; };
}
