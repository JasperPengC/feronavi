import "./_env.ts";   // 环境预设必须最先加载
/**
 * 运维状态聚合自检（Round 25 长任务第 27 项）：
 * 聚合 Webhook 投递计数、保留期、集成、功能开关、MCP 客户端与调度器间隔；非管理员 403。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import {
  auditEntry, featureFlag, integration, mcpClient, member, role, roleAssignment, setting, webhookDelivery, webhookEndpoint,
} from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import * as flagService from "../src/server/services/feature-flag.service.ts";
import * as integrationService from "../src/server/services/integration.service.ts";
import * as whService from "../src/server/services/webhook.service.ts";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "ops-admin";
const MEMBER = "ops-member";
const PW = "ops-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, MEMBER]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "运维管理员", ar!.id);
await mk(MEMBER, "运维成员", mr!.id);
const admin = (await loadActor(adminId))!;

// 夹具：集成 / 开关 / webhook 投递 / MCP 客户端 / 保留期
await integrationService.createIntegration(admin, { kind: "GITHUB", name: "运维夹具集成", baseUrl: "https://api.github.com", token: "ghp_ops" });
await flagService.setFeatureFlag(admin, "ui.ops.enabled", { enabled: true });
await flagService.setFeatureFlag(admin, "ui.ops.disabled", { enabled: false });
const ep = await whService.createEndpoint(admin, { name: "运维夹具端点", url: "https://example.com/hook", events: ["work_item.created"] });
await db.insert(webhookDelivery).values([
  { endpointId: ep.endpoint.id, event: "work_item.created", payload: {} as object, status: "PENDING" },
  { endpointId: ep.endpoint.id, event: "work_item.created", payload: {} as object, status: "RETRYING", attempts: 1, nextRetryAt: new Date() },
  { endpointId: ep.endpoint.id, event: "work_item.created", payload: {} as object, status: "DEAD", attempts: 5 },
]);
const { token, row: tokenRow } = await tokenService.createToken(admin, { name: "运维夹具令牌", tier: "READ_WRITE" });
void token;
await db.insert(mcpClient).values({ tokenId: tokenRow.id, clientName: "ops-client", clientVersion: "1.0", lastSeenAt: new Date(), callCount: 5 });
const { putSettings } = await import("../src/server/services/setting.service.ts");
await putSettings({ "audit.retentionDays": 30, "activity.retentionDays": 90 });

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const loginCookie = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
};
try {
  const adminCookie = await loginCookie(ADMIN);
  const res = await fetch(`${BASE}/api/v1/system/operations`, { headers: { cookie: adminCookie } });
  const body = await res.json() as {
    webhooks: { endpoints: number; pending: number; retrying: number; dead: number };
    retention: { auditDays: number; activityDays: number; auditRows: number };
    integrations: { total: number; active: number };
    featureFlags: { total: number; enabled: number };
    mcp: { clients: number; calls: number };
    schedulers: { webhookRetryIntervalMs: number };
  };
  ok("管理员可读运维状态（200）", res.status === 200, String(res.status));
  ok("Webhook 投递计数正确（端点1/待投1/重试1/死信1）",
    body.webhooks.endpoints === 1 && body.webhooks.pending === 1 && body.webhooks.retrying === 1 && body.webhooks.dead === 1,
    JSON.stringify(body.webhooks));
  ok("保留期来自 setting（30/90）", body.retention.auditDays === 30 && body.retention.activityDays === 90, JSON.stringify(body.retention));
  ok("审计行数 > 0", body.retention.auditRows > 0, String(body.retention.auditRows));
  ok("集成计数（1/1）", body.integrations.total === 1 && body.integrations.active === 1, JSON.stringify(body.integrations));
  ok("功能开关计数（2/1）", body.featureFlags.total === 2 && body.featureFlags.enabled === 1, JSON.stringify(body.featureFlags));
  ok("MCP 客户端/调用数（1/5）", body.mcp.clients === 1 && body.mcp.calls === 5, JSON.stringify(body.mcp));
  ok("调度器间隔已暴露", body.schedulers.webhookRetryIntervalMs === 30_000, String(body.schedulers.webhookRetryIntervalMs));

  const memberCookie = await loginCookie(MEMBER);
  ok("普通成员读运维状态 → 403", (await fetch(`${BASE}/api/v1/system/operations`, { headers: { cookie: memberCookie } })).status === 403);
  ok("未登录读运维状态 → 403", (await fetch(`${BASE}/api/v1/system/operations`)).status === 403);
} finally {
  await app.close();
  await db.delete(webhookDelivery);
  await db.delete(webhookEndpoint);
  await db.delete(mcpClient);
  await db.delete(integration);
  await db.delete(featureFlag);
  await db.delete(setting).where(inArray(setting.key, ["audit.retentionDays", "activity.retentionDays"]));
  await db.delete(auditEntry);
  for (const u of [ADMIN, MEMBER]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
