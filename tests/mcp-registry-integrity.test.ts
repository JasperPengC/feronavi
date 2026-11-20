// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
import { ALL_TOOLS, TOOL_NAMES } from "../src/server/application/capabilities/tools.ts";
import { ALL_TOOLS as MCP_TOOLS } from "../src/server/mcp/tools.ts";
import { assistantCapabilities } from "../src/server/services/assistant-capabilities.ts";
import { assistantRegistry, ASSISTANT_READ_TOOLS, ASSISTANT_WRITE_TOOLS } from "../src/server/services/assistant-tool-catalogue.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/mcp-capability-baseline.json", import.meta.url), "utf8")) as { names: string[] };

it("恢复前的逐项工具基线完整保留，公开目录没有重名或外联集成", () => {
  expect(baseline.names.filter(name => !TOOL_NAMES.includes(name))).toEqual([]);
  expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  expect(TOOL_NAMES.filter(name => /^(integration|webhook|im)\./u.test(name))).toEqual([]);
});

it("MCP、助手与策略注入端共享同一个注册表和工具实例", async () => {
  expect(MCP_TOOLS).toBe(ALL_TOOLS);
  expect(assistantCapabilities()).toBe(ALL_TOOLS);
  const expected = ALL_TOOLS.filter(tool => ASSISTANT_READ_TOOLS.has(tool.name) || ASSISTANT_WRITE_TOOLS.has(tool.name));
  const actual = await assistantRegistry();
  expect(actual.map(tool => tool.name)).toEqual(expected.map(tool => tool.name));
  for (const tool of actual) expect(tool).toBe(ALL_TOOLS.find(item => item.name === tool.name));
  expect([...ASSISTANT_READ_TOOLS, ...ASSISTANT_WRITE_TOOLS].filter(name => !TOOL_NAMES.includes(name))).toEqual([]);
});
