/** 每个验收套件使用独立数据库与服务，失败不自动重试。 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryRoot } from "../tests/support/isolated-database.ts";
import { classifyAcceptanceExit, acceptanceSuiteKind } from "./lib/acceptance-result.mjs";

const onlyArg = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const only = onlyArg ? new Set(onlyArg.split(",").map((name) => `${name.replace(/\.mjs$/, "")}.mjs`)) : null;
const scripts = readdirSync(join(repositoryRoot, "scripts")).filter((name) => /^accept-.*\.mjs$/u.test(name)
  && (only ? only.has(name) : acceptanceSuiteKind(name) === "product")).sort();
if (!scripts.length || (only && scripts.length !== only.size)) throw new Error("验收套件名称不存在");
const output = join(repositoryRoot, ".cache", `acceptance-matrix-${Date.now()}`);
mkdirSync(output, { recursive: true });
const results = [];
let interrupted = false;
let child;
const interrupt = () => { interrupted = true; child?.kill("SIGTERM"); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  for (const name of scripts) {
    if (interrupted) break;
    const started = Date.now();
    let log = "";
    const exit = await new Promise((done, reject) => {
      child = spawn(process.execPath, ["scripts/run-isolated-test.ts", "--browser", `scripts/${name}`, ...(name === "accept-ui.mjs" ? ["--suite"] : [])], {
        cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { log += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => done(code ?? 1));
    });
    writeFileSync(join(output, `${name}.log`), log);
    const status = classifyAcceptanceExit(exit);
    results.push({ name, kind: acceptanceSuiteKind(name), exit, status, ms: Date.now() - started });
    console.log(`${status === "passed" ? "OK" : status === "skipped" ? "SKIP" : "FAIL"} ${name}`);
  }
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  const passed = results.filter((result) => result.status === "passed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;
  writeFileSync(join(output, "report.json"), JSON.stringify({ total: scripts.length, passed, skipped, failed, interrupted, results }, null, 2));
  console.log(`验收矩阵：${passed}/${scripts.length} 通过，${skipped} 跳过，${failed} 失败；报告 ${output}`);
  process.exitCode = !interrupted && failed === 0 && results.length === scripts.length ? 0 : 1;
}
