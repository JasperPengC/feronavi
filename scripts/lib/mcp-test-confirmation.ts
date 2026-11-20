/** 仅供既有隔离业务套件：测试步骤已授权写入；确认缺失/拒绝的专用测试应直接发送原始参数。 */
import { WRITE_TOOLS } from "../../src/server/mcp/write-tools.ts";
import { TOOLS, AGENT_TOOLS } from "../../src/server/mcp/tools.ts";
const writes = new Set([...TOOLS, ...WRITE_TOOLS, ...AGENT_TOOLS].filter(tool => tool.kind === "write").map(tool => tool.name));
export function confirmedTestArgs(name: string, args: Record<string, unknown>) {
  return writes.has(name) ? { userConfirmed: true, ...args } : args;
}
