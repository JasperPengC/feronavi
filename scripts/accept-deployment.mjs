/** 当前源码镜像的全新 Compose 安装、业务、worker 与持久化验收。只清理本脚本创建的项目。 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const out = resolve(process.env.DEPLOY_OUT ?? ".cache/deployment-acceptance");
await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(out, "compose-"));
const project = `feronavi-accept-${randomBytes(6).toString("hex")}`;
await writeFile(join(out, "project.json"), JSON.stringify({ project, startedAt: new Date().toISOString() }, null, 2));
const controller = new AbortController();
let cleaning = false;
const interrupt = () => { if (!cleaning) controller.abort(); process.exitCode = 130; };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
const image = process.env.DEPLOY_IMAGE ?? "feronavi-release-tuning:local";
const env = { ...process.env, DB_PASSWORD: randomBytes(24).toString("hex"), APP_PORT: "0" };
const override = join(temp, "override.json");
await writeFile(override, JSON.stringify({ services: {
  app: { image, environment: { IPGEO_UPDATE_INTERVAL_MS: "0", UPDATE_CHECK_INTERVAL_MS: "0" },
    healthcheck: { interval: "2s", start_period: "10s" } },
  worker: { image, environment: { JOB_WORKER_INTERVAL_MS: "1000" } },
  db: { image: process.env.DEPLOY_DB_IMAGE ?? "feronavi-db:ci", healthcheck: { interval: "2s" } },
  cache: { healthcheck: { interval: "2s" } },
} }));
const args = ["compose", "--project-name", project, "--env-file", "/dev/null", "-f", join(root, "compose.yaml"), "-f", override];
const compose = async (...command) => (await exec("docker", [...args, ...command], { cwd: root, env, timeout: 240_000,
  signal: cleaning ? undefined : controller.signal, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const checks = [];
let base, headers;
const check = (name, ok) => { checks.push({ name, pass: Boolean(ok) }); assert.ok(ok, name); console.log(`✓ ${name}`); };
const request = (path, options = {}) => fetch(`${base}/api/v1${path}`, { headers, ...options,
  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
async function json(path, options = {}) {
  const response = await request(path, options);
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
const post = (body) => ({ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const username = "deploy-admin", initialPassword = randomBytes(24).toString("hex"), password = randomBytes(24).toString("hex");
async function login(secret) {
  // 每次建立全新会话；不能把上一会话 cookie 带入后又仅保留响应的增量 cookie。
  headers = undefined;
  const response = await request("/auth/login", post({ username, password: secret }));
  assert.equal(response.status, 200, "管理员登录");
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const data = await response.json();
  headers = { cookie, "content-type": "application/json", "x-csrf-token": decodeURIComponent(data.csrfToken) };
}
let failure;
try {
  const inspected = JSON.parse((await exec("docker", ["image", "inspect", image], { maxBuffer: 1024 * 1024 })).stdout)[0];
  await writeFile(join(out, "image.json"), JSON.stringify({ id: inspected.Id, bytes: inspected.Size, user: inspected.Config.User, created: inspected.Created }, null, 2));
  check("镜像以非 root 用户运行", inspected.Config.User === "1000:1000");
  await compose("up", "--detach", "--wait", "--wait-timeout", "180");
  const binding = await compose("port", "app", "3000");
  assert.match(binding, /^127\.0\.0\.1:\d+$/u);
  base = `http://${binding}`;
  check("全新卷尚未初始化", (await json("/setup/state")).initialized === false);
  check("安装预检通过", (await json("/setup/precheck")).ok === true);
  await json("/setup/complete", post({ admin: { username, email: "deployment@example.test", password: initialPassword, name: "部署验收管理员" },
    org: { name: "部署验收", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" }, integrations: { storage: { kind: "local" } } }));
  check("安装完成状态持久化", (await json("/setup/state")).initialized === true);
  await login(initialPassword);
  await json("/auth/password/change", post({ currentPassword: initialPassword, newPassword: password }));
  await login(password);
  const createdProject = await json("/projects", post({ key: "DEPLOY", name: "部署验收项目" }));
  const workItem = await json(`/projects/${createdProject.id}/work-items`, post({ type: "TASK", title: "重启后应保留的工作项" }));
  check("管理员完成改密并创建工作项", Boolean(workItem.id));
  const job = await json("/system/exports", post({}));
  check("导出任务已持久化入队", Boolean(job.id));
  let exported;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await request(`/system/exports/${job.id}`);
    if (response.ok) { exported = await response.text(); break; }
    assert.equal(response.status, 409, "等待导出期间只允许未就绪响应");
    await response.arrayBuffer(); await new Promise((done) => setTimeout(done, 500));
  }
  check("独立 worker 消费队列并生成业务导出", exported?.includes(workItem.id));
  await compose("restart", "app", "worker");
  await compose("up", "--detach", "--wait", "--wait-timeout", "120");
  // Docker 为 published=0 的测试端口重分配映射，重启后必须重新解析。
  const restartedBinding = await compose("port", "app", "3000");
  assert.match(restartedBinding, /^127\.0\.0\.1:\d+$/u);
  base = `http://${restartedBinding}`;
  await login(password);
  check("重启后登录及业务数据保留", (await json(`/work-items/${workItem.id}`)).title === workItem.title);
  check("共享数据卷中的导出文件保留", (await request(`/system/exports/${job.id}`)).ok);
  const credential = await json("/tokens", post({ name: "隔离镜像MCP验收", tier: "READ_ONLY", projectWhitelist: [createdProject.id] }));
  const rpc = async (method, params = {}) => {
    const response = await request("/mcp", { method: "POST", headers: {
      authorization: `Bearer ${credential.token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    assert.equal(response.status, 200, "MCP JSON-RPC 请求成功");
    return response.json();
  };
  const initialized = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "container-acceptance", version: "1" } });
  check("生产镜像MCP协议初始化成功", initialized.result?.serverInfo?.name === "feronavi");
  const tools = await rpc("tools/list");
  check("生产镜像MCP工具契约完整", tools.result?.tools?.some(tool => tool.name === "workitem.get")
    && tools.result.tools.every(tool => tool.inputSchema && tool.outputSchema && tool.annotations));
  const reread = await rpc("tools/call", { name: "workitem.get", arguments: { workItemId: workItem.id } });
  const data = JSON.parse(reread.result?.content?.find(part => part.type === "text")?.text ?? "null");
  check("生产镜像MCP复读REST写入的业务数据", !reread.result?.isError && data?.workItem?.id === workItem.id && data.workItem.title === workItem.title);
  await json(`/tokens/${credential.row.id}`, { method: "DELETE", body: "{}" });
  const revoked = await request("/mcp", { method: "POST", headers: {
    authorization: `Bearer ${credential.token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  check("生产镜像MCP令牌吊销立即生效", revoked.status === 401);
  await revoked.body?.cancel();
  const html = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) });
  const markup = await html.text();
  check("生产镜像提供 SPA 登录页面", html.ok && markup.includes('<div id="root">'));
  const assets = [...markup.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/gu)].map(match => match[1]);
  check("生产 HTML 引用 JS 和 CSS 入口", assets.some(path => path.endsWith(".js")) && assets.some(path => path.endsWith(".css")));
  for (const path of new Set(assets)) {
    const asset = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
    const type = asset.headers.get("content-type") ?? "";
    check(`生产静态入口可访问 ${path}`, asset.ok && (path.endsWith(".js") ? /javascript/u.test(type) : /text\/css/u.test(type)));
    await asset.arrayBuffer();
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "zh-CN" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.locator('form button[type="submit"]').click();
    await page.locator(".shell-header").waitFor();
    await page.goto(`${base}/projects/${createdProject.id}/board`, { waitUntil: "domcontentloaded" });
    await page.getByText(workItem.title, { exact: true }).first().waitFor();
    await page.screenshot({ path: join(out, "production-board.png"), fullPage: true });
    check("生产镜像真实浏览器登录并显示重启前工作项", errors.length === 0);
  } finally { await browser.close(); }
  const status = await compose("ps", "--format", "json");
  await writeFile(join(out, "services.jsonl"), status);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  if (typeof error.stderr === "string") {
    const safe = [env.DB_PASSWORD, initialPassword, password].reduce((text, secret) => text.replaceAll(secret, "[redacted]"), error.stderr);
    await writeFile(join(out, "failure-detail.log"), safe);
  }
  // 子进程异常可能包含命令环境，只输出摘要；不写完整错误对象。
  console.error(`部署验收失败：${failure.split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  cleaning = true;
  try {
    const logs = await compose("logs", "--no-color", "--tail", "100", "app", "worker", "db", "cache");
    const safe = [env.DB_PASSWORD, initialPassword, password].reduce((text, secret) => text.replaceAll(secret, "[redacted]"), logs);
    await writeFile(join(out, "services.log"), safe);
  } catch { /* 资源可能尚未启动。 */ }
  try { await compose("down", "--volumes", "--remove-orphans", "--timeout", "15"); }
  catch { failure ??= "本轮 Compose 资源清理失败"; process.exitCode = 1; }
  const remaining = (await exec("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`])).stdout.trim();
  const volumes = (await exec("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`])).stdout.trim();
  checks.push({ name: "本轮容器已清理", pass: !remaining });
  checks.push({ name: "本轮数据卷已清理", pass: !volumes });
  if (remaining || volumes) process.exitCode = 1;
  await writeFile(join(out, "report.json"), JSON.stringify({ project, image, checks, failure: failure?.split("\n")[0] ?? null }, null, 2));
  await rm(temp, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
