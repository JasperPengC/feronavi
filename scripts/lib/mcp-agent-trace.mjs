/** 仅供隔离 Agent 验收：从真实 HTTP 请求/响应提取无凭据指标。 */
import { appendFileSync } from "node:fs";

export function mcpCallMetric(request, response, status) {
  if (request?.method !== "tools/call" || typeof request.params?.name !== "string") return null;
  if (response?.id !== request.id) return null;
  const metric = { toolName: request.params.name, success: false };
  if (status < 200 || status >= 300) return { ...metric, errorCode: `HTTP_${status}` };
  if (response.error || !response.result) return { ...metric, errorCode: "MCP_PROTOCOL_ERROR" };
  if (!response.result.isError) return { ...metric, success: true };
  const text = response.result.content?.find(item => item.type === "text")?.text;
  let code;
  try { code = JSON.parse(text).code; } catch { /* 不记录原始错误正文。 */ }
  return { ...metric, errorCode: typeof code === "string" && /^[A-Z_]{1,80}$/.test(code) ? code : "MCP_TOOL_ERROR" };
}

const tracePath = process.env.FERONAVI_TEST_MCP_TRACE;
const endpoint = process.env.FERONAVI_TEST_MCP_ENDPOINT;
if (tracePath && endpoint) {
  const fetchHttp = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await fetchHttp(input, init);
    if (String(input) !== endpoint || typeof init?.body !== "string") return response;
    try {
      const request = JSON.parse(init.body);
      if (request.method !== "tools/call") return response;
      const raw = await response.clone().text();
      const messages = response.headers.get("content-type")?.includes("text/event-stream")
        ? raw.split(/\r?\n\r?\n/u).map(event => event.split(/\r?\n/u).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n")).filter(Boolean)
        : [raw];
      for (const text of messages) {
        const metric = mcpCallMetric(request, JSON.parse(text), response.status);
        if (metric) appendFileSync(tracePath, `${JSON.stringify(metric)}\n`, { mode: 0o600 });
      }
    } catch { /* 无法观测时缺失指标会令验收失败，不能伪造成功。 */ }
    return response;
  };
}
