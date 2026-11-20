import { describe, expect, it } from "vitest";
import { mcpCallMetric } from "../scripts/lib/mcp-agent-trace.mjs";

describe("真实 Agent HTTP 调用观测", () => {
  it("只记录工具名及结果，不保留请求参数、令牌或业务正文", () => {
    const metric = mcpCallMetric({ method: "tools/call", id: 2, params: { name: "page.get", arguments: { secret: "private" } } },
      { id: 2, result: { content: [{ type: "text", text: '{"content":"private"}' }] } }, 200);
    expect(metric).toEqual({ toolName: "page.get", success: true });
    expect(JSON.stringify(metric)).not.toContain("private");
  });
  it("记录服务端领域错误，不把 HTTP 200 当作业务成功", () => {
    expect(mcpCallMetric({ method: "tools/call", id: 4, params: { name: "workitem.update" } }, {
      id: 4, result: { isError: true, content: [{ type: "text", text: '{"code":"VERSION_CONFLICT","details":"private"}' }] },
    }, 200)).toEqual({ toolName: "workitem.update", success: false, errorCode: "VERSION_CONFLICT" });
  });
  it("拒绝不匹配的响应及非调用请求，缺少结果不能算成功", () => {
    const request = { method: "tools/call", id: 7, params: { name: "page.get" } };
    expect(mcpCallMetric(request, { id: 8, result: {} }, 200)).toBeNull();
    expect(mcpCallMetric({ method: "tools/list", id: 7 }, { id: 7, result: {} }, 200)).toBeNull();
    expect(mcpCallMetric(request, { id: 7, error: { code: -32001 } }, 401)).toEqual({ toolName: "page.get", success: false, errorCode: "HTTP_401" });
    expect(mcpCallMetric(request, { id: 7 }, 200)).toEqual({ toolName: "page.get", success: false, errorCode: "MCP_PROTOCOL_ERROR" });
  });
});
