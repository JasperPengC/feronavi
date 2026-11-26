/** 测试只创建随机命名的新库；绝不回退到应用的 DATABASE_URL。 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePort); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配隔离服务端口");
  await new Promise<void>((resolvePort, reject) => server.close((error) => error ? reject(error) : resolvePort()));
  return address.port;
}
export interface TerminationOptions { terminationGraceMs?: number }

export async function runNode(args: string[], env: NodeJS.ProcessEnv, timeout = 120_000, signal?: AbortSignal, options: TerminationOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const terminationGraceMs = options.terminationGraceMs ?? 10_000;
  if (!Number.isInteger(terminationGraceMs) || terminationGraceMs < 1 || terminationGraceMs > 10_000) throw new RangeError("terminationGraceMs 必须为1..10000的整数");
  signal?.throwIfAborted();
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { cwd: repositoryRoot, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    let failure: Error | undefined;
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    const kill = (name: NodeJS.Signals) => {
      try { if (process.platform === "win32") child.kill(name); else if (child.pid) process.kill(-child.pid, name); } catch { /* 本进程组已结束。 */ }
    };
    const stop = (reason: Error) => { failure ??= reason; kill("SIGTERM"); forceStop ??= setTimeout(() => kill("SIGKILL"), terminationGraceMs); };
    const abort = () => stop(new Error("隔离测试子进程已取消"));
    const timer = setTimeout(() => stop(new Error(`隔离测试子进程超时（${timeout}ms）`)), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => { clearTimeout(timer); clearTimeout(forceStop); signal?.removeEventListener("abort", abort); };
    child.stdout.on("data", (chunk) => { stdout += String(chunk); if (stdout.length > 8 * 1024 * 1024) stop(new Error("测试输出过大")); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); if (stderr.length > 8 * 1024 * 1024) stop(new Error("测试输出过大")); });
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      if (failure || code !== 0) kill("SIGKILL");
      cleanup();
      if (failure || code !== 0) reject(Object.assign(failure ?? new Error(`测试子进程失败（${code}）：${args[0]}\nstdout:\n${stdout.slice(-8000)}\nstderr:\n${stderr.slice(-8000)}`), { stdout, stderr, code }));
      else resolveRun({ stdout, stderr });
    });
  });
}

export async function createIsolatedDatabase(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl) {
    throw new Error("请设置 TEST_DATABASE_ADMIN_URL，使用可创建临时数据库的 PostgreSQL 测试账号（需 vector / zhparser 扩展）；不会使用 DATABASE_URL。");
  }
  const name = `feronavi_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("TEST_DATABASE_ADMIN_URL 必须为 PostgreSQL URL");
  url.pathname = `/${name}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  const cache = join(repositoryRoot, ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "isolated-test-"));
  let created = false;
  const cleanup = async () => {
    try {
      if (created) {
        // 名称由本进程生成并且只有字母、数字、下划线；只销毁本次创建的库。
        await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
        created = false;
      }
    } finally {
      await admin.end({ timeout: 5 });
      await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    signal?.throwIfAborted();
    await mkdir(join(directory, "data"));
    const port = await availablePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FERONAVI_TEST_DATABASE: name,
      DATABASE_URL: url.toString(),
      REDIS_URL: "", // 测试不连接或清理开发缓存。
      DATA_DIR: join(directory, "data"),
      ATTACHMENT_DIR: join(directory, "data", "attachments"),
      NODE_ENV: "test",
      MIGRATE_ON_START: "1",
      MIGRATIONS_DIR: join(repositoryRoot, "drizzle"),
      JOB_WORKER_INTERVAL_MS: "0",
      SNAPSHOT_INTERVAL_MS: "0",
      INTEGRATION_SYNC_INTERVAL_MS: "0",
      WEBHOOK_RETRY_INTERVAL_MS: "0",
      AUTOMATION_SCHEDULE_INTERVAL_MS: "0",
      SLA_SCAN_INTERVAL_MS: "0",
      RETENTION_SWEEP_INTERVAL_MS: "0",
      IPGEO_UPDATE_INTERVAL_MS: "0",
      UPDATE_CHECK_INTERVAL_MS: "0",
      PORT: String(port), BASE: baseURL, FERONAVI_TEST_BASE_URL: baseURL,
      FERONAVI_TEST_DIRECTORY: directory,
    };
    // 管理连接串无需传给应用或旧验收脚本。
    delete env.TEST_DATABASE_ADMIN_URL;
    // HTTP旧套件自启服务时也使用本次动态端口，不能继承开发/远程地址。
    delete env.PERF_HOST;
    delete env.FERONAVI_TEST_SERVER_PID;
    signal?.throwIfAborted();
    return { name, url: url.toString(), directory, env, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export type IsolatedDatabase = Awaited<ReturnType<typeof createIsolatedDatabase>>;

export async function prepareDatabase(database: IsolatedDatabase, signal?: AbortSignal, options?: TerminationOptions) {
  await runNode(["scripts/prepare-test-database.ts"], database.env, 120_000, signal, options);
}

/** 用 package.json 的真实命令启动临时编译产物，捕获入口目录漂移。 */
export async function compiledEntrypoint(script: "start" | "worker", buildDirectory: string) {
  const pkg = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const match = /^node dist-server\/(\S+)$/u.exec(pkg.scripts[script]);
  if (!match) throw new Error(`无法识别 ${script} 入口：应为 node dist-server/<entry.js>`);
  return resolve(buildDirectory, match[1]!);
}
