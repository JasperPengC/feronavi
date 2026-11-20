import "./_env.ts";
/** 真实 HTTP 组织管理闭环：目录、团队、成员生命周期、角色与作用域安全。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, role, roleAssignment, mcpClient, apiToken } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { createSession, SESSION_COOKIE } from "../src/server/auth/session.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as structure from "../src/server/services/org-structure.service.ts";
import * as members from "../src/server/services/member.service.ts";
import { canDeliverEvent, subscribe, type SseEvent } from "../src/server/services/events.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const marker = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const required = [
  "organization.get", "organization.update", "organization.getTemplate", "organization.applyTemplate",
  "department.list", "department.create", "department.update", "department.archive",
  "position.list", "position.create", "position.update", "position.archive",
  "team.list", "team.members", "team.create", "team.update", "team.delete",
  "member.get", "member.getPermissions", "member.assignOrganization", "member.disable", "member.enable", "member.anonymize",
  "role.list", "role.listPermissions", "role.listScopes", "role.create", "role.update", "role.delete",
  "role.listAssignments", "role.createAssignment", "role.updateAssignment", "role.deleteAssignment",
];
let checks = 0, rpcId = 0;
const check = (label: string, value: unknown) => { assert.ok(value, label); checks++; console.log(`OK ${label}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
const local: SseEvent[] = [];
const unsubscribe = subscribe(event => { if (event.event === "workspace.invalidated") local.push(event); });
const streams: { abort: AbortController; done: Promise<void> }[] = [];
async function connect(memberId: string) {
  const session = await createSession({ memberId });
  const abort = new AbortController();
  const response = await fetch(`${process.env.BASE}/api/v1/events`, { headers: { cookie: `${SESSION_COOKIE}=${session.token}` }, signal: abort.signal });
  assert.equal(response.status, 200);
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const reader = response.body!.getReader();
  const done = (async () => {
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) return;
        buffer += new TextDecoder().decode(chunk.value);
        let split: number;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const event = /^event: (.+)$/mu.exec(block)?.[1];
          if (event) events.push({ event, data: JSON.parse(/^data: (.+)$/mu.exec(block)![1]!) });
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
  })();
  streams.push({ abort, done });
  return events;
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(30); }
  assert.ok(predicate(), "组织事件未在3秒内抵达");
}
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  assert.notEqual(response.status, 429, "MCP 限流：停止本轮，不重试");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return body.result;
}
async function call(token: string, name: string, args: Record<string, unknown>, error?: string) {
  const result = await rpc(token, "tools/call", { name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (error) { assert.equal(result.isError, true, name); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(result.structuredContent, data); }
  return data;
}
const confirmed = { userConfirmed: true };
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const roles = await db.select().from(role);
  const adminRole = roles.find(row => row.key === "ADMIN")!;
  const memberRole = roles.find(row => row.key === "MEMBER")!;
  const guestRole = roles.find(row => row.key === "GUEST")!;
  const [adminRow, ordinaryRow, targetRow, scopedAdminRow] = await db.insert(member).values([
    { username: `org-admin-${marker}`, name: "组织管理管理员", status: "ACTIVE", passwordHash: "isolated-service-fixture" },
    { username: `org-member-${marker}`, name: "普通组织成员", status: "ACTIVE", passwordHash: "isolated-service-fixture" },
    { username: `org-target-${marker}`, name: "生命周期目标", email: `org-${marker}@example.test`, status: "ACTIVE", passwordHash: "isolated-service-fixture" },
    { username: `org-scoped-${marker}`, name: "仅项目管理员", status: "ACTIVE", passwordHash: "isolated-service-fixture" },
  ]).returning();
  await db.insert(roleAssignment).values([
    { memberId: adminRow!.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null },
    { memberId: ordinaryRow!.id, roleId: memberRole.id, scopeType: "ORG", scopeId: null },
    { memberId: targetRow!.id, roleId: guestRole.id, scopeType: "ORG", scopeId: null },
    { memberId: scopedAdminRow!.id, roleId: guestRole.id, scopeType: "ORG", scopeId: null },
  ]);
  const admin = (await loadActor(adminRow!.id))!;
  const ordinary = (await loadActor(ordinaryRow!.id))!;
  const project = await projects.createProject(admin, { key: `OR${marker}`, name: "组织权限反控项目" });
  await db.insert(roleAssignment).values({ memberId: scopedAdminRow!.id, roleId: adminRole.id, scopeType: "PROJECT", scopeId: project.id });
  const scopedAdmin = (await loadActor(scopedAdminRow!.id))!;
  const global = await tokens.createToken(admin, { name: "组织全账号读写", tier: "READ_WRITE", projectWhitelist: [] });
  const read = await tokens.createToken(admin, { name: "组织全账号只读", tier: "READ_ONLY", projectWhitelist: [] });
  const scoped = await tokens.createToken(admin, { name: "组织项目白名单", tier: "READ_WRITE", projectWhitelist: [project.id] });
  const low = await tokens.createToken(ordinary, { name: "普通成员全账号", tier: "READ_WRITE", projectWhitelist: [] });
  const mixed = await tokens.createToken(scopedAdmin, { name: "项目高权限组织低权限", tier: "READ_WRITE", projectWhitelist: [] });
  const listing = await rpc(global.token, "tools/list");
  check("33项组织工具公开严格输入输出契约", required.every(name => listing.tools.some((tool: { name: string; inputSchema: { additionalProperties?: boolean }; outputSchema?: { additionalProperties?: boolean } }) => tool.name === name && tool.inputSchema.additionalProperties === false && tool.outputSchema?.additionalProperties === false)));
  check("组织工具不开放密码密钥或邀请操作", !listing.tools.some((tool: { name: string }) => /^(?:member|organization|role)\..*(?:password|secret|invite|createMember)/i.test(tool.name)));
  const adminEvents = await connect(adminRow!.id);
  const ordinaryEvents = await connect(ordinaryRow!.id);
  const org = await call(read.token, "organization.get", {});
  await call(global.token, "organization.update", { name: "无确认" }, "VALIDATION");
  await call(global.token, "organization.update", { name: "假确认", userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await call(global.token, "organization.update", { name: "伪确认", userConfirmed: "true" }, "VALIDATION");
  await call(global.token, "organization.update", { ...confirmed, name: "多余字段", password: "forbidden" }, "VALIDATION");
  await call(global.token, "organization.update", confirmed, "VALIDATION");
  await call(global.token, "member.assignOrganization", { ...confirmed, memberId: targetRow!.id }, "VALIDATION");
  await call(read.token, "organization.update", { ...confirmed, name: "只读拒绝" }, "FORBIDDEN");
  for (const [name, args] of [
    ["organization.get", {}], ["department.list", {}], ["position.list", {}], ["team.list", {}],
    ["member.get", { memberId: targetRow!.id }], ["role.list", {}],
    ["organization.update", { ...confirmed, name: "白名单越权" }],
  ] as const) await call(scoped.token, name, args, "FORBIDDEN");
  for (const deniedToken of [low.token, mixed.token]) {
    await call(deniedToken, "organization.update", { ...confirmed, name: "角色越权" }, "FORBIDDEN");
    await call(deniedToken, "department.create", { ...confirmed, name: "角色越权" }, "FORBIDDEN");
    await call(deniedToken, "team.create", { ...confirmed, name: "角色越权" }, "FORBIDDEN");
    await call(deniedToken, "member.disable", { ...confirmed, memberId: targetRow!.id }, "FORBIDDEN");
    await call(deniedToken, "role.list", {}, "FORBIDDEN");
  }
  check("确认档位白名单及真实组织角色均受执行期约束", (await call(read.token, "organization.get", {})).name === org.name);
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, global.row.id));
  await policies.replaceClientPolicies(admin, client!.id, [{ toolName: "organization.update", effect: "DENY" }]);
  await call(global.token, "organization.update", { ...confirmed, name: "策略越权" }, "FORBIDDEN");
  await policies.replaceClientPolicies(admin, client!.id, []);
  const renamed = `组织 ${marker}`;
  await call(global.token, "organization.update", { ...confirmed, name: renamed, defaultLocale: "en-US", defaultTimezone: "UTC" });
  check("组织更新可重新读取且遵循DENY策略", (await call(read.token, "organization.get", {})).name === renamed);
  await until(() => ordinaryEvents.some(event => event.data.domain === "organization" && event.data.resourceId === org.id));
  check("MCP组织更新通过真实SSE通知普通成员", adminEvents.some(event => event.data.domain === "organization"));
  const template = await call(low.token, "organization.getTemplate", { kind: "OPC", locale: "en-US" });
  check("组织模板可发现", template.departments.length > 0 && template.positions.length > 0);
  await call(global.token, "organization.applyTemplate", { ...confirmed, kind: "OPC" });

  const department = await call(global.token, "department.create", { ...confirmed, name: `部门 ${marker}` });
  const child = await call(global.token, "department.create", { ...confirmed, name: `子部门 ${marker}`, parentId: department.id });
  await call(global.token, "department.update", { ...confirmed, departmentId: child.id, name: "更名子部门", sortOrder: 7 });
  await call(global.token, "department.update", { ...confirmed, departmentId: department.id, parentId: child.id }, "VALIDATION");
  const position = await call(global.token, "position.create", { ...confirmed, name: `职位 ${marker}`, code: "MCP", departmentId: child.id, description: "测试职位" });
  await call(global.token, "position.update", { ...confirmed, positionId: position.id, name: "更名职位", sortOrder: 9 });
  await call(global.token, "member.assignOrganization", { ...confirmed, memberId: targetRow!.id, departmentId: child.id, positionId: position.id });
  const detail = await call(low.token, "member.get", { memberId: targetRow!.id });
  check("成员组织归属回读安全字段且不泄露密码", detail.departmentId === child.id && detail.positionId === position.id && !Object.hasOwn(detail, "passwordHash") && !Object.hasOwn(detail, "externalSubject"));
  check("部门及职位目录可回读成员计数", (await call(low.token, "department.list", {})).departments.some((row: { id: string; memberCount: number }) => row.id === child.id && row.memberCount === 1) && (await call(low.token, "position.list", {})).positions.some((row: { id: string; memberCount: number }) => row.id === position.id && row.memberCount === 1));

  const team = await call(global.token, "team.create", { ...confirmed, name: `团队 ${marker}` });
  const subteam = await call(global.token, "team.create", { ...confirmed, name: `子团队 ${marker}`, parentId: team.id });
  await call(global.token, "team.update", { ...confirmed, teamId: subteam.id, name: "更名子团队", sortOrder: 3 });
  const catalog = await call(read.token, "role.listPermissions", {});
  check("权限目录可发现已知权限", catalog.groups.some((group: { permissions: { key: string }[] }) => group.permissions.some(row => row.key === "project:update")));
  const custom = await call(global.token, "role.create", { ...confirmed, slug: `mcp-${marker.toLowerCase()}`, name: "MCP自定义角色", permissionKeys: ["project:update"] });
  await call(global.token, "role.update", { ...confirmed, roleId: custom.id, name: "MCP更新角色", permissionKeys: ["project:update", "work_item:create"] });
  check("角色增改可回读权限", (await call(read.token, "role.list", {})).roles.some((row: { id: string; permissionKeys: string[] }) => row.id === custom.id && row.permissionKeys.includes("work_item:create")));
  await call(global.token, "role.update", { ...confirmed, roleId: adminRole.id, name: "不可改内置角色" }, "FORBIDDEN");
  await until(() => adminEvents.some(event => event.data.domain === "role" && event.data.resourceId === custom.id));
  check("角色管理SSE按真实组织权限筛选受众", !ordinaryEvents.some(event => event.data.domain === "role"));
  const roleEvent = local.find(event => event.data.domain === "role" && event.data.resourceId === custom.id && event.memberId === adminRow!.id)!;
  check("角色历史事件不可交给其他成员或项目管理员", !await canDeliverEvent(ordinaryRow!.id, roleEvent) && !await canDeliverEvent(scopedAdminRow!.id, { ...roleEvent, memberId: scopedAdminRow!.id }));
  for (const scopeType of ["TEAM", "PROJECT", "DEPARTMENT"]) {
    const options = await call(read.token, "role.listScopes", { scopeType });
    check(`${scopeType}角色范围可发现`, options.scopeType === scopeType && options.scopes.length > 0);
  }
  await call(global.token, "role.createAssignment", { ...confirmed, memberId: targetRow!.id, roleId: custom.id, scopeType: "ORG", scopeId: team.id }, "VALIDATION");
  const assignment = await call(global.token, "role.createAssignment", { ...confirmed, memberId: targetRow!.id, roleId: custom.id, scopeType: "TEAM", scopeId: subteam.id });
  check("团队树与子团队成员可回读", (await call(low.token, "team.list", {})).teams.some((row: { id: string; children: { id: string }[] }) => row.id === team.id && row.children.some(c => c.id === subteam.id)) && (await call(low.token, "team.members", { teamId: team.id })).members.some((row: { id: string }) => row.id === targetRow!.id));
  const permissions = await call(read.token, "member.getPermissions", { memberId: targetRow!.id });
  check("管理员可读取目标权限与作用域", permissions.assignments.some((row: { id: string; scopeId: string }) => row.id === assignment.id && row.scopeId === subteam.id));
  await call(low.token, "member.getPermissions", { memberId: targetRow!.id }, "FORBIDDEN");
  check("成员可以读取自己的权限", (await call(low.token, "member.getPermissions", { memberId: ordinaryRow!.id })).member.id === ordinaryRow!.id);
  await call(global.token, "role.updateAssignment", { ...confirmed, assignmentId: assignment.id, roleId: custom.id, scopeType: "DEPARTMENT", scopeId: child.id });
  check("角色指派更新可回读", (await call(read.token, "role.listAssignments", { memberId: targetRow!.id })).assignments.some((row: { id: string; scopeId: string }) => row.id === assignment.id && row.scopeId === child.id));
  await call(global.token, "role.deleteAssignment", { ...confirmed, assignmentId: assignment.id });
  await call(global.token, "role.delete", { ...confirmed, roleId: custom.id });
  check("角色及指派删除可回读", !(await call(read.token, "role.list", {})).roles.some((row: { id: string }) => row.id === custom.id) && !(await call(read.token, "role.listAssignments", { memberId: targetRow!.id })).assignments.some((row: { id: string }) => row.id === assignment.id));
  await call(global.token, "team.delete", { ...confirmed, teamId: subteam.id });
  await call(global.token, "team.delete", { ...confirmed, teamId: team.id });
  await call(global.token, "position.archive", { ...confirmed, positionId: position.id });
  await call(global.token, "department.archive", { ...confirmed, departmentId: child.id });
  await call(global.token, "department.archive", { ...confirmed, departmentId: department.id });
  const detached = await call(read.token, "member.get", { memberId: targetRow!.id });
  check("归档职位部门清除成员归属且团队被删除", detached.departmentId === null && detached.positionId === null && !(await call(read.token, "team.list", {})).teams.some((row: { id: string }) => row.id === team.id));

  const targetActor = (await loadActor(targetRow!.id))!;
  const targetToken = await tokens.createToken(targetActor, { name: "生命周期待撤销", tier: "READ_ONLY", projectWhitelist: [] });
  await call(global.token, "member.disable", { ...confirmed, memberId: targetRow!.id });
  const [revoked] = await db.select().from(apiToken).where(eq(apiToken.id, targetToken.row.id));
  check("禁用成员并撤销已有令牌", (await call(read.token, "member.get", { memberId: targetRow!.id })).status === "DISABLED" && revoked!.revokedAt !== null);
  await call(global.token, "member.enable", { ...confirmed, memberId: targetRow!.id });
  check("启用成员可回读", (await call(read.token, "member.get", { memberId: targetRow!.id })).status === "ACTIVE");
  await call(global.token, "member.anonymize", { ...confirmed, memberId: targetRow!.id });
  const anonymous = await call(read.token, "member.get", { memberId: targetRow!.id });
  const remainingAssignments = await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, targetRow!.id));
  check("匿名化清除身份信息和角色指派", anonymous.status === "ANONYMIZED" && anonymous.email === null && anonymous.username.startsWith("deleted-") && remainingAssignments.length === 0);
  await call(read.token, "role.listAssignments", { memberId: targetRow!.id }, "FORBIDDEN");
  await call(global.token, "member.enable", { ...confirmed, memberId: targetRow!.id }, "CONFLICT");
  const audits = await db.select({ action: auditEntry.action }).from(auditEntry).where(and(eq(auditEntry.actorId, adminRow!.id), eq(auditEntry.targetId, targetRow!.id)));
  check("生命周期写入真实操作者安全审计", ["member.disabled", "member.enabled", "member.anonymized"].every(action => audits.some(row => row.action === action)));
  await until(() => ordinaryEvents.some(event => event.data.domain === "directory" && event.data.resourceId === targetRow!.id));
  check("组织目录SSE载荷只有资源定位且不含姓名邮件", ordinaryEvents.filter(event => event.event === "workspace.invalidated").every(event => Object.keys(event.data).sort().join(",") === "domain,projectId,resourceId,resourceType"));
  const beforeRollback = local.length;
  await assert.rejects(db.transaction(async () => {
    await structure.createDepartment(admin, { name: `回滚部门 ${marker}` });
    await members.manageMemberLifecycle(admin, ordinaryRow!.id, "disabled");
    assert.equal(local.length, beforeRollback);
    throw new Error("organization rollback fixture");
  }), /organization rollback fixture/u);
  check("组织与成员服务外层回滚不投递事件也不保留状态", local.length === beforeRollback && (await call(read.token, "member.get", { memberId: ordinaryRow!.id })).status === "ACTIVE");
  console.log(`组织 MCP 真实 HTTP 闭环通过 ${checks} 项检查`);
} finally {
  for (const stream of streams) stream.abort.abort();
  await Promise.all(streams.map(stream => stream.done));
  unsubscribe();
  await app.close();
  await sql.end({ timeout: 5 });
}
