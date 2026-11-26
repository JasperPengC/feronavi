/** Docker 全新安装 + npm 已发布/本地候选 npx 包 + MCP SDK 的端到端验收。 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const exec = promisify(execFile);
const runCodex = (args, { cwd, env, timeout }) => new Promise((resolve, reject) => {
  const child = spawn("codex", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeout);
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  child.once("error", error => { clearTimeout(timer); reject(error); });
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    if (!timedOut && code === 0) return resolve({ stdout, stderr });
    const error = new Error(`Codex CLI Agent ${timedOut ? "超时" : `退出码 ${code ?? signal}`}`);
    Object.assign(error, { code: timedOut ? "ETIMEDOUT" : code, signal, killed: timedOut, stdout, stderr });
    reject(error);
  });
});
const root = resolve(import.meta.dirname, "..");
const packageSpec = process.env.MCP_PACKAGE_SPEC ?? "feronavi-mcp@0.1.0";
const localPackage = packageSpec.endsWith(".tgz") && packageSpec.startsWith("/");
const packageSource = localPackage ? "local-candidate" : "npm-registry";
const out = resolve(process.env.NPX_DOCKER_OUT ?? ".cache/published-npx-docker-acceptance");
await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(out, "compose-"));
const project = `feronavi-npx-${randomBytes(6).toString("hex")}`;
const image = process.env.DEPLOY_IMAGE ?? "feronavi-npx-accept:20261118";
const dbImage = process.env.DEPLOY_DB_IMAGE ?? "feronavi-db:npx-accept-20261118";
const password = randomBytes(24).toString("hex");
const initialPassword = randomBytes(24).toString("hex");
const env = { ...process.env, DB_PASSWORD: randomBytes(24).toString("hex"), APP_PORT: "0" };
const override = join(temp, "override.json");
await writeFile(override, JSON.stringify({ services: {
  app: { image, environment: { IPGEO_UPDATE_INTERVAL_MS: "0", UPDATE_CHECK_INTERVAL_MS: "0" }, healthcheck: { interval: "2s" } },
  worker: { image, environment: { JOB_WORKER_INTERVAL_MS: "1000" } },
  db: { image: dbImage, healthcheck: { interval: "2s" } },
  cache: { healthcheck: { interval: "2s" } },
} }));
const composeArgs = ["compose", "--project-name", project, "--env-file", "/dev/null", "-f", join(root, "compose.yaml"), "-f", override];
const compose = async (...args) => {
  try { return (await exec("docker", [...composeArgs, ...args], { cwd: root, env, timeout: 240000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
  catch (error) {
    const detail = String(error.stderr ?? "").trim().split(/\r?\n/u).at(-1);
    throw new Error(`${String(error.message).split("\n")[0]}${detail ? `: ${detail}` : ""}`, { cause: error });
  }
};
const checks = [];
const check = (name, condition, detail = "") => { if (localPackage) name = name.replaceAll("发布后的 npx", "本地候选 npx").replaceAll("发布 npx", "本地候选 npx"); checks.push({ name, pass: Boolean(condition), detail }); assert.ok(condition, name); console.log(`✓ ${name}${detail ? `：${detail}` : ""}`); };
let base, headers;
const request = (path, options = {}) => fetch(`${base}/api/v1${path}`, { headers, ...options, signal: AbortSignal.timeout(30000) });
const json = async (path, options = {}) => { const response = await request(path, options); assert.ok(response.ok, `${path} HTTP ${response.status}`); return response.json(); };
const post = body => ({ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const login = async secret => {
  headers = undefined;
  const response = await request("/auth/login", post({ username: "npx-admin", password: secret }));
  assert.equal(response.status, 200);
  const body = await response.json();
  headers = { cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join(";"), "content-type": "application/json", "x-csrf-token": decodeURIComponent(body.csrfToken) };
};
const clients = [];
let credentials = [];
let failure;
try {
  const inspected = JSON.parse((await exec("docker", ["image", "inspect", image], { maxBuffer: 1024 * 1024 })).stdout)[0];
  check("Docker 应用镜像使用非 root 用户", inspected.Config.User === "1000:1000");
  await compose("up", "--detach", "--wait", "--wait-timeout", "180");
  const binding = await compose("port", "app", "3000");
  assert.match(binding, /^127\.0\.0\.1:\d+$/u); base = `http://${binding}`;
  check("Docker 全新数据卷未初始化", (await json("/setup/state")).initialized === false);
  check("安装预检通过", (await json("/setup/precheck")).ok === true);
  await json("/setup/complete", post({ admin: { username: "npx-admin", email: "npx-admin@example.test", password: initialPassword, name: "npx 验收管理员" }, org: { name: "npx Docker 验收", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" }, integrations: { storage: { kind: "local" } } }));
  check("Docker 初始化完成", (await json("/setup/state")).initialized === true);
  await login(initialPassword);
  await json("/auth/password/change", post({ currentPassword: initialPassword, newPassword: password }));
  await login(password);
  const projectRow = await json("/projects", post({ key: "NPX", name: "发布包 Docker 联调" }));
  await json(`/projects/${projectRow.id}/work-items`, post({ type: "TASK", title: "发布包 npx 创建前的基线任务" }));
  credentials = [await json("/tokens", post({ name: "发布 npx 读写 Key", tier: "READ_WRITE", projectWhitelist: [projectRow.id] })), await json("/tokens", post({ name: "发布 npx 只读 Key", tier: "READ_ONLY", projectWhitelist: [projectRow.id] }))];
  check("Docker 初始化后生成 API Key", credentials.every(credential => credential.token?.startsWith("fero_")));

  async function connect(token) {
    const transport = new StdioClientTransport({ command: "npx", args: ["--yes", ...(localPackage ? ["--offline"] : []), "--package", packageSpec, "feronavi-mcp"], cwd: temp, stderr: "pipe", env: { PATH: process.env.PATH, HOME: temp, FERONAVI_URL: base, FERONAVI_TOKEN: token } });
    const client = new Client({ name: "published-npx-docker-acceptance", version: "1.0.0" });
    clients.push(client); await client.connect(transport, { timeout: 60000 }); return client;
  }
  const declarations = new WeakMap();
  async function call(client, name, args, allowError = false) {
    if (!declarations.has(client)) declarations.set(client, (await client.listTools()).tools);
    const tool = declarations.get(client).find(tool => tool.name === name);
    const confirmed = tool?.inputSchema.required?.includes("userConfirmed") ? { userConfirmed: true, ...args } : args;
    const result = await client.callTool({ name, arguments: confirmed });
    if (!allowError) assert.ok(!result.isError, `MCP ${name}`);
    const text = result.content.find(part => part.type === "text")?.text ?? "null";
    return { result, data: JSON.parse(text) };
  }
  const client = await connect(credentials[0].token);
  check("发布后的 npx 包启动并完成 MCP 初始化", client.getServerVersion()?.name === "feronavi");
  const tools = (await client.listTools()).tools;
  const requiredTools = ["ping", "whoami", "project.list", "workitem.get", "workitem.create", "workitem.transition", "page.update", "meta.capabilities", "meta.tool", "project.context", "idea.update", "plan.completeIteration", "plan.archiveRelease", ...(localPackage ? ["page.organize", "workitem.listRequirementRevisions", "testPlan.create", "testRun.record", "delivery.listEvidence", "delivery.releaseGate"] : [])];
  const capabilities = (await call(client, "meta.capabilities", {})).data;
  check("发布后的 npx 包发现完整 MCP 工具契约",
    tools.length === new Set(tools.map(tool => tool.name)).size
      && JSON.stringify(tools.map(tool => tool.name).sort()) === JSON.stringify(capabilities.tools.map(tool => tool.name).sort())
      && tools.every(tool => tool.inputSchema?.type === "object" && tool.outputSchema?.type === "object") && requiredTools.every(name => tools.some(tool => tool.name === name)),
    `${tools.length} 个工具；关键工具与 inputSchema 齐全`);
  const identity = await call(client, "whoami", {});
  check("发布后的 npx 包使用 Docker API Key 鉴权", identity.data.member?.username === "npx-admin");
  const created = (await call(client, "workitem.create", { projectId: projectRow.id, type: "TASK", title: "发布后的 npx 创建任务" })).data;
  const createdItem = created.result ?? created;
  check("发布后的 npx 包写入 Docker 业务数据", Boolean(createdItem.id));
  check("Docker REST 可复读 npx 写入", (await json(`/work-items/${createdItem.id}`)).title === "发布后的 npx 创建任务");
  const readOnly = await connect(credentials[1].token);
  const denied = await call(readOnly, "workitem.create", { projectId: projectRow.id, type: "TASK", title: "只读不得写入" }, true);
  check("只读 API Key 经发布 npx 包拒绝写入", denied.result.isError && denied.data.code === "FORBIDDEN");
  await json(`/tokens/${credentials[0].row.id}`, { method: "DELETE", body: "{}" });
  await assert.rejects(() => call(client, "whoami", {}));
  check("Docker 吊销 API Key 后发布 npx 连接立即失效", true);
  check("Docker worker 与应用容器均健康", (await compose("ps", "--format", "json")).includes('"Health":"healthy"'));

  if (process.env.RUN_CODEX_AGENT === "1") {
    // 前面的吊销测试刻意撤销了 credentials[0]；Agent 阶段使用一枚新的、同样仅限单项目的临时 Key。
    credentials.unshift(await json("/tokens", post({ name: "Codex Agent 临时读写 Key", tier: "READ_WRITE", projectWhitelist: [projectRow.id] })));
    const credentialFile = join(temp, "codex-agent-credential.json");
    const launcher = join(temp, "feronavi-mcp-launch.sh");
    const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
    await writeFile(credentialFile, JSON.stringify({ base, token: credentials[0].token }), { mode: 0o600 });
    await writeFile(launcher, [
      "#!/bin/sh",
      "set -eu",
      `credential=${shellQuote(credentialFile)}`,
      `export FERONAVI_URL="$(${shellQuote(process.execPath)} -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).base)' "$credential")"`,
      `export FERONAVI_TOKEN="$(${shellQuote(process.execPath)} -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).token)' "$credential")"`,
      `exec ${shellQuote(process.env.NPX_PATH ?? "/Users/cuiyupeng/.local/bin/npx")} --yes feronavi-mcp@0.1.0`,
      "",
    ].join("\n"), { mode: 0o700 });

    const sourceCodexHome = process.env.CODEX_HOME || join(process.env.HOME, ".codex");
    const sourceConfig = (await readFile(join(sourceCodexHome, "config.toml"), "utf8")).split(/\r?\n/u);
    const readSection = name => {
      const start = sourceConfig.indexOf(`[${name}]`);
      if (start < 0) return [];
      const end = sourceConfig.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]\s*$/u.test(line));
      return sourceConfig.slice(start + 1, end < 0 ? undefined : end);
    };
    const readString = (lines, key) => {
      const line = lines.find(value => new RegExp(`^\\s*${key}\\s*=`).test(value));
      const value = line?.slice(line.indexOf("=") + 1).trim();
      return value?.startsWith('"') ? JSON.parse(value) : undefined;
    };
    const rootConfig = sourceConfig.slice(0, sourceConfig.findIndex(line => /^\s*\[[^\]]+\]\s*$/u.test(line)));
    const providerName = readString(rootConfig, "model_provider");
    const model = readString(rootConfig, "model");
    const providerConfig = readSection(`model_providers.${providerName}`);
    const apiBase = readString(providerConfig, "base_url");
    const bearer = readString(providerConfig, "experimental_bearer_token");
    const wireApi = readString(providerConfig, "wire_api");
    assert.ok(providerName && model && apiBase && bearer && wireApi, "Codex 第三方 provider 缺少隔离运行所需的配置");
    const codexHome = join(temp, "codex-home");
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    const agentMode = process.env.CODEX_AGENT_MODE ?? "full";
    const enabledTools = agentMode === "create"
      ? ["whoami", "project.list", "workitem.create"]
      : ["whoami", "project.list", "meta.workflow", "workitem.create", "workitem.get", "workitem.transition", "workitem.comment", "workitem.comments"];
    await writeFile(join(codexHome, "config.toml"), [
      `model_provider = ${JSON.stringify(providerName)}`,
      `model = ${JSON.stringify(model)}`,
      'model_reasoning_effort = "low"',
      "",
      `[model_providers.${providerName}]`,
      `name = ${JSON.stringify(providerName)}`,
      `wire_api = ${JSON.stringify(wireApi)}`,
      "requires_openai_auth = false",
      `base_url = ${JSON.stringify(apiBase)}`,
      `experimental_bearer_token = ${JSON.stringify(bearer)}`,
      "",
      "[mcp_servers.feronavi]",
      `command = ${JSON.stringify(launcher)}`,
      `enabled_tools = ${JSON.stringify(enabledTools)}`,
      "",
    ].join("\n"), { mode: 0o600 });

    const probe = spawn(launcher, [], { cwd: temp, env: { ...process.env, HOME: temp }, stdio: ["pipe", "pipe", "pipe"] });
    let probeOut = ""; let probeErr = "";
    probe.stdout.setEncoding("utf8").on("data", chunk => { probeOut += chunk; });
    probe.stderr.setEncoding("utf8").on("data", chunk => { probeErr += chunk; });
    probe.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } } })}\n`);
    const probeReady = await new Promise(resolve => {
      const timer = setTimeout(() => { probe.kill("SIGTERM"); resolve(false); }, 30000);
      const checkProbe = () => {
        const responses = probeOut.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
        if (!responses.some(value => value.id === 1)) return;
        probe.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        probe.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
        probe.stdout.removeListener("data", checkProbe);
      };
      const finishProbe = () => { clearTimeout(timer); resolve(probeOut.includes('"id":2')); };
      probe.stdout.on("data", checkProbe); probe.once("close", finishProbe);
    });
    const probeResponses = probeOut.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const probeToolList = probeResponses.find(value => value.id === 2)?.result?.tools ?? [];
    const probeHasList = probeResponses.some(value => value.id === 2 && Array.isArray(value.result?.tools));
    const probeTools = probeToolList.map(value => value.name).filter(value => typeof value === "string");
    check("临时 Codex MCP launcher 直接握手", probeReady || probeHasList ? probeTools.includes("whoami") && probeTools.includes("workitem.create") : false, `ready=${probeReady || probeHasList}; tools=${probeTools.length}; stderr=${probeErr.trim().slice(0, 160) || "none"}`);

    const prompt = agentMode === "create" ? [
      "用户明确授权你在这个一次性 Docker 验收环境中进行一次业务写入。",
      "调用 whoami 确认 READ_WRITE，调用 project.list 找到唯一可见项目，然后只调用一次 workitem.create，在该项目创建标题为 `Codex Agent 写入烟测` 的 TASK。不要执行其他写操作，不要输出项目名称、ID 或令牌；最终只报告身份、创建是否成功。",
    ].join("\n") : [
      "用户明确授权你在这个一次性 Docker 验收环境中进行业务写入。",
      "使用 Feronavi MCP 做一个完整的小型闭环。先并行调用 whoami、project.list、meta.workflow；确认 READ_WRITE 且只有一个可见项目。创建标题以 `Codex Agent 闭环验收` 开头的 TASK，读取工作项和 allowedTransitions，选择一个非当前状态的可用迁移。然后执行一次状态流转和一次简短评论，最后并行复读工作项和评论，确认状态和评论均已保存。",
      "只操作这个唯一验收项目和你本次创建的工作项。不要调用其他写工具，不要输出项目名称、ID 或任何令牌。最终只报告各步骤是否成功。",
    ].join("\n");
    console.log("⏳ Codex CLI 正在通过第三方模型执行 MCP 写入闭环");
    let result;
    try {
      result = await runCodex([
        "exec", "--ephemeral", "--json", "--approve-for-me", "--skip-git-repo-check", "-C", temp,
        prompt,
      ], { cwd: temp, env: { ...process.env, CODEX_HOME: codexHome }, timeout: 180000 });
    } catch (error) {
      const details = [error.code, error.signal, error.killed ? "timeout" : ""].filter(Boolean).join(" ");
      const events = String(error.stdout ?? "").split(/\r?\n/u).flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      const stages = [...new Set(events.map(event => event.type).filter(type => typeof type === "string"))];
      const tools = [...new Set(events.map(event => event.item?.tool).filter(tool => typeof tool === "string"))];
      const stderr = String(error.stderr ?? "");
      const approvalMessage = stderr.split(/\r?\n/u).find(line => /approval|approv/iu.test(line))
        ?.replace(/\bfero_[A-Za-z0-9._-]+/gu, "fero_<redacted>")
        .replace(/Bearer\s+\S+/giu, "Bearer <redacted>")
        .slice(0, 240);
      const markers = [
        [/approval|approv/iu, "approval"],
        [/401|unauthori[sz]ed/iu, "provider-auth"],
        [/429|rate.?limit/iu, "provider-rate-limit"],
        [/timed? ?out|timeout/iu, "request-timeout"],
        [/ECONN|ENOTFOUND|network|connect/iu, "network"],
        [/unsupported|not supported|invalid.*model/iu, "provider-compatibility"],
      ].filter(([pattern]) => pattern.test(stderr)).map(([, label]) => label);
      const evidence = [
        stages.length ? `events=${stages.join(",")}` : "events=none",
        tools.length ? `tools=${tools.join(",")}` : "tools=none",
        approvalMessage ? `approvalMessage=${approvalMessage}` : markers.length ? `stderr=${[...new Set(markers)].join(",")}` : "stderr=no-known-error-marker",
      ].join("; ");
      throw new Error(`Codex CLI Agent 未完成${details ? `（${details}）` : ""}；${evidence}`, { cause: error });
    }
    const events = result.stdout.split(/\r?\n/u).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const calls = events.filter(event => event.type === "item.completed" && event.item?.type === "mcp_tool_call" && event.item.server === "feronavi");
    const toolNames = calls.map(event => event.item.tool);
    const failures = calls.filter(event => event.item.error || event.item.status !== "completed");
    const completed = events.some(event => event.type === "turn.completed");
    const payload = event => {
      const result = event?.item?.result;
      const structured = result?.structured_content ?? result?.structuredContent;
      if (structured?.result !== undefined) return structured.result;
      const text = result?.content?.find(part => part.type === "text")?.text;
      try { return JSON.parse(text ?? "null"); } catch { return null; }
    };
    const identity = payload(calls.find(event => event.item.tool === "whoami"));
    const projects = payload(calls.find(event => event.item.tool === "project.list"));
    const created = payload(calls.find(event => event.item.tool === "workitem.create"));
    const createdItem = created?.result ?? created;
    const workItemId = createdItem?.id;
    const finalAgentText = events.filter(event => event.type === "item.completed" && event.item?.type === "agent_message")
      .map(event => String(event.item.text ?? "").replace(/fero_[A-Za-z0-9._-]+/gu, "fero_<redacted>").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, "<id>"))
      .at(-1)?.slice(0, 220) ?? "";
    if (agentMode === "create") {
      const scopeMatches = projects?.items?.[0]?.id === projectRow.id;
      check("真实 Codex Agent 使用单项目 READ_WRITE Key", identity?.tokenTier === "READ_WRITE" && projects?.total === 1 && scopeMatches, `tier=${identity?.tokenTier ?? "missing"}; projectCount=${projects?.total ?? "missing"}; projectScopeMatch=${scopeMatches}; tools=${toolNames.join(",") || "none"}; events=${[...new Set(events.map(event => event.type))].join(",") || "none"}; final=${finalAgentText || "none"}`);
      const restReadBack = Boolean(workItemId) && (await json(`/work-items/${workItemId}`).catch(() => null))?.title === "Codex Agent 写入烟测";
      check("真实 Codex Agent 创建工作项并由 REST 复读", completed && failures.length === 0 && restReadBack, `${toolNames.length} 次 MCP 调用; created=${Boolean(workItemId)}; restReadBack=${restReadBack}`);
    } else {
      const reads = calls.filter(event => event.item.tool === "workitem.get").map(payload);
      const before = reads.find(value => value?.workItem?.id === workItemId);
      const after = reads.filter(value => value?.workItem?.id === workItemId).at(-1);
      const comments = payload(calls.find(event => event.item.tool === "workitem.comments"));
      check("真实 Codex Agent 使用临时 READ_WRITE Key", identity?.tokenTier === "READ_WRITE" && projects?.total === 1 && projects?.items?.[0]?.id === projectRow.id, "令牌仅能访问本次验收项目");
      check("真实 Codex Agent 完成 MCP 写入闭环", completed && failures.length === 0 && ["meta.workflow", "workitem.create", "workitem.get", "workitem.transition", "workitem.comment", "workitem.comments"].every(name => toolNames.includes(name)) && Boolean(workItemId) && before?.workItem?.statusId !== after?.workItem?.statusId && comments?.comments?.some(comment => comment.targetId === workItemId), `${toolNames.length} 次 MCP 调用；创建、流转、评论与复读均完成`);
    }
  }
} catch (error) {
  failure = String(error.message ?? error).split("\n")[0]; console.error(`发布 npx Docker 验收失败：${failure}`); process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  for (const credential of credentials) await json(`/tokens/${credential.row.id}`, { method: "DELETE", body: "{}" }).catch(() => {});
  try { await compose("down", "--volumes", "--remove-orphans", "--timeout", "15"); } catch { process.exitCode = 1; }
  const remaining = (await exec("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`])).stdout.trim();
  check("本轮 Docker 容器已清理", !remaining);
  await writeFile(join(out, "report.json"), JSON.stringify({ project, image, packageSpec, packageSource, checks: checks.map(check => ({ ...check, name: localPackage ? check.name.replaceAll("发布后的 npx", "本地候选 npx").replaceAll("发布 npx", "本地候选 npx") : check.name })), failure: failure ?? null }, null, 2));
  await rm(temp, { recursive: true, force: true });
}
process.exitCode ||= checks.every(item => item.pass) ? 0 : 1;
