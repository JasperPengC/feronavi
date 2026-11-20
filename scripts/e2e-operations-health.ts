/** 故障注入仅断开本脚本持有的 TCP 代理，不停止数据库或其他实例。 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, createConnection, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { availablePort } from "../tests/support/isolated-database.ts";
import { stopServer } from "../tests/support/isolated-app.ts";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

assertIsolatedTestEnvironment();
if (process.argv.includes("--http-child")) {
  const { default: Fastify } = await import("fastify");
  const { registerHealthRoutes } = await import("../src/server/routes/health.ts");
  const app = Fastify();
  await registerHealthRoutes(app);
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT) });
  process.on("SIGTERM", () => { void app.close().then(async () => { const { sql } = await import("../src/db/index.ts"); await sql.end({ timeout: 1 }); }); });
} else if (process.argv.includes("--worker-probe-child")) {
  const { startWorkerHealth } = await import("../src/server/services/worker-health.ts");
  const health = await startWorkerHealth(500);
  health.pollCompleted();
  process.on("SIGUSR1", health.pollFailed);
  process.on("SIGUSR2", health.pollCompleted);
  process.on("SIGURG", health.pollStarted);
  process.on("SIGTERM", () => { void health.close().then(async () => { const { sql } = await import("../src/db/index.ts"); await sql.end({ timeout: 1 }); }); });
} else {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname), "只代理隔离runner提供的本机随机库");
  const databasePort = Number(target.port || 5432);
  const sockets = new Set<Socket>();
  let online = true, blackhole = false;
  const proxy = createServer(client => {
    sockets.add(client); client.once("close", () => sockets.delete(client));
    if (!online) { client.destroy(); return; }
    if (blackhole) return;
    const upstream = createConnection({ host: "127.0.0.1", port: databasePort });
    sockets.add(upstream); upstream.once("close", () => sockets.delete(upstream));
    client.on("error", () => upstream.destroy()); upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy()); upstream.on("close", () => client.destroy());
    client.pipe(upstream); upstream.pipe(client);
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address(); assert.ok(address && typeof address !== "string");
  target.port = String(address.port); target.hostname = "127.0.0.1";
  const httpPort = await availablePort(), workerPort = await availablePort();
  const env = { ...process.env, DATABASE_URL: target.toString(), MIGRATE_ON_START: "0", PORT: String(httpPort), WORKER_HEALTH_HOST: "127.0.0.1", WORKER_HEALTH_PORT: String(workerPort), WORKER_SLOW_POLL_WARNING_SECONDS: "0.1", JOB_WORKER_INTERVAL_MS: "500", REDIS_URL: "redis://127.0.0.1:1" };
  const children: ChildProcess[] = [];
  const outputs: Array<() => string> = [];
  function start(path: string, args: string[] = []) {
    const child = spawn(process.execPath, [path, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let logs = "";
    child.stdout?.on("data", c => { logs = (logs + c).slice(-3000); }); child.stderr?.on("data", c => { logs = (logs + c).slice(-3000); });
    child.on("error", e => { logs += e.message; });
    outputs.push(() => logs);
    return { child, logs: () => logs };
  }
  async function expectStatus(port: number, status: number, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const result = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2500) }); if (result.status === status) return await result.json(); }
      catch { /* 等待连接恢复或后台轮询。 */ }
      await delay(100);
    }
    throw new Error(`端口 ${port} 未返回预期健康状态 ${status}`);
  }
  try {
    const http = start("scripts/e2e-operations-health.ts", ["--http-child"]);
    const worker = start("src/server/worker.ts");
    await expectStatus(httpPort, 200);
    try { await expectStatus(workerPort, 200); } catch (error) { throw new Error(`${(error as Error).message}; worker: ${worker.logs()}; http: ${http.logs()}`, { cause: error }); }
    console.log("PASS HTTP and worker: healthy with unavailable optional cache");
    online = false; for (const socket of sockets) socket.destroy();
    await expectStatus(httpPort, 503); await expectStatus(workerPort, 503);
    console.log("PASS HTTP and worker: database disconnected -> 503");
    online = true;
    await expectStatus(httpPort, 200); const health = await expectStatus(workerPort, 200);
    assert.equal(health.queue.duePending, 0);
    assert.ok(health.poll.lastCompletedAt, "空队列也须记录成功轮询心跳");
    console.log("PASS HTTP and worker: database restored -> 200; empty queue heartbeat observable");
    blackhole = true; for (const socket of sockets) socket.destroy();
    await expectStatus(httpPort, 503); await expectStatus(workerPort, 503);
    console.log("PASS HTTP and worker: accepted-but-unresponsive DB connections return 503 within probe deadline");
    blackhole = false; for (const socket of sockets) socket.destroy();
    await expectStatus(httpPort, 200, 15000); await expectStatus(workerPort, 200, 40000);
    await stopServer(worker.child);
    const { sql } = await import("../src/db/index.ts");
    let jobId: string | undefined;
    try {
      const [job] = await sql`insert into job (kind, run_at) values ('ops-health-test', now() - interval '10 minutes') returning id`;
      jobId = job!.id;
      const monitor = start("scripts/e2e-operations-health.ts", ["--worker-probe-child"]);
      const backlog = await expectStatus(workerPort, 200);
      assert.equal(backlog.queue.duePending, 1);
      assert.equal(backlog.queue.backlogWarning, true);
      assert.ok(backlog.queue.oldestPendingSeconds >= 600);
      console.log("PASS worker: 10-minute due backlog emits warning and metrics while remaining ready");
      monitor.child.kill("SIGUSR1");
      const failed = await expectStatus(workerPort, 503);
      assert.equal(failed.database, "ok");
      assert.equal(failed.poll.consecutiveFailures, 1);
      monitor.child.kill("SIGUSR2");
      await expectStatus(workerPort, 200);
      console.log("PASS worker: polling failure -> 503 despite reachable DB; successful poll -> 200");
      monitor.child.kill("SIGURG");
      await delay(200);
      const slow = await expectStatus(workerPort, 200);
      assert.equal(slow.poll.active, true);
      assert.ok(slow.poll.activeStartedAt);
      assert.ok(slow.poll.activeSeconds >= 0.1);
      assert.equal(slow.poll.slowPollWarning, true);
      console.log("PASS worker: persistent active poll exposes elapsed time + slow warning while staying ready");
    } finally {
      if (jobId) await sql`delete from job where id=${jobId}`;
      await sql.end({ timeout: 1 });
    }
  } catch (error) {
    console.error(outputs.map(read => read()).join("\n"));
    throw error;
  } finally {
    await Promise.all(children.map(stopServer));
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
}
