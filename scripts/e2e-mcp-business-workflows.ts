import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
import { ALL_TOOLS } from "../src/server/application/capabilities/tools.ts";
/** 21 条业务闭环：真实本地 socket MCP；外部集成/Webhook 仅使用固定业务输入。 */
/* eslint-disable @typescript-eslint/no-explicit-any -- 独立 E2E 按真实 JSON-RPC 响应逐域断言 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { buildApp } from "../src/server/app.ts";
import * as tokens from "../src/server/services/token.service.ts";
import { BUSINESS_WORKFLOWS } from "../src/server/application/capabilities/intelligence-tools.ts";
import { createFullBusinessWorkflows } from "./support/full-business-workflows.ts";
import { ensureInitialized } from "./_test-helpers.ts";

type Json = Record<string, any>;
const evidence: { id: string; calls: { tool: string; ok: boolean; expectedError?: string }[]; assertions: number; status: string; error?: string }[] = [];
let active: typeof evidence[number];
let sequence = 0, assertions = 0;
let base = "", bearer = "";
const password = "isolated-workflows-password-12345";
const username = "mcp-full-closure-admin";
const proof = (condition: unknown, label: string) => { assert.ok(condition, `${active.id}: ${label}`); active.assertions++; assertions++; };
const equal = (actual: unknown, expected: unknown, label: string) => { assert.deepEqual(actual, expected, `${active.id}: ${label}`); active.assertions++; assertions++; };
async function rpc(name: string, args: Json = {}, token = bearer, expectedError?: string): Promise<Json> {
  const response = await fetch(`${base}/api/v1/mcp`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name, arguments: confirmedTestArgs(name, args) } }),
  });
  assert.equal(response.status, 200, `${active.id}/${name} HTTP 状态`);
  const envelope = await response.json() as Json;
  assert.ok(envelope.result && !envelope.error, `${active.id}/${name} JSON-RPC 结果`);
  const value = JSON.parse(envelope.result.content[0].text) as Json;
  active.calls.push({ tool: name, ok: envelope.result.isError !== true, ...(expectedError ? { expectedError } : {}) });
  if (expectedError) {
    equal(envelope.result.isError, true, `${name} 返回 MCP isError`);
    equal(value.code, expectedError, `${name} 错误码`);
    return value;
  }
  assert.notEqual(envelope.result.isError, true, `${active.id}/${name}: ${value.code ?? ""} ${value.message ?? ""} ${JSON.stringify(value.details ?? null)}`);
  assert.ok(value && typeof value === "object", `${active.id}/${name} 业务响应`);
  console.log(`  MCP ${active.id} ${name}`);
  return ALL_TOOLS.find(tool => tool.name === name)?.resultEnvelope || value.replayed !== undefined ? value.result : value;
}
const call = (name: string, args: Json = {}) => rpc(name, args);
const denied = (name: string, args: Json, code: string, token = bearer) => rpc(name, args, token, code);


await ensureInitialized();
const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select().from(role).where(eq(role.key, "MEMBER"));
const [admin, colleague] = await db.insert(member).values([
  { username, email: "mcp-full-admin@test.invalid", name: "全流程管理员", passwordHash: await hashPassword(password), status: "ACTIVE", timezone: "UTC" },
  { username: "mcp-full-colleague", email: "mcp-full-colleague@test.invalid", name: "全流程协作者", passwordHash: "test-fixture-only", status: "ACTIVE", timezone: "UTC" },
]).returning();
await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG" });
const actor = (await loadActor(admin!.id))!;
bearer = (await tokens.createToken(actor, { name: "全21业务验收", tier: "ADMIN" })).token;
const readOnly = (await tokens.createToken(actor, { name: "只读反控", tier: "READ_ONLY" })).token;
const app = await buildApp({ logger: false });


try {
  base = await app.listen({ port: 0, host: "127.0.0.1" });
  const workflows = createFullBusinessWorkflows({ call, denied, proof, equal, base, username, password, readOnly, adminId: admin!.id, colleagueId: colleague!.id, memberRoleId: memberRole!.id });
  assert.deepEqual(Object.keys(workflows).sort(), BUSINESS_WORKFLOWS.map(f => f.id).sort(), "全部21条必须有显式执行体");
  console.log("MCP 全21业务闭环：真实socket HTTP；固定业务输入；随机隔离数据库。");
  for (const flow of BUSINESS_WORKFLOWS) {
    active = { id: flow.id, calls: [], assertions: 0, status: "RUNNING" }; evidence.push(active);
    console.log(`开始 ${flow.id} ${flow.purpose}`);
    try {
      await workflows[flow.id]();
      for (const name of new Set(flow.steps)) {
        const expected = flow.steps.filter(s => s === name).length;
        proof(active.calls.filter(c => c.tool === name && c.ok).length >= expected, `${name} 实际成功调用次数至少 ${expected}`);
      }
      proof(active.assertions > flow.steps.length, "每流程包含业务事实断言");
      active.status = "PASS";
      console.log(`通过 ${flow.id}：${active.calls.length} 次HTTP MCP、${active.assertions} 断言`);
    } catch (error) {
      active.status = "FAIL"; active.error = error instanceof Error ? error.message : String(error);
      console.error(`失败 ${flow.id}: ${active.error}`);
    }
  }
  const failures = evidence.filter(e => e.status !== "PASS");
  console.log(`结果：${evidence.length - failures.length}/21流程通过；${sequence}次真实HTTP MCP；${assertions}业务断言；失败${failures.length}。`);
  assert.equal(failures.length, 0, `失败流程：${failures.map(f => f.id).join(", ")}`);
} finally {
  await mkdir(".cache/full-business-closure", { recursive: true });
  await writeFile(".cache/full-business-closure/mcp-workflows.json", JSON.stringify({ transport: "real socket HTTP", outbound: "local supplier fixture only", flows: evidence, calls: sequence, assertions }, null, 2));
  await app.close(); await closeCache(); await sql.end();
}
