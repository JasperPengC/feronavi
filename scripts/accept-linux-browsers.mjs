/**
 * 官方匹配版本 Linux 浏览器；仅挂载测试文件与输出，不使用宿主 node_modules。
 * 空页：node scripts/accept-linux-browsers.mjs --probe
 * 完整：node scripts/run-isolated-test.ts --browser scripts/accept-linux-browsers.mjs
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const probeOnly = process.argv.includes("--probe");
if (!probeOnly) assertIsolatedTestEnvironment();
const version = createRequire(import.meta.url)("playwright/package.json").version;
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Linux 浏览器镜像需要已发布的 Playwright 稳定版本");
const nodeVersion = process.versions.node;
if (!/^24\.\d+\.\d+$/u.test(nodeVersion)) throw new Error("Linux 浏览器 runner 需要项目约定的 Node 24");
const lockfile = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
if (!lockfile.includes(`  playwright@${version}:`)) throw new Error("本机 Playwright 与锁文件不一致，请先冻结安装依赖");
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const runtimeImage = `feronavi-browser:playwright-${version}-node24`;
const name = `feronavi-browser-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const directory = await mkdtemp(join(tmpdir(), "feronavi-linux-browser-"));
const reportDirectory = resolve(process.env.A11Y_REPORT_DIR ?? join(root, ".cache", "release-tuning-2026-11-08", probeOnly ? "browser-linux-probe" : "browser-linux"));
await mkdir(reportDirectory, { recursive: true });
const run = (args, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn("docker", args, { cwd: root, stdio: "inherit", ...options });
  child.once("error", reject);
  child.once("exit", (code) => resolveRun(code ?? 1));
});
let interrupted = false;
const stop = () => { interrupted = true; void run(["stop", "-t", "2", name], { stdio: "ignore" }); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  // 官方浏览器镜像已使用 Node 26；从官方 Node 24 镜像复制 Linux 二进制，
  // 避免 npm node 安装脚本再次下载平台包且受嵌套安装网络影响。
  await writeFile(join(directory, "Dockerfile"), `FROM node:24-bookworm-slim AS runtime\nFROM ${image}\nCOPY --from=runtime /usr/local/bin/node /usr/local/bin/node\nRUN node -e "if(process.versions.node.split('.')[0]!=='24')process.exit(1)" && npm install --prefix /runner --no-save --package-lock=false --no-audit --no-fund playwright@${version}\n`);
  await writeFile(join(directory, ".dockerignore"), "*\n");
  const buildStatus = await run(["build", "--tag", runtimeImage, directory]);
  if (buildStatus !== 0 || interrupted) throw new Error("Linux 浏览器 Node 24 运行环境构建失败或已取消");
  for (const file of ["accept-cross-browser.mjs", "test-environment.mjs"]) await copyFile(join(root, "scripts", file), join(directory, file));
  // 浏览器使用可信 loopback origin；TCP 直通只连接本轮宿主服务，不修改任何响应头。
  await writeFile(join(directory, "launch-browser.mjs"), `import net from 'node:net';
const sockets = new Set();
let server;
try {
  if (process.env.BROWSER_PROBE_ONLY !== '1') {
    const upstream = new URL(process.env.BASE);
    server = net.createServer(client => {
      const remote = net.connect(Number(upstream.port), upstream.hostname);
      for (const socket of [client, remote]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); }
      client.on('error', () => remote.destroy()); remote.on('error', () => client.destroy());
      client.on('close', () => remote.destroy()); remote.on('close', () => client.destroy());
      client.pipe(remote); remote.pipe(client);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    process.env.BASE = 'http://127.0.0.1:' + server.address().port;
    process.env.FERONAVI_TEST_BASE_URL = process.env.BASE;
  }
  await import('./accept-cross-browser.mjs');
} finally { for (const socket of sockets) socket.destroy(); if (server) await new Promise(resolve => server.close(resolve)); }
`);
  const env = {
    BROWSER_PROBE_ONLY: probeOnly ? "1" : "0", A11Y_REPORT_DIR: "/report",
    ...(process.env.BROWSERS !== undefined ? { BROWSERS: process.env.BROWSERS } : {}),
  };
  if (!probeOnly) {
    const base = new URL(process.env.BASE);
    if (!["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("Linux runner 只接受本机隔离应用地址");
    if (process.platform !== "linux") base.hostname = "host.docker.internal";
    Object.assign(env, {
      BASE: base.toString().replace(/\/$/u, ""), FERONAVI_TEST_BASE_URL: base.toString().replace(/\/$/u, ""),
      FERONAVI_TEST_DATABASE: process.env.FERONAVI_TEST_DATABASE,
      // 浏览器无需数据库连接权限；仅保留隔离标识供安全校验。
      DATABASE_URL: `postgres://isolated@invalid/${process.env.FERONAVI_TEST_DATABASE}`,
      A11Y_USERNAME: process.env.A11Y_USERNAME ?? "demo", A11Y_PASSWORD: process.env.A11Y_PASSWORD ?? "demo-password-12345",
    });
  }
  if (Object.values(env).some((value) => /[\r\n]/u.test(value))) throw new Error("浏览器环境值不能包含换行");
  const envFile = join(directory, "browser.env");
  await writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  await writeFile(join(reportDirectory, "container.json"), JSON.stringify({ image, runtimeImage, container: name, playwright: version, probeOnly, hostNode: process.version, startedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`Linux 浏览器镜像 ${image}；独立容器 ${name}`);
  const status = await run([
    "run", "--rm", "--init", "--name", name, "--shm-size", "1g",
    // 浏览器只访问本次本地服务，避免 Docker Desktop/OrbStack 自动注入的公网代理拦截。
    "-e", "HTTP_PROXY=", "-e", "HTTPS_PROXY=", "-e", "ALL_PROXY=",
    "-e", "http_proxy=", "-e", "https_proxy=", "-e", "all_proxy=",
    "-e", "NO_PROXY=*", "-e", "no_proxy=*",
    ...(process.platform === "linux" ? ["--network", "host"] : ["--add-host", "host.docker.internal:host-gateway"]),
    "--env-file", envFile, "--mount", `type=bind,src=${directory},dst=/input,readonly`,
    "--mount", `type=bind,src=${reportDirectory},dst=/report`, runtimeImage,
    "bash", "-lc", "mkdir -p /runner/scripts && cp /input/*.mjs /runner/scripts/ && node /runner/scripts/launch-browser.mjs",
  ]);
  process.exitCode = interrupted ? 130 : status;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await run(["rm", "-f", name], { stdio: "ignore" });
  await rm(directory, { recursive: true, force: true });
}
