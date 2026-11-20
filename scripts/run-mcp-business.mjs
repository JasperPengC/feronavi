/** 顺序隔离执行；每个领域由runner建立并清理独立数据库。真实Codex另用test:mcp-codex。 */
import { spawnSync } from "node:child_process";
const suites = ["e2e-mcp.ts", "e2e-mcp-write.ts", "e2e-mcp-policy.ts", "e2e-mcp-notify.ts", "e2e-mcp-work-planning.ts", "e2e-mcp-content.ts", "e2e-mcp-project-tools.ts", "e2e-mcp-operations.ts", "e2e-mcp-relations.ts", "e2e-mcp-business-workflows.ts"];
for (const suite of suites) {
  console.log(`运行 MCP 验收：${suite}`);
  const child = spawnSync(process.execPath, ["scripts/run-isolated-test.ts", `scripts/${suite}`], { env: process.env, stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
console.log(`MCP 业务验收完成：${suites.length}套通过。`);
