/** 特殊验收资源：只连接夹具声明的测试库，只清理本次成功创建的资源。 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import Redis from "ioredis";
import { assertIsolatedTestEnvironment } from "../../scripts/test-environment.mjs";
import { availablePort, startIsolatedApp, stopServer } from "./isolated-app.ts";
const exec = promisify(execFile);

/** 已验证源库的同服务器随机空库；不猜 postgres 管理库，也不预删任何库。 */
export async function createSiblingTestDatabase(env: NodeJS.ProcessEnv = process.env) {
  assertIsolatedTestEnvironment(env);
  const name = `feronavi_test_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(env.DATABASE_URL!); target.pathname = `/${name}`;
  const admin = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  let created = false;
  let ready = false;
  let interrupted = false;
  let cleaning: Promise<void> | undefined;
  const interrupt = () => { interrupted = true; if (ready) void cleanup().finally(() => process.exit(130)); };
  const cleanup = () => cleaning ??= (async () => {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    try { if (created) { await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`); created = false; } }
    finally { await admin.end({ timeout: 5 }); }
  })();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    if (interrupted) throw new Error("特殊测试建库已取消");
    ready = true;
    return { name, url: target.toString(), env: { ...env, DATABASE_URL: target.toString(), FERONAVI_TEST_DATABASE: name }, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

/** 独立进程或独立容器，完全忽略继承的 REDIS_URL，不使用共享库号。 */
export async function startIsolatedRedis(directory: string) {
  const data = await mkdtemp(join(directory, "redis-"));
  const password = randomUUID();
  let child: ChildProcess | undefined;
  let containerId: string | undefined;
  let client: Redis | undefined;
  let logs = "";
  let stopping: Promise<void> | undefined;
  let binary: string | undefined;
  let port: number;
  const config = join(data, "valkey.conf");
  const launch = () => {
    child = spawn(binary!, [config], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-4000); });
    child.stderr?.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-4000); });
    child.once("error", (error) => { logs = error.message; });
  };
  const waitReady = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      client = new Redis(`redis://:${password}@127.0.0.1:${port}/0`, { lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 0, retryStrategy: () => null });
      client.on("error", () => {});
      try { await client.connect(); await client.ping(); client.disconnect(); client = undefined; return; }
      catch { client.disconnect(); client = undefined; await delay(100); }
    }
    throw new Error(`独立测试缓存启动失败：${logs}`);
  };
  const suspend = async () => {
    if (stopping) throw new Error("测试缓存已清理");
    if (containerId) await exec("docker", ["stop", "--time", "1", containerId]);
    else await stopServer(child);
  };
  const resume = async () => {
    if (stopping) throw new Error("测试缓存已清理");
    if (containerId) await exec("docker", ["start", containerId]);
    else launch();
    await waitReady();
  };
  const stop = () => stopping ??= (async () => {
    client?.disconnect();
    try {
      await stopServer(child);
      if (containerId) await exec("docker", ["rm", "--force", containerId]);
    } finally { await rm(data, { recursive: true, force: true }); }
  })();
  try {
    for (const candidate of ["valkey-server", "redis-server"]) {
      try { await exec(candidate, ["--version"]); binary = candidate; break; } catch { /* 使用独立 Docker 容器回退。 */ }
    }
    if (binary) {
      port = await availablePort();
      await writeFile(config, `bind 127.0.0.1\nport ${port}\nsave ""\nappendonly no\nrequirepass ${password}\n`, { mode: 0o600 });
      launch();
    } else {
      const name = `feronavi-test-cache-${randomUUID()}`;
      port = await availablePort();
      await writeFile(config, `bind 0.0.0.0\nport 6379\nsave ""\nappendonly no\nrequirepass ${password}\n`, { mode: 0o644 });
      const created = await exec("docker", ["run", "--detach", "--name", name, "--label", "feronavi.test.fixture=true", "--publish", `127.0.0.1:${port}:6379`, "--mount", `type=bind,src=${config},dst=/etc/valkey-test.conf,readonly`, "valkey/valkey:8-alpine", "valkey-server", "/etc/valkey-test.conf"]);
      containerId = created.stdout.trim();
      if (!/^[a-f0-9]{12,64}$/u.test(containerId)) throw new Error("Docker 未返回可验证的测试容器 ID");
      const published = await exec("docker", ["port", containerId, "6379/tcp"]);
      const match = /^127\.0\.0\.1:(\d+)$/u.exec(published.stdout.trim());
      if (!match) throw new Error("测试缓存未绑定 loopback 动态端口");
      port = Number(match[1]);
    }
    const url = `redis://:${password}@127.0.0.1:${port}/0`;
    await waitReady();
    return { url, stop, suspend, resume };
  } catch (error) { await stop(); throw error; }
}

export async function startIsolatedMultiInstance(env: NodeJS.ProcessEnv = process.env) {
  assertIsolatedTestEnvironment(env);
  const directory = env.FERONAVI_TEST_DIRECTORY ?? (env.DATA_DIR ? dirname(env.DATA_DIR) : "");
  if (!/^isolated-test-/u.test(basename(directory)) || !existsSync(directory)) throw new Error("多实例测试需要隔离 runner 创建的临时目录");
  let cache: Awaited<ReturnType<typeof startIsolatedRedis>> | undefined;
  let a: Awaited<ReturnType<typeof startIsolatedApp>> | undefined;
  let b: Awaited<ReturnType<typeof startIsolatedApp>> | undefined;
  let interrupted = false;
  let ready = false;
  let stopping: Promise<void> | undefined;
  const interrupt = () => { interrupted = true; if (ready) void stop().finally(() => process.exit(130)); };
  const stop = () => stopping ??= (async () => {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    try { await Promise.all([a?.stop(), b?.stop()]); } finally { await cache?.stop(); }
  })();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  const checkInterrupted = () => { if (interrupted) throw new Error("多实例测试已取消"); };
  try {
    cache = await startIsolatedRedis(directory); checkInterrupted();
    const isolated = { directory, env: { ...env, REDIS_URL: cache.url } };
    a = await startIsolatedApp(isolated, { skipBuild: existsSync(join(directory, "dist-server")) });
    checkInterrupted();
    b = await startIsolatedApp(isolated, { skipBuild: true });
    checkInterrupted(); ready = true;
    return { a, b, cache, stop, env: { ...a.env, A_URL: a.baseURL, B_URL: b.baseURL, FERONAVI_TEST_A_URL: a.baseURL, FERONAVI_TEST_B_URL: b.baseURL } };
  } catch (error) { await stop(); throw error; }
}
