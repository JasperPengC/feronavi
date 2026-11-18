import "./_env.ts";
import assert from "node:assert/strict";
import { buildApp } from "../src/server/app.ts";
import { sql } from "../src/db/index.ts";

// 使用真实应用配置与请求注入，分别模拟可信反代和直连来源。
process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
const app = await buildApp();
let observed: { ip: string; protocol: string; hostname: string } | undefined;
app.addHook("onRequest", async (request) => {
  observed = { ip: request.ip, protocol: request.protocol, hostname: request.hostname };
});
try {
  let response = await app.inject({
    method: "GET", url: "/api/v1/system/status", remoteAddress: "127.0.0.1",
    headers: { host: "internal:3000", "x-forwarded-for": "198.51.100.7", "x-forwarded-proto": "https", "x-forwarded-host": "projects.example.test" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(observed, { ip: "198.51.100.7", protocol: "https", hostname: "projects.example.test" });
  response = await app.inject({
    method: "GET", url: "/api/v1/system/status", remoteAddress: "203.0.113.8",
    headers: { host: "internal:3000", "x-forwarded-for": "198.51.100.7", "x-forwarded-proto": "https", "x-forwarded-host": "projects.example.test" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(observed, { ip: "203.0.113.8", protocol: "http", hostname: "internal" });
  console.log("结果: 2 通过 / 0 失败（可信代理与伪造转发头）");
} finally { await app.close(); await sql.end({ timeout: 5 }); }
