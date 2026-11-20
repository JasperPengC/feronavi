// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const script = resolve("scripts/check-architecture.mjs");
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "feronavi-architecture-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const file = join(root, "src", name);
      mkdirSync(resolve(file, ".."), { recursive: true });
      writeFileSync(file, content);
    }
    const run = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    return { code: run.status, result: JSON.parse(run.stdout) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
describe("运行时架构门禁", () => {
  it("真实源码无静态或动态循环、无领域反向协议依赖", () => {
    const result = JSON.parse(execFileSync(process.execPath, [script], { encoding: "utf8" }));
    expect(result.cycles).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.modules).toBeGreaterThan(100);
  });
  it("检测混合静态与动态循环但忽略纯类型边", () => {
    const failed = fixture({ "a.ts": 'import "./b.ts";', "b.ts": 'export async function load() { return import("./a.ts"); }' });
    expect(failed.code).toBe(1);
    expect(failed.result.cycles).toEqual([["src/a.ts", "src/b.ts"]]);
    const passed = fixture({ "a.ts": 'import type { B } from "./b.ts"; export interface A { b: B }', "b.ts": 'import { type A } from "./a.ts"; export interface B { a: A }' });
    expect(passed.code).toBe(0);
    expect(passed.result.edges).toBe(0);
  });
  it("拒绝领域服务反向依赖路由/MCP以及数据库反向依赖服务", () => {
    const result = fixture({ "server/services/domain.ts": 'import "../mcp/tools.ts";', "server/mcp/tools.ts": 'export const tools = [];', "db/index.ts": 'import "../server/services/domain.ts";' });
    expect(result.code).toBe(1);
    expect(result.result.violations.map((row: { reason: string }) => row.reason)).toEqual(expect.arrayContaining(["domain-to-protocol", "database-to-server"]));
  });
});
