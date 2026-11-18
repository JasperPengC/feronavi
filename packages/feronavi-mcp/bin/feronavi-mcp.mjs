#!/usr/bin/env node
/**
 * Feronavi MCP stdio 桥。
 *
 * 设计目标：像主流 MCP server 一样 `npx -y feronavi-mcp` 即可接入，
 * 不需要把 Feronavi 仓库放在本地，也不需要维护额外的 skills 文档。
 *
 * 原理：MCP 客户端通过 stdio 发 JSON-RPC；本进程把每条消息 POST 到
 *       `<FERONAVI_URL>/api/v1/mcp`，带 Bearer API 令牌，再把响应写回 stdout。
 *       服务端已有的 Streamable HTTP MCP 端点负责全部工具与权限。
 *
 * 配置（二选一）：
 *   npx -y feronavi-mcp --url http://127.0.0.1:3000 --token fero_xxx
 *   FERONAVI_URL=http://127.0.0.1:3000 FERONAVI_TOKEN=fero_xxx npx -y feronavi-mcp
 *
 * stdout 只允许 MCP 协议数据；日志一律 stderr。
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const clients = ["codex", "claude", "cursor", "vscode", "windsurf", "cline", "generic"];

const HELP = `Feronavi MCP bridge

Usage:
  feronavi-mcp --url <base-url> --token <fero_...>
  FERONAVI_URL=... FERONAVI_TOKEN=... feronavi-mcp

Options:
  --url <url>       Feronavi base URL (default: FERONAVI_URL)
  --token <token>   API token, fero_... (default: FERONAVI_TOKEN)
  --print-config    Print a client config template and exit
  --client <name>   Template for: codex|claude|cursor|vscode|windsurf|cline|generic
  --help            Show this help
  --version         Show version

Examples:
  npx -y feronavi-mcp --url http://127.0.0.1:3000 --token fero_xxx
  npx -y feronavi-mcp --print-config --client cursor --url ... --token ...

The bridge is stateless; each JSON-RPC request is forwarded to /api/v1/mcp.
FERONAVI_REQUEST_TIMEOUT_MS sets the request timeout (default: 120000).
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--url" || a === "--token" || a === "--client") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${a} 需要参数`);
      out[a.slice(2)] = argv[++i];
    }
    else if (a === "--print-config") out.printConfig = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else throw new Error("未知参数，请使用 --help 查看用法");
  }
  return out;
}

function configTemplate(client, url, token) {
  const env = { FERONAVI_URL: url, FERONAVI_TOKEN: token };
  if (client === "codex") {
    return [
      "[mcp_servers.feronavi]",
      'command = "npx"',
      'args = ["-y", "feronavi-mcp"]',
      "",
      "[mcp_servers.feronavi.env]",
      ...Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    ].join("\n");
  }
  if (client === "vscode") {
    return JSON.stringify({
      servers: {
        feronavi: {
          type: "stdio",
          command: "npx",
          args: ["-y", "feronavi-mcp"],
          env,
        },
      },
    }, null, 2);
  }
  if (client === "cline" || client === "windsurf") {
    return JSON.stringify({
      mcpServers: {
        feronavi: {
          command: "npx",
          args: ["-y", "feronavi-mcp"],
          env,
          disabled: false,
          autoApprove: [],
        },
      },
    }, null, 2);
  }
  if (client === "generic") {
    return JSON.stringify({
      mcpServers: {
        feronavi: {
          command: "npx",
          args: ["-y", "feronavi-mcp", "--url", url, "--token", token],
        },
      },
    }, null, 2);
  }
  // Claude Desktop / Cursor / 大多数兼容 mcpServers 的客户端
  return JSON.stringify({
    mcpServers: {
      feronavi: {
        command: "npx",
        args: ["-y", "feronavi-mcp"],
        env,
      },
    },
  }, null, 2);
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
  if (args.client && !clients.includes(args.client)) throw new Error("不支持的客户端，请使用 --help 查看列表");
} catch (error) {
  process.stderr.write(`[feronavi-mcp] ${error.message}\n`); process.exit(2);
}
if (args.help) { process.stdout.write(HELP); process.exit(0); }
if (args.version) { process.stdout.write(`${version}\n`); process.exit(0); }

const baseUrl = String(args.url || process.env.FERONAVI_URL || "").replace(/\/+$/, "");
const token = String(args.token || process.env.FERONAVI_TOKEN || "");

if (args.printConfig) {
  if (!baseUrl || !token) {
    process.stderr.write("--print-config 需要 --url 和 --token（或 FERONAVI_URL/FERONAVI_TOKEN）\n");
    process.exit(2);
  }
  process.stdout.write(configTemplate(args.client || "claude", baseUrl, token) + "\n");
  process.exit(0);
}

if (!baseUrl) { process.stderr.write("[feronavi-mcp] 缺少 --url 或 FERONAVI_URL\n"); process.exit(2); }
if (!token) { process.stderr.write("[feronavi-mcp] 缺少 --token 或 FERONAVI_TOKEN\n"); process.exit(2); }
if (!/^https?:\/\//i.test(baseUrl)) { process.stderr.write("[feronavi-mcp] --url 必须以 http:// 或 https:// 开头\n"); process.exit(2); }
try {
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
} catch {
  process.stderr.write("[feronavi-mcp] --url 必须是有效地址，不能包含凭据、查询或片段\n"); process.exit(2);
}
const timeoutMs = Number(process.env.FERONAVI_REQUEST_TIMEOUT_MS ?? 120000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) {
  process.stderr.write("[feronavi-mcp] FERONAVI_REQUEST_TIMEOUT_MS 必须为 1..600000 的整数\n"); process.exit(2);
}

const endpoint = `${baseUrl}/api/v1/mcp`;
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "user-agent": `feronavi-mcp/${version}`,
};

function writeProtocol(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function responseId(message) {
  return message && typeof message === "object" && "id" in message ? message.id : undefined;
}

function emit(body, contentType = "", expectedId) {
  let matched = expectedId === undefined;
  const deliver = value => {
    if (!value || value.jsonrpc !== "2.0") return;
    if ("id" in value) {
      if (value.id !== expectedId || (!("result" in value) && !("error" in value))) return;
      matched = true;
    } else if (!("method" in value)) return;
    writeProtocol(value);
  };
  // 不能靠 body 里是否出现 "data:" 判断：工具返回内容本身可能包含这个字符串。
  if (contentType.includes("text/event-stream")) {
    const events = body.split(/\r?\n\r?\n/u);
    for (const ev of events) {
      const data = ev.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try { deliver(JSON.parse(data)); } catch { /* 缺少有效响应时向对应请求返回错误。 */ }
    }
  } else {
    try { deliver(JSON.parse(body)); } catch { /* 同上；不把上游内容或凭据写入日志。 */ }
  }
  if (!matched) {
    writeProtocol({ jsonrpc: "2.0", id: expectedId, error: { code: -32000, message: "Feronavi 未返回有效的 MCP 响应" } });
  }
}

async function forward(message) {
  try {
    const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    if (!res.ok) {
      await res.body?.cancel();
      const id = responseId(message);
      const unauthorized = res.status === 401;
      const error = { code: unauthorized ? -32001 : -32000,
        message: unauthorized ? "Feronavi 令牌无效、已吊销或已过期" : `Feronavi HTTP ${res.status}` };
      if (id !== undefined) writeProtocol({ jsonrpc: "2.0", id, error });
      else process.stderr.write(`[feronavi-mcp] ${error.message}\n`);
      return;
    }
    const body = await res.text();
    emit(body, res.headers.get("content-type") ?? "", responseId(message));
  } catch (e) {
    const id = responseId(message);
    const detail = e.name === "TimeoutError" ? "Feronavi 请求超时；写入结果未知，请先查询确认再重试" : "无法连接 Feronavi；请检查地址与网络";
    if (id !== undefined) writeProtocol({ jsonrpc: "2.0", id, error: { code: -32000, message: detail } });
    else process.stderr.write(`[feronavi-mcp] ${detail}\n`);
  }
}

let chain = Promise.resolve();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  chain = chain.then(async () => {
    let message;
    try { message = JSON.parse(trimmed); }
    catch { process.stderr.write("[feronavi-mcp] 非法 JSON\n"); return; }
    await forward(message);
  }).catch((e) => process.stderr.write(`[feronavi-mcp] ${e.message}\n`));
});
process.stderr.write(`[feronavi-mcp] 桥已启动，目标 ${endpoint}\n`);
