/** 真实 ldapts + 本地 LDAP BER 协议夹具；有效入参、多IP与多进程并发额度。 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";
import { startIsolatedRedis } from "../tests/support/isolated-special.ts";
import { stopServer } from "../tests/support/isolated-app.ts";

assertIsolatedTestEnvironment();
if (process.argv.includes("--child")) {
  const { loginLdap } = await import("../src/server/services/ldap.service.ts");
  process.send?.({ ready: true });
  process.on("message", (input: { id: string; username: string; offset: number; count: number }) => {
    void Promise.all(Array.from({ length: input.count }, async (_, index) => {
      try { await loginLdap({ idpId: input.id, username: input.username, password: "wrong-directory-password" }, { ip: `198.51.100.${input.offset + index}`, userAgent: null }); return "OK"; }
      catch (error) { return error && typeof error === "object" && "code" in error ? error.code : "ERROR"; }
    })).then(results => process.send?.({ results }));
  });
  process.on("SIGTERM", () => { void import("../src/db/index.ts").then(({ sql }) => sql.end({ timeout: 1 })).then(() => process.exit(0)); });
} else {
  const { db, sql } = await import("../src/db/index.ts");
  const { idpConfig, member } = await import("../src/db/schema.ts");
  const { loginLdap } = await import("../src/server/services/ldap.service.ts");
  const sockets = new Set<Socket>();
  const children: ChildProcess[] = [];
  let binds = 0, searches = 0;
  const encode = (tag: number, data: Buffer) => Buffer.concat([Buffer.from([tag]), data.length < 128 ? Buffer.from([data.length]) : Buffer.from([0x82, data.length >> 8, data.length & 255]), data]);
  const str = (s: string) => encode(4, Buffer.from(s));
  const result = (id: Buffer, op: number, code: number) => encode(0x30, Buffer.concat([id, encode(op, Buffer.concat([encode(0x0a, Buffer.from([code])), str(""), str("")]))]));
  function read(data: Buffer, offset = 0) {
    if (data.length < offset + 2) return null;
    const tag = data[offset]!, first = data[offset + 1]!;
    let length = first, header = 2;
    if (first & 128) { const bytes = first & 127; if (bytes > 4 || data.length < offset + 2 + bytes) return null; length = data.readUIntBE(offset + 2, bytes); header += bytes; }
    if (data.length < offset + header + length) return null;
    return { tag, value: data.subarray(offset + header, offset + header + length), raw: data.subarray(offset, offset + header + length), end: offset + header + length };
  }
  const dn = "uid=directory-user,dc=example,dc=com";
  const server = createServer(socket => {
    sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const message = read(pending); if (!message) break;
        pending = pending.subarray(message.end);
        const id = read(message.value)!; const op = read(message.value, id.end)!;
        if (op.tag === 0x42) { socket.end(); continue; }
        if (op.tag === 0x63) {
          searches++;
          const attribute = (name: string, value: string) => encode(0x30, Buffer.concat([str(name), encode(0x31, str(value))]));
          socket.write(encode(0x30, Buffer.concat([id.raw, encode(0x64, Buffer.concat([str(dn), encode(0x30, Buffer.concat([attribute("uid", "directory-user"), attribute("mail", "directory-user@example.invalid"), attribute("displayName", "目录测试用户")]))]))])));
          socket.write(result(id.raw, 0x65, 0));
        } else if (op.tag === 0x60) {
          binds++;
          const version = read(op.value)!; const name = read(op.value, version.end)!; const credential = read(op.value, name.end)!;
          const code = credential.value.toString() === "correct-directory-password" ? 0 : 49;
          // 保留真实网络并发窗口，失败记录不能在预留额度前串行化请求。
          setTimeout(() => { if (!socket.destroyed) socket.write(result(id.raw, 0x61, code)); }, 200);
        } else socket.destroy();
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const issuer = `ldap://127.0.0.1:${address.port}`;
  const redis = await startIsolatedRedis(process.env.FERONAVI_TEST_DIRECTORY!);
  let id: string | undefined;
  async function worker(redisUrl: string) {
    const child = spawn(process.execPath, ["scripts/e2e-ldap-login-limits.ts", "--child"], { env: { ...process.env, REDIS_URL: redisUrl }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    children.push(child);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("LDAP child startup timeout")), 15000); child.once("message", () => { clearTimeout(timer); resolve(); }); child.once("exit", () => { clearTimeout(timer); reject(new Error("LDAP child exited")); }); });
    return child;
  }
  function attempt(child: ChildProcess, username: string, count: number, offset: number) {
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("LDAP attempts timeout")), 15000);
      child.once("message", (message: { results: string[] }) => { clearTimeout(timer); resolve(message.results); });
      child.send({ id, username, count, offset });
    });
  }
  try {
    const [idp] = await db.insert(idpConfig).values({ kind: "LDAP", issuer, clientId: "", enabled: true, config: { url: issuer, baseDn: "dc=example,dc=com", timeoutMs: 3000 } }).returning();
    id = idp!.id;
    const [known] = await db.insert(member).values({ username: "directory-user", name: "目录测试用户", email: "directory-user@example.invalid", passwordHash: "!ldap", status: "ACTIVE", externalIdp: id, externalSubject: dn }).returning();
    const good = await loginLdap({ idpId: id, username: "directory-good", password: "correct-directory-password" }, { ip: "192.0.2.1", userAgent: null });
    assert.equal(good.memberId, known!.id);
    console.log("PASS real LDAP protocol search + user bind + existing-member login");
    const first = await worker(redis.url), second = await worker(redis.url);
    let before = binds;
    const shared = (await Promise.all([attempt(first, "ldap-shared-account", 6, 1), attempt(second, "ldap-shared-account", 5, 21)])).flat();
    assert.equal(shared.filter(code => code === "RATE_LIMITED").length, 1, "多副本、多IP同账户第11次必须在目录调用前限流");
    assert.equal(binds - before, 10); assert.equal(shared.filter(code => code === "FORBIDDEN").length, 10);
    console.log("PASS shared cache: 11 concurrent attempts / 2 processes / 11 IPs -> 10 LDAP binds + 1 rate limit");
    const local = await worker("");
    before = binds;
    const missing = await attempt(local, "ldap-local-account", 11, 41);
    assert.equal(missing.filter(code => code === "RATE_LIMITED").length, 1); assert.equal(binds - before, 10);
    console.log("PASS absent cache: local atomic account attempt cap remains effective");
    const interrupted = await worker(redis.url);
    before = binds;
    assert.ok((await attempt(interrupted, "ldap-drop-account", 5, 61)).every(code => code === "FORBIDDEN"));
    await redis.suspend(); await delay(50);
    const dropped = await attempt(interrupted, "ldap-drop-account", 6, 81);
    assert.equal(dropped.filter(code => code === "RATE_LIMITED").length, 1); assert.equal(binds - before, 10);
    console.log(`PASS cache interrupted: local quota retains first 5 attempts; ${searches} protocol searches observed`);
  } finally {
    await Promise.all(children.map(stopServer));
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await redis.stop(); await sql.end({ timeout: 1 });
  }
}
