import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { availablePort, compiledEntrypoint, repositoryRoot, runNode, type IsolatedDatabase } from "./isolated-database.ts";
export { availablePort } from "./isolated-database.ts";

export async function stopServer(server?: ChildProcess) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill("SIGTERM");
  const timeout = setTimeout(() => server.kill("SIGKILL"), 10_000);
  try { await stopped; } finally { clearTimeout(timeout); }
}

/** 编译到临时目录，避免覆盖本机服务的产物；服务与测试使用同一随机库。 */
export async function startIsolatedApp(database: Pick<IsolatedDatabase, "directory" | "env">, options: { skipBuild?: boolean; signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const buildDirectory = join(database.directory, "dist-server");
  if (!options.skipBuild) {
  const builds = await Promise.allSettled([
    runNode(["scripts/build-server.mjs", "--outDir", buildDirectory], database.env, 120_000, options.signal),
    runNode(["node_modules/vite/bin/vite.js", "build", "--outDir", join(database.directory, "dist")], { ...database.env, NODE_ENV: "production" }, 120_000, options.signal),
  ]);
  for (const build of builds) if (build.status === "rejected") throw build.reason;
  }
  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  options.signal?.throwIfAborted();
  const env: NodeJS.ProcessEnv = { ...database.env, HOST: "127.0.0.1", PORT: String(port), BASE: baseURL, FERONAVI_TEST_BASE_URL: baseURL, FERONAVI_TEST_DIRECTORY: database.directory };
  const server = spawn(process.execPath, [await compiledEntrypoint("start", buildDirectory)], {
    cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  env.FERONAVI_TEST_SERVER_PID = String(server.pid);
  let startError: Error | undefined;
  server.once("error", (error) => { startError = error; });
  server.stdout?.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-16000); });
  server.stderr?.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-16000); });
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      options.signal?.throwIfAborted();
      if (startError) throw startError;
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`隔离服务启动失败：\n${logs}`);
      try {
        const response = await fetch(`${baseURL}/api/v1/setup/state`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return { baseURL, env, stop: () => stopServer(server) };
      } catch { /* 等待迁移和监听就绪。 */ }
      await delay(500);
    }
    throw new Error(`隔离服务启动超时：\n${logs}`);
  } catch (error) { await stopServer(server); throw error; }
}
