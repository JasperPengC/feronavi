import { spawn } from "node:child_process";
import { join } from "node:path";
import { compiledEntrypoint } from "../../tests/support/isolated-database.ts";

export async function startAcceptanceWorker(env = process.env, intervalMs = 250) {
  const directory = env.FERONAVI_TEST_DIRECTORY;
  if (!directory) throw new Error("缺少 FERONAVI_TEST_DIRECTORY，无法启动隔离 worker");
  const entry = await compiledEntrypoint("worker", join(directory, "dist-server"));
  const child = spawn(process.execPath, [entry], {
    env: { ...env, JOB_WORKER_INTERVAL_MS: String(intervalMs) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`隔离 worker 启动超时：${logs.slice(-2000)}`)), 15_000);
    const onData = (chunk) => {
      logs = (logs + String(chunk)).slice(-8000);
      if (logs.includes("[job-worker] 已启动")) { clearTimeout(timeout); resolve(); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`隔离 worker 提前退出（${code}）：${logs.slice(-2000)}`)); });
  });
  return {
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try { await exited; } finally { clearTimeout(timer); }
    },
  };
}
