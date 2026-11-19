import "./_env.ts";
/** 实际打包 → 仓库外 npx 安装 → SDK 初始化 → 业务写读流转 → 权限与吊销。 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const base = process.env.BASE;
const output = resolve(process.env.MCP_PACKAGE_OUT ?? ".cache/mcp-package-acceptance");
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "feronavi-npx-"));
const checks = [], credentials = [], clients = [];
const check = (name, condition) => {
  checks.push({ name, pass: Boolean(condition) }); assert.ok(condition, name); console.log(`✓ ${name}`);
};
let headers, failure;
async function api(path, method = "GET", data) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers,
    body: data === undefined ? (method === "DELETE" ? "{}" : undefined) : JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
async function connect(tarball, token) {
  // 空目录、独立 npm cache；不能复用仓库 node_modules 或源码 bin。
  const transport = new StdioClientTransport({ command: "npx", args: ["--yes", "--cache", join(temp, "npm-cache"), "--package", tarball, "--", "feronavi-mcp"],
    cwd: temp, stderr: "pipe", env: { PATH: process.env.PATH, HOME: temp,
      FERONAVI_URL: base, FERONAVI_TOKEN: token } });
  const client = new Client({ name: "feronavi-package-acceptance", version: "1.0.0" });
  clients.push(client);
  await client.connect(transport, { timeout: 60000 });
  transport.stderr?.on("data", () => {});
  return client;
}
async function call(client, name, args, allowError = false) {
  const result = await client.callTool({ name, arguments: args });
  if (!allowError) assert.ok(!result.isError, `工具 ${name} 执行成功`);
  return { error: result.isError, data: JSON.parse(result.content.find(part => part.type === "text")?.text ?? "null") };
}
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", output], {
    cwd: "packages/feronavi-mcp", encoding: "utf8", maxBuffer: 1024 * 1024,
  }))[0];
  const tarball = join(output, packed.filename);
  writeFileSync(join(output, "pack.json"), JSON.stringify(packed, null, 2));
  check("包文件白名单仅含入口、许可证、README 与元数据", packed.files.length === 4
    && packed.files.every(file => ["package.json", "LICENSE", "README.md", "bin/feronavi-mcp.mjs"].includes(file.path)));
  const version = execFileSync("npx", ["--yes", "--cache", join(temp, "npm-cache"), "--package", tarball, "--", "feronavi-mcp", "--version"], {
    cwd: temp, encoding: "utf8", timeout: 60000,
  }).trim();
  check("仓库外 npx tarball 安装并执行 bin", version === packed.version);
  check("安装包具有发布校验信息", Boolean(packed.integrity && packed.shasum && readFileSync(tarball).length));

  const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.A11Y_USERNAME ?? "demo", password: process.env.A11Y_PASSWORD ?? "demo-password-12345" }), signal: AbortSignal.timeout(15000) });
  assert.equal(login.status, 200);
  const session = await login.json();
  headers = { cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "),
    "content-type": "application/json", "x-csrf-token": decodeURIComponent(session.csrfToken) };
  const project = await api("/projects", "POST", { key: `N${Date.now().toString(36).toUpperCase()}`, name: "npx 发布安装包验收" });
  for (const tier of ["READ_WRITE", "READ_ONLY"]) credentials.push(await api("/tokens", "POST", {
    name: `npx 发布验收 ${tier}`, tier, projectWhitelist: [project.id],
  }));
  const client = await connect(tarball, credentials[0].token);
  check("标准 MCP SDK 通过 npx 初始化", client.getServerVersion()?.name === "feronavi");
  const tools = (await client.listTools()).tools;
  const requiredTools = ["ping", "whoami", "project.list", "workitem.get", "workitem.create", "workitem.transition", "page.update"];
  check("工具发现含完整业务契约",
    tools.length === 54 && tools.every(tool => tool.inputSchema?.type === "object") && requiredTools.every(name => tools.some(tool => tool.name === name)),
    `${tools.length} 个工具；关键工具与 inputSchema 齐全`);
  const resources = (await client.listResources()).resources;
  check("业务指南和工具目录可发现",
    resources.some(resource => resource.uri === "feronavi://guide/business-workflows")
      && resources.some(resource => resource.uri === "feronavi://catalog/tools"));
  const guide = await client.readResource({ uri: "feronavi://guide/business-workflows" });
  check("业务指南包含权限和写后核验边界",
    guide.contents.some(content => content.text.includes("确认") && content.text.includes("回读")));
  const prompts = (await client.listPrompts()).prompts;
  check("项目分析、交付和知识检索提示词可发现",
    ["analyze-project", "deliver-work-item", "knowledge-grounded-answer"].every(name => prompts.some(prompt => prompt.name === name)));
  const deliveryPrompt = await client.getPrompt({ name: "deliver-work-item", arguments: { projectScope: "项目 A", request: "创建一个任务" } });
  check("交付提示词注入范围与请求", deliveryPrompt.messages.some(message => message.content.type === "text"
    && message.content.text.includes("项目 A") && message.content.text.includes("创建一个任务")));
  check("whoami 真实鉴权成功", Boolean((await call(client, "whoami", {})).data.member?.username));
  const created = (await call(client, "workitem.create", { projectId: project.id, type: "TASK", title: "npx 安装包创建的工作项" })).data;
  const workItem = created.result ?? created;
  check("安装包可创建业务工作项", Boolean(workItem.id));
  const fetched = (await call(client, "workitem.get", { workItemId: workItem.id })).data;
  check("REST 复读 npx 写入结果一致", (await api(`/work-items/${workItem.id}`)).title === fetched.workItem.title);
  const transition = fetched.allowedTransitions?.[0];
  assert.ok(transition, "工作项提供可用迁移边");
  await call(client, "workitem.transition", { workItemId: workItem.id, version: fetched.workItem.version, toStateKey: transition.toStateKey });
  check("MCP 流转后版本递增且 REST 可见", (await api(`/work-items/${workItem.id}`)).version > fetched.workItem.version);
  const readonly = await connect(tarball, credentials[1].token);
  const denied = await call(readonly, "workitem.create", { projectId: project.id, type: "TASK", title: "不得创建" }, true);
  check("安装包只读令牌无法写入", denied.error && denied.data.code === "FORBIDDEN");
  await api(`/tokens/${credentials[0].row.id}`, "DELETE");
  await assert.rejects(() => call(client, "whoami", {}), /令牌无效/u);
  check("令牌吊销对已连接 npx 客户端即时生效", true);
} catch (error) {
  failure = error.message.split("\n")[0];
  console.error(`MCP 包验收失败：${failure}`); process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  for (const credential of credentials) await api(`/tokens/${credential.row.id}`, "DELETE").catch(() => {});
  rmSync(temp, { recursive: true, force: true });
  writeFileSync(join(output, "report.json"), JSON.stringify({ checks, failure: failure ?? null }, null, 2));
}
