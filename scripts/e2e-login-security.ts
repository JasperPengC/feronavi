import "./_env.ts";
/** 隔离随机库 + 独占临时Valkey，验证真实HTTP与跨进程限额，不连接开发缓存。 */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";

if (process.argv.includes("--worker")) {
  const { buildApp } = await import("../src/server/app.ts");
  const { sql } = await import("../src/db/index.ts");
  const app = await buildApp();
  const base = await app.listen({ port: 0, host: "127.0.0.1" });
  process.send?.({ base });
  process.once("SIGTERM", async () => { await app.close(); await sql.end(); process.exit(0); });
} else {
  const { ensureInitialized } = await import("./_test-helpers.ts");
  const { db, sql } = await import("../src/db/index.ts");
  const { member } = await import("../src/db/schema.ts");
  const { hashPassword, verifyPassword } = await import("../src/server/auth/password.ts");
  await ensureInitialized();
  const suffix = randomUUID().slice(0, 8);
  const username = `security-${suffix}`;
  const password = "isolated-correct-horse-battery";
  const realHash = await hashPassword(password);
  await db.insert(member).values([
    { username, name: "安全测试", status: "ACTIVE", passwordHash: realHash },
    { username: `sentinel-${suffix}`, name: "注销哨兵", status: "ACTIVE", passwordHash: "!" },
  ]);
  assert.equal(await verifyPassword(realHash, password), true);
  assert.equal(await verifyPassword("!", password), false);
  assert.equal(await verifyPassword("invalid", password), false);
  const children = new Set<ChildProcess>();
  const container = `feronavi-login-security-${suffix}`;
  let containerCreated = false;
  let checks = 0;
  const check = (label: string, condition: boolean) => { assert.ok(condition, label); checks++; console.log(`OK ${label}`); };
  async function worker(redisURL: string, trusted = true) {
    const env = { ...process.env, REDIS_URL: redisURL };
    if (trusted) env.TRUSTED_PROXY_CIDRS = "127.0.0.1";
    else delete env.TRUSTED_PROXY_CIDRS;
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker"], { env, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    children.add(child);
    let errors = "";
    child.stderr?.on("data", (data) => { errors = (errors + data).slice(-4000); });
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("隔离HTTP服务启动超时")), 30_000);
      child.once("message", (message) => { clearTimeout(timer); resolve((message as { base: string }).base); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`隔离HTTP服务退出 ${code}: ${errors}`)); });
    });
    return { base, stop: async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited; clearTimeout(timer); children.delete(child);
    } };
  }
  async function request(base: string, user: string, ip: string, pass = "incorrect-password", path = "/api/v1/auth/login") {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ username: user, password: pass }) });
    return { status: response.status, body: await response.json() as { code?: string }, cookie: response.headers.get("set-cookie") };
  }
  try {
    execFileSync("docker", ["run", "-d", "--name", container, "--label", "feronavi.test=login-security", "-p", "127.0.0.1::6379", "valkey/valkey:8-alpine"], { stdio: "pipe" });
    containerCreated = true;
    const port = execFileSync("docker", ["port", container, "6379/tcp"], { encoding: "utf8" }).trim().split(":").at(-1);
    const redisURL = `redis://127.0.0.1:${port}`;
    const redis = new Redis(redisURL, { connectTimeout: 1000, maxRetriesPerRequest: 0, retryStrategy: () => null });
    redis.on("error", () => {});
    try { assert.equal(await redis.ping(), "PONG"); } finally { redis.disconnect(); }

    // 单独进程、无可信代理配置：伪造XFF既不能绕过本地登录，也不能绕过LDAP入口速率限制。
    const direct = await worker("", false);
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/ldap/login"]) {
      for (let n = 0; n < 20; n++) await request(direct.base, "", `198.51.100.${n}`, "", path);
      const result = await request(direct.base, "", "203.0.113.9", "", path);
      check(`${path} 独立20/min限流且伪造XFF无效`, result.status === 429 && result.body.code === "RATE_LIMITED");
    }
    await direct.stop();

    for (const mode of ["shared", "missing", "interrupted"] as const) {
      const first = await worker(mode === "missing" ? "" : redisURL);
      const second = mode === "shared" ? await worker(redisURL) : first;
      const good = await request(first.base, username, "192.0.2.200", password);
      check(`${mode} 正常账号可登录并签发Cookie`, good.status === 200 && !!good.cookie?.includes("feronavi_session="));
      const known = await request(first.base, username, "192.0.2.201");
      const unknown = await request(first.base, `unknown-${mode}-${suffix}`, "192.0.2.202");
      const sentinel = await request(first.base, `sentinel-${suffix}`, "192.0.2.203", password);
      check(`${mode} 错密、未知及哨兵响应同形且无会话`, known.status === 403 && unknown.status === 403 && sentinel.status === 403 && JSON.stringify(known.body) === JSON.stringify(unknown.body) && JSON.stringify(known.body) === JSON.stringify(sentinel.body) && !sentinel.cookie);
      const target = `victim-${mode}-${suffix}`;
      for (let n = 0; n < 10; n++) {
        const current = n % 2 ? second : first;
        const result = await request(current.base, target, `198.51.100.${n}`);
        assert.equal(result.status, 403, `${mode}第${n + 1}次账户失败`);
        if (mode === "interrupted" && n === 0) execFileSync("docker", ["stop", "--time", "1", container], { stdio: "pipe" });
      }
      const locked = await request(second.base, target, "198.51.100.240");
      check(`${mode} 账户跨IP第11次429${mode === "shared" ? "（跨进程）" : ""}`, locked.status === 429 && locked.body.code === "RATE_LIMITED");
      for (let n = 0; n < 10; n++) assert.equal((await request(first.base, `spray-${mode}-${n}-${suffix}`, "203.0.113.88")).status, 403);
      const ipLocked = await request(first.base, `spray-final-${mode}`, "203.0.113.88");
      check(`${mode} IP跨账户第11次429`, ipLocked.status === 429 && ipLocked.body.code === "RATE_LIMITED");
      await first.stop(); if (second !== first) await second.stop();
    }
    console.log(`登录安全HTTP验收 ${checks} 项通过。`);
  } finally {
    for (const child of children) child.kill("SIGKILL");
    if (containerCreated) execFileSync("docker", ["rm", "-f", container], { stdio: "pipe" });
    await sql.end();
  }
}
