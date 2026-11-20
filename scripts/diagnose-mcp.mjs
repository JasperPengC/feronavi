import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Diagnose an MCP endpoint without printing credentials or request payloads. */
export async function diagnoseMcpConnection({ url, token, fetchImpl = fetch }) {
  if (!url?.trim()) return { ok: false, stage: "configuration", code: "URL_MISSING" };
  let endpoint;
  try {
    endpoint = new URL(url);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
  } catch {
    return { ok: false, stage: "configuration", code: "URL_INVALID" };
  }
  if (!token?.trim()) return { ok: false, stage: "configuration", code: "TOKEN_MISSING" };

  let id = 0;
  const call = async (method, params = {}) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!response.ok) return { httpStatus: response.status, error: response.status === 401 ? "AUTHENTICATION_FAILED" : "HTTP_ERROR" };
    let body;
    try { body = await response.json(); } catch { return { httpStatus: response.status, error: "INVALID_JSON" }; }
    if (body.error) return { httpStatus: response.status, error: "PROTOCOL_ERROR" };
    return { httpStatus: response.status, result: body.result };
  };

  try {
    const init = await call("initialize", {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "feronavi-mcp-diagnostic", version: "1" },
    });
    if (init.error) return { ok: false, stage: "initialize", code: init.error, httpStatus: init.httpStatus };
    const serverInfo = init.result?.serverInfo;
    if (!serverInfo?.name) return { ok: false, stage: "initialize", code: "INVALID_MCP_RESPONSE", httpStatus: init.httpStatus };

    const tools = await call("tools/list");
    if (tools.error) return { ok: false, stage: "tools", code: tools.error, httpStatus: tools.httpStatus };
    const ping = await call("tools/call", { name: "ping", arguments: {} });
    if (ping.error) return { ok: false, stage: "tool-call", code: ping.error, httpStatus: ping.httpStatus };
    if (ping.result?.isError) return { ok: false, stage: "tool-call", code: "PING_FAILED", httpStatus: ping.httpStatus };
    const resources = await call("resources/list");
    if (resources.error) return { ok: false, stage: "resources", code: resources.error, httpStatus: resources.httpStatus };
    const prompts = await call("prompts/list");
    if (prompts.error) return { ok: false, stage: "prompts", code: prompts.error, httpStatus: prompts.httpStatus };
    return {
      ok: true,
      server: { name: serverInfo.name, version: serverInfo.version ?? null },
      httpStatus: init.httpStatus,
      counts: {
        tools: Array.isArray(tools.result?.tools) ? tools.result.tools.length : 0,
        resources: Array.isArray(resources.result?.resources) ? resources.result.resources.length : 0,
        prompts: Array.isArray(prompts.result?.prompts) ? prompts.result.prompts.length : 0,
      },
      protocol: "stateless-post-json",
      ping: "ok",
    };
  } catch {
    return { ok: false, stage: "network", code: "CONNECTION_FAILED" };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await diagnoseMcpConnection({
    url: process.env.FERONAVI_MCP_URL,
    token: process.env.FERONAVI_MCP_TOKEN,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
