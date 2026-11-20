import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { diagnoseMcpConnection } from "./diagnose-mcp.mjs";

let server;
let endpoint;

before(async () => {
  server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer test-secret") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: -32000 } }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body);
    const result = {
      initialize: { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "feronavi", version: "1" } },
      "tools/list": { tools: [{ name: "ping" }] },
      "tools/call": { content: [{ type: "text", text: "{\"ok\":true}" }], isError: false },
      "resources/list": { resources: [] },
      "prompts/list": { prompts: [{ name: "execute_project_task" }] },
    }[rpc.method];
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/api/v1/mcp`;
});

after(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test("diagnoses tools, resources, and prompts without returning credentials", async () => {
  const result = await diagnoseMcpConnection({ url: endpoint, token: "test-secret" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { tools: 1, resources: 0, prompts: 1 });
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
});

test("classifies authentication failure without echoing the token", async () => {
  const result = await diagnoseMcpConnection({ url: endpoint, token: "wrong-secret" });
  assert.deepEqual({ ok: result.ok, stage: result.stage, code: result.code }, { ok: false, stage: "initialize", code: "AUTHENTICATION_FAILED" });
  assert.equal(JSON.stringify(result).includes("wrong-secret"), false);
});

test("rejects invalid URLs and missing tokens", async () => {
  assert.equal((await diagnoseMcpConnection({ url: "", token: "secret" })).code, "URL_MISSING");
  assert.equal((await diagnoseMcpConnection({ url: "file:///tmp/x", token: "secret" })).code, "URL_INVALID");
  assert.equal((await diagnoseMcpConnection({ url: endpoint, token: "" })).code, "TOKEN_MISSING");
});
