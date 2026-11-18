import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/feronavi-mcp.mjs", import.meta.url));
test("生成 Codex TOML 配置并正确转义", () => {
  const result = spawnSync(process.execPath, [bin, "--print-config", "--client", "codex"], {
    encoding: "utf8", env: { ...process.env, FERONAVI_URL: "https://example.test", FERONAVI_TOKEN: 'fero_"test' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\[mcp_servers\.feronavi\]/u);
  assert.match(result.stdout, /\[mcp_servers\.feronavi\.env\]/u);
  assert.ok(result.stdout.includes('FERONAVI_TOKEN = "fero_\\"test"'));
});

test("未知参数和客户端不能静默接受", () => {
  for (const args of [["--unknown"], ["--url"], ["--print-config", "--client", "other", "--url", "https://example.test", "--token", "test"]]) {
    const result = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
  }
});

async function bridge(t, handler, extraEnv = {}) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(process.execPath, [bin], { env: { ...process.env,
    FERONAVI_URL: `http://127.0.0.1:${server.address().port}`, FERONAVI_TOKEN: "test-secret", ...extraEnv,
  }, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { errors += chunk; });
  t.after(async () => {
    child.kill(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(!output.includes("test-secret") && !errors.includes("test-secret"));
  });
  return {
    send: id => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }) + "\n"),
    async receive(id) {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const messages = output.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
        const response = messages.find(message => message.id === id);
        if (response) return response;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail(`请求 ${id} 未得到响应`);
    },
  };
}

test("SSE 支持 CRLF 分隔的多个消息", async t => {
  const client = await bridge(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\r\n\r\n');
  });
  client.send(1);
  assert.deepEqual((await client.receive(1)).result, {});
});

for (const body of ["invalid json", "", '{"jsonrpc":"2.0","id":99,"result":{}}']) {
  test(`无效上游响应返回对应请求的错误：${body || "空响应"}`, async t => {
    const client = await bridge(t, (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" }); response.end(body);
    });
    client.send(1);
    assert.equal((await client.receive(1)).error.code, -32000);
  });
}

test("请求超时后队列可继续处理下个请求", async t => {
  let count = 0;
  const client = await bridge(t, (_request, response) => {
    if (++count === 1) return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"jsonrpc":"2.0","id":2,"result":{}}');
  }, { FERONAVI_REQUEST_TIMEOUT_MS: "100" });
  client.send(1); client.send(2);
  assert.equal((await client.receive(1)).error.code, -32000);
  assert.deepEqual((await client.receive(2)).result, {});
});

test("JSON 工具内容中的 data: 不应误判为 SSE", async t => {
  const client = await bridge(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"jsonrpc":"2.0","id":1,"result":{"text":"data: example"}}');
  });
  client.send(1);
  assert.equal((await client.receive(1)).result.text, "data: example");
});
