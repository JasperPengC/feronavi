/** 关键质量门禁：纯测试、隔离集成与浏览器验收；不依赖开发服务。 */
import { spawn } from "node:child_process";
import { repositoryRoot } from "../tests/support/isolated-database.ts";

const steps = [
  ["单元测试", ["node_modules/vitest/vitest.mjs", "run"]],
  ["ESLint", ["node_modules/eslint/bin/eslint.js", "."]],
  ["前端类型", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["服务端类型", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json", "--noEmit"]],
  ["对比度", ["scripts/check-contrast.mjs"]],
  ["隔离集成", ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts"]],
  ["浏览器关键流程与生产构建", ["node_modules/@playwright/test/cli.js", "test"]],
  ...["a11y", "keyboard-a11y", "ldap-scim", "smtp", "automation-sla", "portfolio", "pwa", "system-backup", "approval", "scheduled", "ops", "migrations"].map((name) => [name, ["scripts/run-isolated-test.ts", "--browser", `scripts/accept-${name}.mjs`]]),
  ["MCP 包", ["scripts/run-isolated-test.ts", "--browser", "scripts/verify-mcp-package.mjs"]],
];
console.log("可选运维检查单独运行：accept:ops-db-restore（依赖 PostgreSQL CLI，不计入产品门禁）");
let child;
let interrupted = false;
const interrupt = () => { interrupted = true; child?.kill("SIGTERM"); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  let passed = 0;
  for (const [name, args] of steps) {
    if (interrupted) break;
    console.log(`\n▶ ${name}`);
    const code = await new Promise((done, reject) => {
      child = spawn(process.execPath, args, { cwd: repositoryRoot, env: process.env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (status) => done(status ?? 1));
    });
    if (code !== 0) break;
    passed++;
  }
  console.log(`结果：${passed}/${steps.length} 步通过`);
  process.exitCode = passed === steps.length && !interrupted ? 0 : 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
