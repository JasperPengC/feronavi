/** MCP 业务闭环：每个套件独立数据库，报告写入忽略目录，不访问外部模型或推送远端。 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryRoot } from "../tests/support/isolated-database.ts";

const suites = ["e2e-mcp.ts", "e2e-mcp-write.ts", "e2e-mcp-capabilities.ts", "e2e-mcp-workflow-closure.ts",
  "e2e-mcp-work-item-extras.ts", "e2e-mcp-operations.ts", "e2e-mcp-project-management.ts", "e2e-mcp-content.ts",
  "e2e-mcp-collaboration-extras.ts", "e2e-mcp-business-config.ts", "e2e-mcp-workspace.ts", "e2e-page-permission-race.ts",
  "e2e-mcp-notify.ts", "e2e-mcp-policy.ts", "e2e-announcement-visibility.ts", "e2e-crdt-page-revisions.ts",
  "e2e-mcp-organization.ts", "e2e-approval-import-safety.ts", "e2e-plan-archive-links.ts"];
const output = join(repositoryRoot, ".cache", `mcp-closure-${Date.now()}`);
mkdirSync(output, { recursive: true });
let child, interrupted = false;
const results = [];
const interrupt = () => { interrupted = true; child?.kill("SIGTERM"); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
  for (const name of suites) {
    if (interrupted) break;
    const log = join(output, `${name}.log`);
    const started = Date.now();
    const exit = await new Promise((done, reject) => {
      child = spawn(process.execPath, ["scripts/run-isolated-test.ts", `scripts/${name}`], {
        cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => appendFileSync(log, chunk));
      child.once("error", reject); child.once("exit", code => done(code ?? 1));
    });
    results.push({ name, exit, ms: Date.now() - started });
    console.log(`${exit === 0 ? "OK" : "FAIL"} ${name}`);
  }
} finally {
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  const passed = results.filter(result => result.exit === 0).length;
  writeFileSync(join(output, "report.json"), JSON.stringify({ total: suites.length, passed, interrupted, results }, null, 2));
  console.log(`MCP业务闭环 ${passed}/${suites.length}；报告 ${output}`);
  process.exitCode = !interrupted && passed === suites.length ? 0 : 1;
}
