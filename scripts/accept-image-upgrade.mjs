/** 已发布镜像→本地候选升级与备份回退；只操作随机命名的Compose项目和卷。 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.UPGRADE_IMAGE_OUT ?? ".cache/image-upgrade-acceptance");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(output, "isolated-"));
const previousImage = process.env.UPGRADE_FROM_IMAGE ?? "ghcr.io/feronavi/feronavi-app:0.2.1";
const candidateImage = process.env.DEPLOY_IMAGE;
assert.ok(candidateImage, "必须显式指定DEPLOY_IMAGE本地候选镜像");
const databaseImage = process.env.DEPLOY_DB_IMAGE ?? "ghcr.io/feronavi/feronavi-db:16-0.2.0";
const password = randomBytes(24).toString("hex"), initialPassword = randomBytes(24).toString("hex");
const env = { ...process.env, DB_PASSWORD: randomBytes(24).toString("hex"), APP_PORT: "0" };
const report = { previousImage, candidateImage, databaseImage, checks: [], failure: null };
const stacks = [];
const check = (name, value) => { report.checks.push({ name, pass: Boolean(value) }); assert.ok(value, name); console.log(`PASS ${name}`); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function stack(label) {
  const name = `feronavi-upgrade-${label}-${randomBytes(6).toString("hex")}`;
  const file = join(temporary, `${label}.json`);
  const ctx = { name, file, base: null, headers: {}, image: previousImage };
  ctx.configure = async image => { ctx.image = image; await writeFile(file, JSON.stringify({ services: {
    app: { image, environment: { IPGEO_UPDATE_INTERVAL_MS: "0", UPDATE_CHECK_INTERVAL_MS: "0" }, healthcheck: { interval: "2s" } },
    worker: { image }, db: { image: databaseImage, healthcheck: { interval: "2s" } }, cache: { healthcheck: { interval: "2s" } },
  } })); };
  ctx.compose = async (...args) => (await exec("docker", ["compose", "--project-name", name, "--env-file", "/dev/null", "-f", join(root, "compose.yaml"), "-f", file, ...args], { cwd: root, env, timeout: 240_000, maxBuffer: 32 * 1024 * 1024 })).stdout.trim();
  ctx.start = async () => {
    await ctx.compose("up", "--detach", "--wait", "--wait-timeout", "180", "--pull", "never");
    const binding = await ctx.compose("port", "app", "3000"); assert.match(binding, /^127\.0\.0\.1:\d+$/);
    ctx.base = `http://${binding}`;
  };
  await ctx.configure(previousImage); stacks.push(ctx); return ctx;
}
async function request(ctx, path, body, method = body === undefined ? "GET" : "POST") {
  return fetch(`${ctx.base}/api/v1${path}`, { method, headers: { ...ctx.headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
}
async function json(ctx, path, body, method) {
  const response = await request(ctx, path, body, method);
  assert.ok(response.ok, `${path} HTTP ${response.status}`); return response.json();
}
async function login(ctx, secret) {
  ctx.headers = {};
  const response = await request(ctx, "/auth/login", { username: "upgrade-admin", password: secret });
  assert.equal(response.status, 200);
  const body = await response.json();
  ctx.headers = { cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join(";"), "x-csrf-token": decodeURIComponent(body.csrfToken) };
}
async function tokenCanReadProject(ctx, token, projectId) {
  const client = new Client({ name: "image-upgrade-token-check", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${ctx.base}/api/v1/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const response = await client.callTool({ name: "project.list", arguments: {} });
    const result = response.structuredContent ?? JSON.parse(response.content.find(part => part.type === "text")?.text ?? "null");
    return !response.isError && result?.items?.some(item => item.id === projectId);
  } finally { await client.close(); }
}
try {
  for (const [key, image] of [["previous", previousImage], ["candidate", candidateImage], ["database", databaseImage]]) {
    const inspected = JSON.parse((await exec("docker", ["image", "inspect", image])).stdout)[0];
    report[key] = { id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture };
    check(`${key}镜像为Linux amd64`, inspected.Os === "linux" && inspected.Architecture === "amd64");
  }
  const current = await stack("source"); await current.start();
  check("0.2.1全新卷处于待初始化状态", !(await json(current, "/setup/state")).initialized);
  await json(current, "/setup/complete", { admin: { username: "upgrade-admin", email: "upgrade@example.test", password: initialPassword, name: "镜像升级验收管理员" }, org: { name: "镜像升级隔离组织", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" }, integrations: { storage: { kind: "local" } } });
  await login(current, initialPassword);
  await json(current, "/auth/password/change", { currentPassword: initialPassword, newPassword: password });
  await login(current, password);
  const project = await json(current, "/projects", { key: "UPGRADE", name: "真实旧镜像升级项目" });
  const item = await json(current, `/projects/${project.id}/work-items`, { type: "REQUIREMENT", title: "升级前需求", description: "旧版需求正文保留" });
  const page = await json(current, `/projects/${project.id}/pages`, { title: "升级前文档", content: "旧版文档正文保留" });
  const before = { item: await json(current, `/work-items/${item.id}`), page: await json(current, `/pages/${page.id}`) };
  const token = await json(current, "/tokens", { name: "升级后继续有效的项目只读令牌", tier: "READ_ONLY", projectWhitelist: [project.id] });
  const appId = await current.compose("ps", "-q", "app");
  await exec("docker", ["exec", appId, "node", "--input-type=module", "-e", "import fs from 'node:fs'; fs.mkdirSync('/data/attachments',{recursive:true}); fs.writeFileSync('/data/attachments/upgrade-probe.txt','备份恢复附件');"]);
  // 全新安装尚未保存任何密文配置，主密钥是惰性生成；用隔离配置夹具触发真实加密路径。
  await exec("docker", ["exec", appId, "node", "--input-type=module", "-e", "import {encryptSecret} from './dist-server/server/services/crypto.service.js'; import {sql} from './dist-server/db/index.js'; const value=encryptSecret('upgrade-secret-probe'); await sql`insert into setting(key,value,is_secret) values('test.upgrade.secret',${JSON.stringify(value)}::jsonb,true)`; await sql.end();"]);
  const fingerprints = async id => (await exec("docker", ["exec", id, "sha256sum", "/data/master.key", "/data/attachments/upgrade-probe.txt"])).stdout.trim();
  const originalData = await fingerprints(appId);
  const assertSecret = async id => { const result = await exec("docker", ["exec", id, "node", "--input-type=module", "-e", "import assert from 'node:assert/strict'; import {decryptSecret} from './dist-server/server/services/crypto.service.js'; import {sql} from './dist-server/db/index.js'; const [row]=await sql`select value from setting where key='test.upgrade.secret'`; assert.equal(decryptSecret(row.value),'upgrade-secret-probe'); await sql.end(); console.log('decrypt-ok');"]); return result.stdout.includes("decrypt-ok"); };
  await current.compose("stop", "app", "worker");
  // 写入冻结后同时备份数据库和共享卷，防止二者来自不同时间点。
  const databaseDump = (await exec("docker", ["compose", "--project-name", current.name, "--env-file", "/dev/null", "-f", join(root, "compose.yaml"), "-f", current.file, "exec", "-T", "db", "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges'], { env, encoding: "buffer", maxBuffer: 128 * 1024 * 1024 })).stdout;
  const dataDump = (await exec("docker", ["run", "--rm", "--volumes-from", appId, "--entrypoint", "tar", previousImage, "-czf", "-", "-C", "/data", "."], { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 })).stdout;
  await writeFile(join(temporary, "database.dump"), databaseDump); await writeFile(join(temporary, "data.tar.gz"), dataDump);
  report.backup = { databaseSha256: hash(databaseDump), dataSha256: hash(dataDump) };
  check("旧镜像停写后数据库和数据卷均有完整备份", databaseDump.length > 100 && dataDump.length > 100);
  await current.configure(candidateImage); await current.start(); await login(current, password);
  const health = await fetch(`${current.base}/health`).then(r => r.json());
  check("候选镜像自动升级后健康", health.ok === true || health.status === "ok");
  const upgradedItem = await json(current, `/work-items/${item.id}`), upgradedPage = await json(current, `/pages/${page.id}`);
  check("旧需求正文和业务版本保留", upgradedItem.description === before.item.description && upgradedItem.version === before.item.version);
  check("旧文档正文和固定版本保留", upgradedPage.content === before.page.content && upgradedPage.currentRevisionId === before.page.currentRevisionId && upgradedPage.kind === "DOCUMENT");
  const revisions = await json(current, `/work-items/${item.id}/revisions`);
  check("旧需求生成诚实的升级基线", revisions.items?.length === 1 && revisions.items[0].source === "BASELINE");
  check("升级保留旧令牌MCP鉴权", await tokenCanReadProject(current, token.token, project.id));
  check("升级保留附件和主密钥", await fingerprints(await current.compose("ps", "-q", "app")) === originalData);
  check("升级后可解密旧配置", await assertSecret(await current.compose("ps", "-q", "app")));
  await current.compose("restart", "app", "worker"); await current.start(); await login(current, password);
  check("重复启动不重复创建需求基线", (await json(current, `/work-items/${item.id}/revisions`)).items.length === 1);
  // 回退到另一套全新卷：不让旧应用直接连接已升级schema。
  const rollback = await stack("rollback");
  await rollback.compose("up", "--detach", "--wait", "--wait-timeout", "120", "--pull", "never", "db", "cache");
  const dbId = await rollback.compose("ps", "-q", "db");
  await exec("docker", ["cp", join(temporary, "database.dump"), `${dbId}:/tmp/rollback.dump`]);
  await rollback.compose("exec", "-T", "db", "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --single-transaction --exit-on-error --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/rollback.dump');
  await rollback.compose("run", "--rm", "--no-deps", "--user", "0", "--volume", `${temporary}:/backup:ro`, "--entrypoint", "tar", "app", "-xzf", "/backup/data.tar.gz", "-C", "/data");
  await rollback.start(); await login(rollback, password);
  check("备份恢复后0.2.1可重新登录", (await json(rollback, "/auth/me")).mustChangePassword === false);
  check("回退恢复原需求与文档", (await json(rollback, `/work-items/${item.id}`)).description === before.item.description && (await json(rollback, `/pages/${page.id}`)).content === before.page.content);
  check("回退恢复原附件与密钥", await fingerprints(await rollback.compose("ps", "-q", "app")) === originalData);
  check("回退恢复后可解密原配置", await assertSecret(await rollback.compose("ps", "-q", "app")));
  check("回退恢复原令牌MCP鉴权", await tokenCanReadProject(rollback, token.token, project.id));
  report.objects = { projectId: project.id, requirementId: item.id, pageId: page.id };
} catch (error) {
  report.failure = String(error.message ?? error).split("\n")[0].replace(/fero_[\w.-]+/g, "<redacted>");
  if (error.stderr) report.diagnostic = String(error.stderr).replace(/postgres(?:ql)?:\/\/\S+/g, "<database-url>").replace(/fero_[\w.-]+/g, "<redacted>").slice(-2500);
  console.error(report.failure); process.exitCode = 1;
  if (report.diagnostic) console.error(report.diagnostic);
} finally {
  for (const ctx of stacks.reverse()) {
    try { await ctx.compose("down", "--volumes", "--remove-orphans", "--timeout", "10"); }
    catch { process.exitCode = 1; report.checks.push({ name: `${ctx.name}清理`, pass: false }); }
  }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  await rm(temporary, { recursive: true, force: true });
}
process.exitCode ||= report.checks.every(check => check.pass) && !report.failure ? 0 : 1;
