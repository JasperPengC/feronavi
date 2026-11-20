/** 各浏览器闸门独立建库/启动，失败保留真实退出码，不自动重跑。 */
import { spawn } from "node:child_process";
import { repositoryRoot } from "../tests/support/isolated-database.ts";
const gates = ["verify-structure.mjs", "verify-density.mjs", "verify-i18n-dom.mjs", "verify-row-style.mjs", "verify-performance.mjs", "accept-system-backup.mjs"];
let child;
let interrupted = false;
const interrupt = () => { interrupted = true; child?.kill("SIGTERM"); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
let failed = 0;
try {
  for (const gate of [...gates, "check-contrast.mjs", "verify-icons.mjs"]) {
    if (interrupted) break;
    const args = gates.includes(gate) ? ["scripts/run-isolated-test.ts", "--browser", `scripts/${gate}`] : [`scripts/${gate}`];
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, args, { cwd: repositoryRoot, env: process.env, stdio: "inherit" });
      child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1));
    });
    if (code !== 0) failed++;
    console.log(`${code === 0 ? "OK" : "FAIL"} ${gate}`);
  }
} finally {
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  process.exitCode = !interrupted && failed === 0 ? 0 : 1;
}
