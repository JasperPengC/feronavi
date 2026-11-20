import "./_env.ts";
/** 真实 REST/MCP 公告读取隔离；受众投递回归全部静音，不产生通知或邮件。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { announcement, member, role, rolePermission, roleAssignment, team, notificationPreference, notification, auditEntry } from "../src/db/schema.ts";
import { buildApp } from "../src/server/app.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { can } from "../src/server/permission/engine.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as announcements from "../src/server/services/announcement.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

type Entry = { id: string; title: string; body: string; revokedAt: string | null };
const marker = randomUUID().replaceAll("-", "").slice(0, 7);
const password = `Announcement-${marker}-password`;
let checks = 0, rpcId = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`OK ${name}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
async function mcp(token: string, includeRevoked = false): Promise<Entry[]> {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "announcement.list", arguments: { includeRevoked } } }) });
  assert.notEqual(response.status, 429, "MCP 限流，停止本轮");
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.error, undefined);
  const result = envelope.result;
  const body = JSON.parse(result.content[0].text);
  assert.notEqual(result.isError, true, JSON.stringify(body));
  assert.deepEqual(result.structuredContent, body);
  return body.announcements;
}
async function session(username: string) {
  const response = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}
async function rest(cookie: string, includeRevoked = false): Promise<Entry[]> {
  const response = await fetch(`${process.env.BASE}/api/v1/announcements?includeRevoked=${includeRevoked}`, { headers: { cookie } });
  assert.notEqual(response.status, 429, "REST 限流，停止本轮");
  assert.equal(response.status, 200);
  return (await response.json()).announcements;
}
const ids = (rows: Entry[]) => rows.map(row => row.id).sort();

try {
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT) });
  const [readerRole, targetRole, managerRole] = await db.insert(role).values([
    { key: `custom:reader-${marker}`, name: "公告普通读者" },
    { key: `custom:target-${marker}`, name: "公告目标角色" },
    { key: `custom:manager-${marker}`, name: "公告管理角色" },
  ]).returning();
  await db.insert(rolePermission).values([
    { roleId: readerRole!.id, permissionKey: "apikey:manage_own" },
    { roleId: managerRole!.id, permissionKey: "notification:send" },
  ]);
  const [targetTeam] = await db.insert(team).values({ name: `目标团队-${marker}` }).returning();
  const [childTeam] = await db.insert(team).values({ name: `子团队-${marker}`, parentId: targetTeam!.id }).returning();
  const people = await db.insert(member).values(await Promise.all(["reader", "recipient", "manager", "scoped"].map(async name => ({
    username: `${name}-${marker}`, name: `公告验收${name}`, status: "ACTIVE", passwordHash: await hashPassword(password),
  })))).returning();
  const [reader, recipient, manager, scoped] = people;
  await db.insert(roleAssignment).values([
    ...people.map(person => ({ memberId: person.id, roleId: readerRole!.id, scopeType: "ORG", scopeId: null })),
    { memberId: recipient!.id, roleId: targetRole!.id, scopeType: "ORG", scopeId: null },
    { memberId: recipient!.id, roleId: readerRole!.id, scopeType: "TEAM", scopeId: targetTeam!.id },
    { memberId: manager!.id, roleId: managerRole!.id, scopeType: "ORG", scopeId: null },
    { memberId: scoped!.id, roleId: managerRole!.id, scopeType: "TEAM", scopeId: childTeam!.id },
    // 同一 UUID 用作其他范围的 scope_id 不能冒充目标团队成员。
    { memberId: reader!.id, roleId: readerRole!.id, scopeType: "PROJECT", scopeId: targetTeam!.id },
  ]);
  const [readerActor, recipientActor, managerActor, scopedActor] = await Promise.all(people.map(person => loadActor(person.id)));
  const ctx = (id: string) => ({ memberProjectIds: new Set<string>(), memberTeamIds: new Set<string>(), memberId: id });
  assert.equal(can(readerActor!, "notification:send", { projectId: null }, ctx(reader!.id)), false);
  assert.equal(can(managerActor!, "notification:send", { projectId: null }, ctx(manager!.id)), true);
  assert.equal(can(scopedActor!, "notification:send", { projectId: null }, ctx(scoped!.id)), false);
  const [readerToken, recipientToken, managerToken, scopedToken] = await Promise.all([readerActor, recipientActor, managerActor, scopedActor].map(actor => tokens.createToken(actor!, { name: "公告只读验收", tier: "READ_ONLY" })));
  const [readerSession, recipientSession, managerSession] = await Promise.all([reader, recipient, manager].map(person => session(person!.username)));
  const fixtures = await db.insert(announcement).values([
    { title: "缺省受众全员", body: "公开样本" },
    { title: "空对象全员", body: "公开样本", audience: {} },
    { title: "空数组配置全员", body: "公开样本", audience: { roleKeys: [], teamIds: [] } },
    { title: "目标角色", body: "角色私密正文", audience: { roleKeys: [targetRole!.key] } },
    { title: "目标团队", body: "团队私密正文", audience: { teamIds: [targetTeam!.id] } },
    { title: "角色团队并集", body: "并集正文", audience: { roleKeys: [targetRole!.key], teamIds: [childTeam!.id] } },
    { title: "子团队单独受众", body: "子团队私密正文", audience: { teamIds: [childTeam!.id] } },
    { title: "其他受众", body: "其他私密正文", audience: { roleKeys: ["custom:missing"] } },
    { title: "全员已撤回", body: "撤回私密正文", revokedAt: new Date() },
    { title: "目标角色已撤回", body: "撤回角色正文", audience: { roleKeys: [targetRole!.key] }, revokedAt: new Date() },
  ].map(row => ({ ...row, authorId: manager!.id, deliveredCount: 0 }))).returning();
  const publicIds = fixtures.slice(0, 3).map(row => row.id).sort();
  const readerMcp = await mcp(readerToken!.token, true);
  const readerRest = await rest(readerSession!, true);
  assert.deepEqual({ mcp: ids(readerMcp), rest: ids(readerRest) }, { mcp: publicIds, rest: publicIds }, "普通成员的REST/MCP只能返回全员未撤回公告，不能泄露非受众或撤回正文");
  check("普通成员REST/MCP过滤私密受众和已撤回正文", true);
  assert.deepEqual(ids(await mcp(readerToken!.token)), publicIds);
  const recipientIds = fixtures.slice(0, 6).map(row => row.id).sort();
  assert.deepEqual(ids(await mcp(recipientToken!.token, true)), recipientIds);
  assert.deepEqual(ids(await rest(recipientSession!, true)), recipientIds);
  check("角色或直接团队命中即可读取，团队权限闭包不扩大公告受众", true);
  const scopedIds = [...fixtures.slice(0, 3), fixtures[5]!, fixtures[6]!].map(row => row.id).sort();
  assert.deepEqual(ids(await mcp(scopedToken!.token, true)), scopedIds);
  check("仅团队范围公告权限不能提升为全组织审计查看", true);
  assert.deepEqual(ids(await mcp(managerToken!.token)), fixtures.filter(row => !row.revokedAt).map(row => row.id).sort());
  assert.deepEqual(ids(await mcp(managerToken!.token, true)), fixtures.map(row => row.id).sort());
  assert.deepEqual(ids(await rest(managerSession!, true)), fixtures.map(row => row.id).sort());
  check("具有notification:send的自定义管理角色可审计所有公告及撤回正文", true);
  await db.delete(roleAssignment).where(and(eq(roleAssignment.memberId, recipient!.id), eq(roleAssignment.roleId, targetRole!.id)));
  assert.deepEqual(ids(await mcp(recipientToken!.token, true)), [...fixtures.slice(0, 3), fixtures[4]!].map(row => row.id).sort());
  check("角色撤销立即收回角色受众公告访问", true);
  await db.delete(roleAssignment).where(and(eq(roleAssignment.memberId, recipient!.id), eq(roleAssignment.scopeType, "TEAM")));
  assert.deepEqual(ids(await rest(recipientSession!, true)), publicIds);
  check("团队退出立即收回团队受众公告访问", true);
  await db.insert(announcement).values(Array.from({ length: 105 }, (_, index) => ({ authorId: manager!.id, title: `私密新公告${index}`, body: "分页不能挤掉公开公告", audience: { roleKeys: ["custom:missing"] }, deliveredCount: 0 })));
  assert.deepEqual(ids(await mcp(readerToken!.token, true)), publicIds);
  check("按受众过滤后再取100条，私密公告不挤掉可见公告", true);
  check("权限过滤只影响读取，撤回记录和正文仍持久保存", (await db.select().from(announcement).where(eq(announcement.id, fixtures[8]!.id)))[0]?.body === "撤回私密正文");
  await db.insert(roleAssignment).values([
    { memberId: recipient!.id, roleId: targetRole!.id, scopeType: "ORG", scopeId: null },
    { memberId: recipient!.id, roleId: readerRole!.id, scopeType: "TEAM", scopeId: targetTeam!.id },
  ]);
  await db.insert(notificationPreference).values(people.map(person => ({ memberId: person.id, categoryPrefs: { ANNOUNCEMENT: { inApp: false, email: false } } })));
  const roleSent = await announcements.sendAnnouncement(managerActor!, { title: "静音角色受众", body: "不会投递", audience: { roleKeys: [targetRole!.key] } });
  const teamSent = await announcements.sendAnnouncement(managerActor!, { title: "静音团队受众", body: "不会投递", audience: { teamIds: [targetTeam!.id] } });
  const unionSent = await announcements.sendAnnouncement(managerActor!, { title: "静音并集受众", body: "不会投递", audience: { roleKeys: [targetRole!.key], teamIds: [childTeam!.id] } });
  check("发送受众与读取共用角色或直接团队匹配，其他scope同UUID不误入", roleSent.targetCount === 1 && teamSent.targetCount === 1 && unionSent.targetCount === 2);
  for (const sent of [roleSent, teamSent, unionSent]) {
    assert.equal(sent.deliveredCount, 0);
    assert.equal((await db.select().from(notification).where(eq(notification.groupKey, `announcement:${sent.id}`))).length, 0);
    assert.equal((await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, sent.id), eq(auditEntry.action, "announcement.sent")))).length, 1);
  }
  check("隔离静音公告零通知投递且保留一次审计记录", true);
  console.log(`公告受众权限 ${checks}/${checks}`);
} finally { await app.close(); await sql.end(); }
