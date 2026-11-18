// @vitest-environment node
import { createServer } from "node:http";
import { connect } from "node:net";
import { expect, it, vi } from "vitest";
import { Agent } from "undici";
const state = vi.hoisted(() => ({ port: 0 }));
vi.mock("undici", async importOriginal => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, Agent: class extends actual.Agent {
    constructor() {
      super({ connect(_options, callback) {
        const socket = connect({ host: "127.0.0.1", port: state.port });
        socket.once("connect", () => callback(null, socket));
        socket.once("error", error => callback(error, null));
      } });
    }
  } };
});
import { safeOutboundFetch } from "../src/server/lib/safe-fetch.ts";
it("Node 内置 fetch 与真实 Undici dispatcher 完成请求及响应读取", async () => {
  // 只替换 socket 目标；保留真实 Agent、内置 fetch、HTTP 协议和响应流。
  expect(Agent).toBeDefined();
  const received: string[] = [];
  const server = createServer((req, res) => {
    req.on("data", chunk => received.push(String(chunk)));
    req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true })); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  state.port = (server.address() as { port: number }).port;
  try {
    const response = await safeOutboundFetch("https://1.1.1.1/check", { method: "POST", body: "test-payload" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(received.join("")).toBe("test-payload");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
