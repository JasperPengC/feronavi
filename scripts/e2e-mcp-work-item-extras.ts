import "./_env.ts";
/** 隔离 PostgreSQL + 真实 HTTP：工作项附属资源写后回读与权限反控。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, rolePermission, projectMembership, mcpClient } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import * as relations from "../src/server/services/relation.service.ts";
import * as fields from "../src/server/services/custom-field.service.ts";
import * as times from "../src/server/services/prefs-time.service.ts";
import * as attachments from "../src/server/services/attachment.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as comments from "../src/server/services/comment.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const required = ["workitem.listRelations", "workitem.removeRelation", "workitem.listTimeLogs", "workitem.addTimeLog",
  "workitem.updateTimeLog", "workitem.deleteTimeLog", "workitem.getFieldValues", "workitem.setFieldValues",
  "attachment.list", "attachment.upload", "attachment.download", "attachment.delete",
  "customField.list", "customField.create", "customField.update", "customField.archive"];
const marker = randomUUID().replaceAll("-", "").slice(0, 10);
let checks = 0;
const check = (name: string, condition: unknown) => { assert.ok(condition, name); checks++; console.log(`OK ${name}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
let rpcId = 0;
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
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

try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [adminRow] = await db.insert(member).values({ username: `mcp-extras-${marker}`, email: `${marker}@extras.test`, name: "MCP 附属资源验收", status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const inside = await projects.createProject(admin, { key: `EA${marker}`, name: "附属资源允许项目" });
  const outside = await projects.createProject(admin, { key: `EB${marker}`, name: "附属资源禁止项目" });
  const rw = await tokens.createToken(admin, { name: "附属资源读写", tier: "READ_WRITE", projectWhitelist: [inside.id] });
  const ro = await tokens.createToken(admin, { name: "附属资源只读", tier: "READ_ONLY", projectWhitelist: [inside.id] });
  const unrestricted = await tokens.createToken(admin, { name: "附属资源全项目", tier: "READ_WRITE" });
  const listed = await rpc(rw.token, "tools/list");
  check("16 个附属资源工具全部公开并声明严格输入输出契约", required.every(name => listed.tools.some((tool: { name: string; inputSchema: { additionalProperties: boolean }; outputSchema?: { additionalProperties: boolean } }) => tool.name === name && tool.inputSchema.additionalProperties === false && tool.outputSchema?.additionalProperties === false)));

  const task = await items.createWorkItem(admin, inside.id, { type: "TASK", title: "附属资源工作项" });
  const other = await items.createWorkItem(admin, inside.id, { type: "TASK", title: "同项目其它工作项" });
  const external = await items.createWorkItem(admin, outside.id, { type: "TASK", title: "不应泄露标题" });
  const scope = { projectId: inside.id, workItemId: task.id };
  const externalScope = { projectId: outside.id, workItemId: external.id };
  const confirmed = { ...scope, userConfirmed: true };
  const relation = await relations.addRelation(admin, task.id, { targetId: other.id, type: "RELATES_TO" });
  const crossRelation = await relations.addRelation(admin, task.id, { targetId: external.id, type: "BLOCKS" });
  const visibleRelations = await call(ro.token, "workitem.listRelations", scope);
  check("关联列表返回可见对端并过滤令牌范围外的标题和标识", visibleRelations.others.length === 1 && visibleRelations.others[0].workItemId === other.id && visibleRelations.blocks.length === 0 && !JSON.stringify(visibleRelations).includes(external.id));
  await call(rw.token, "workitem.removeRelation", { ...confirmed, relationId: crossRelation!.id }, "NOT_FOUND");
  await call(rw.token, "workitem.removeRelation", { ...confirmed, relationId: relation!.id, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await call(ro.token, "workitem.removeRelation", { ...confirmed, relationId: relation!.id }, "FORBIDDEN");
  await call(rw.token, "workitem.removeRelation", { ...confirmed, relationId: relation!.id });
  check("关联删除后列表回读为空", (await call(ro.token, "workitem.listRelations", scope)).others.length === 0);

  const timeLog = await call(rw.token, "workitem.addTimeLog", { ...confirmed, minutes: 30, loggedDate: "2026-11-19", note: "首次记录" });
  check("工时新增后列表回读", (await call(ro.token, "workitem.listTimeLogs", scope)).timeLogs.some((row: { id: string; minutes: number }) => row.id === timeLog.id && row.minutes === 30));
  const updatedTime = await call(rw.token, "workitem.updateTimeLog", { ...confirmed, timeLogId: timeLog.id, minutes: 45, note: null });
  check("工时更新返回实际记录并回读", updatedTime.minutes === 45 && updatedTime.note === null && (await call(ro.token, "workitem.listTimeLogs", scope)).timeLogs[0].minutes === 45);
  await call(rw.token, "workitem.updateTimeLog", { ...confirmed, timeLogId: timeLog.id }, "VALIDATION");
  await call(rw.token, "workitem.addTimeLog", { ...confirmed, minutes: 1, loggedDate: "2026-02-30" }, "VALIDATION");
  await call(rw.token, "workitem.deleteTimeLog", { ...confirmed, workItemId: other.id, timeLogId: timeLog.id }, "NOT_FOUND");

  const fileContent = "MCP 附件往返\n";
  const fileInput = { ...confirmed, originalName: "roundtrip.txt", mimeType: "text/plain", dataBase64: Buffer.from(fileContent).toString("base64") };
  const file = await call(rw.token, "attachment.upload", fileInput);
  const fileList = await call(ro.token, "attachment.list", scope);
  const downloaded = await call(ro.token, "attachment.download", { ...scope, attachmentId: file.id });
  check("附件上传、列表和下载字节一致且不暴露存储信息", fileList.attachments.length === 1 && fileList.attachments[0].id === file.id && Buffer.from(downloaded.dataBase64, "base64").toString() === fileContent && !/storagePath|storageKey|storageBackend/.test(JSON.stringify({ file, fileList, downloaded })));
  await call(rw.token, "attachment.upload", { ...fileInput, dataBase64: "AAAA!!!" }, "VALIDATION");
  await call(rw.token, "attachment.upload", { ...fileInput, originalName: "../../secret.txt" }, "VALIDATION");
  await call(rw.token, "attachment.upload", { ...fileInput, sourceUrl: "http://127.0.0.1/private" }, "VALIDATION");
  await call(rw.token, "attachment.upload", { ...fileInput, dataBase64: Buffer.alloc(512 * 1024 + 1).toString("base64") }, "VALIDATION");
  await call(ro.token, "attachment.download", { ...scope, workItemId: other.id, attachmentId: file.id }, "NOT_FOUND");
  check("附件拒绝非法 base64、路径、URL、超长文件及错误目标", true);

  const field = await call(rw.token, "customField.create", { projectId: inside.id, userConfirmed: true, key: "extra_text", name: "业务字段", type: "TEXT" });
  check("字段定义创建后列表回读", (await call(ro.token, "customField.list", { projectId: inside.id })).fields.some((row: { id: string }) => row.id === field.id));
  await call(rw.token, "customField.update", { projectId: inside.id, fieldId: field.id, userConfirmed: true, name: "已改名字段", sortOrder: 3 });
  await call(rw.token, "workitem.setFieldValues", { ...confirmed, values: { [field.id]: "保存后的值" } });
  const readValues = await call(ro.token, "workitem.getFieldValues", scope);
  check("字段定义更新和值写入通过读取确认", readValues.fields.some((row: { defId: string; name: string; value: string }) => row.defId === field.id && row.name === "已改名字段" && row.value === "保存后的值"));
  await call(rw.token, "customField.update", { projectId: inside.id, fieldId: field.id, userConfirmed: true, options: [{ value: "x", label: "非法选项" }] }, "VALIDATION");
  await call(rw.token, "workitem.setFieldValues", { ...confirmed, values: { [field.id]: 12 } }, "VALIDATION");
  await call(rw.token, "customField.update", { projectId: inside.id, fieldId: field.id, userConfirmed: true }, "VALIDATION");

  const externalTime = await times.addTimeLog(admin, external.id, { minutes: 5, loggedDate: "2026-11-19" });
  const externalField = await fields.createDef(admin, outside.id, { key: "external_field", name: "外部字段", type: "TEXT" });
  const externalFile = await attachments.upload(admin, { targetType: "WORK_ITEM", targetId: external.id, originalName: "external.txt", mimeType: "text/plain", sizeBytes: 1, data: Buffer.from("x") });
  const operations: [string, Record<string, unknown>][] = [
    ["workitem.removeRelation", { ...confirmed, relationId: crossRelation!.id }],
    ["workitem.addTimeLog", { ...confirmed, minutes: 10, loggedDate: "2026-11-19" }],
    ["workitem.updateTimeLog", { ...confirmed, timeLogId: timeLog.id, minutes: 10 }],
    ["workitem.deleteTimeLog", { ...confirmed, timeLogId: timeLog.id }],
    ["attachment.upload", fileInput], ["attachment.delete", { ...confirmed, attachmentId: file.id }],
    ["customField.create", { projectId: inside.id, userConfirmed: true, key: "blocked_field", name: "禁止字段", type: "TEXT" }],
    ["customField.update", { projectId: inside.id, userConfirmed: true, fieldId: field.id, name: "禁止改名" }],
    ["customField.archive", { projectId: inside.id, userConfirmed: true, fieldId: field.id }],
    ["workitem.setFieldValues", { ...confirmed, values: { [field.id]: "禁止赋值" } }],
  ];
  for (const [name, args] of operations) {
    await call(ro.token, name, args, "FORBIDDEN");
    await call(rw.token, name, { ...args, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    const { userConfirmed: _confirmed, ...withoutConfirmation } = args;
    await call(rw.token, name, withoutConfirmation, "VALIDATION");
    await call(rw.token, name, { ...args, projectId: outside.id, ...("workItemId" in args ? { workItemId: external.id } : {}) }, "NOT_FOUND");
  }
  check("全部10种写工具拒绝只读、未确认、缺少确认和跨项目", true);
  for (const name of ["workitem.listRelations", "workitem.listTimeLogs", "workitem.getFieldValues", "attachment.list"]) {
    await call(rw.token, name, externalScope, "NOT_FOUND");
    await call(unrestricted.token, name, { ...scope, workItemId: external.id }, "NOT_FOUND");
  }
  await call(rw.token, "workitem.updateTimeLog", { ...confirmed, timeLogId: externalTime!.id, minutes: 60 }, "NOT_FOUND");
  await call(rw.token, "attachment.download", { ...scope, attachmentId: externalFile!.id }, "NOT_FOUND");
  await call(unrestricted.token, "customField.update", { projectId: inside.id, fieldId: externalField!.id, name: "伪造项目", userConfirmed: true }, "NOT_FOUND");
  await call(rw.token, "workitem.setFieldValues", { ...confirmed, values: { [externalField!.id]: "伪造字段" } }, "VALIDATION");
  check("跨项目及同项目错误资源组合均拒绝且全项目令牌仍核验实际归属", true);

  await call(rw.token, "ping", {});
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, rw.row.id));
  for (const [name, args] of operations) {
    await policies.replaceClientPolicies(admin, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(rw.token, name, args, "FORBIDDEN");
  }
  for (const [name, args] of [["workitem.listRelations", scope], ["workitem.listTimeLogs", scope], ["workitem.getFieldValues", scope], ["attachment.list", scope], ["attachment.download", { ...scope, attachmentId: file.id }], ["customField.list", { projectId: inside.id }]] as [string, Record<string, unknown>][]) {
    await policies.replaceClientPolicies(admin, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(rw.token, name, args, "FORBIDDEN");
  }
  await policies.replaceClientPolicies(admin, client!.id, []);
  check("全部16种工具遵守逐工具 DENY 策略", true);

  const [limitedRole] = await db.insert(role).values({ key: `custom:extras_${marker}`, name: "附属资源只可见" }).returning();
  await db.insert(rolePermission).values({ roleId: limitedRole!.id, permissionKey: "apikey:manage_own" });
  const [limitedMember] = await db.insert(member).values({ username: `extras-limited-${marker}`, email: `limited-${marker}@extras.test`, name: "只有可见权限", status: "ACTIVE", passwordHash: await hashPassword(`limited-${marker}-password`) }).returning();
  const [temporaryGrant] = await db.insert(roleAssignment).values({ memberId: limitedMember!.id, roleId: limitedRole!.id, scopeType: "ORG", scopeId: null }).returning();
  const limitedToken = await tokens.createToken((await loadActor(limitedMember!.id))!, { name: "权限反控", tier: "READ_WRITE" });
  await db.delete(roleAssignment).where(eq(roleAssignment.id, temporaryGrant!.id));
  await db.insert(roleAssignment).values({ memberId: limitedMember!.id, roleId: limitedRole!.id, scopeType: "PROJECT", scopeId: inside.id });
  await db.insert(projectMembership).values({ memberId: limitedMember!.id, roleId: limitedRole!.id, projectId: inside.id });
  const protectedRelation = await relations.addRelation(admin, task.id, { targetId: other.id, type: "RELATES_TO" });
  const accountRelations = await call(limitedToken.token, "workitem.listRelations", scope);
  check("无项目白名单令牌仍按账号权限过滤跨项目关联", accountRelations.others.length === 1 && accountRelations.blocks.length === 0);
  for (const [name, args] of operations.filter(([name]) => !["workitem.addTimeLog", "workitem.removeRelation"].includes(name))) {
    await call(limitedToken.token, name, args, "FORBIDDEN");
  }
  await call(limitedToken.token, "workitem.removeRelation", { ...confirmed, relationId: protectedRelation!.id }, "FORBIDDEN");
  check("原业务权限阻止越权关联、工时、附件和自定义字段写入", true);
  await call(rw.token, "workitem.removeRelation", { ...confirmed, workItemId: other.id, relationId: protectedRelation!.id });
  check("关系可从真实对端删除并回读", (await call(ro.token, "workitem.listRelations", scope)).others.length === 0);

  await call(rw.token, "customField.archive", { projectId: inside.id, fieldId: field.id, userConfirmed: true });
  const archivedValues = await call(ro.token, "workitem.getFieldValues", scope);
  check("字段归档保留历史值并从活动定义排除", archivedValues.fields.some((row: { defId: string; archived: boolean; value: string }) => row.defId === field.id && row.archived && row.value === "保存后的值") && !(await call(ro.token, "customField.list", { projectId: inside.id })).fields.some((row: { id: string }) => row.id === field.id));
  await call(rw.token, "workitem.setFieldValues", { ...confirmed, values: { [field.id]: "归档不可写" } }, "VALIDATION");
  await call(rw.token, "workitem.deleteTimeLog", { ...confirmed, timeLogId: timeLog.id });
  await call(rw.token, "attachment.delete", { ...confirmed, attachmentId: file.id });
  check("工时与附件删除后读取为空且外部资源保持原状", (await call(ro.token, "workitem.listTimeLogs", scope)).timeLogs.length === 0 && (await call(ro.token, "attachment.list", scope)).attachments.length === 0 && (await times.listTimeLogs(admin, external.id))[0]!.minutes === 5 && (await fields.listDefs(admin, outside.id))[0]!.name === "外部字段");

  const milestone = (await plans.createPlan(admin, inside.id, "milestone", { name: "里程碑评论协作" }))!;
  const outsideMilestone = (await plans.createPlan(admin, outside.id, "milestone", { name: "外部里程碑" }))!;
  const milestoneComment = (await comments.createComment(admin, { targetType: "MILESTONE", targetId: milestone.id, body: "里程碑初始评论" }))!;
  const outsideComment = (await comments.createComment(admin, { targetType: "MILESTONE", targetId: outsideMilestone.id, body: "外部评论" }))!;
  await call(rw.token, "comment.update", { commentId: milestoneComment.id, body: "直接工具已更新", userConfirmed: true });
  const inspected = await call(ro.token, "collab.inspect", { resourceType: "COMMENT", resourceId: milestoneComment.id });
  check("里程碑评论可通过项目令牌读取协作房间", inspected.projectId === inside.id);
  const commentCommand = { resourceType: "COMMENT", resourceId: milestoneComment.id, action: "comment.update", input: { body: "协作命令已更新" }, userConfirmed: true };
  await call(rw.token, "collab.command", commentCommand);
  check("里程碑评论协作命令更新后可回读", (await comments.listComments(admin, "MILESTONE", milestone.id))[0]!.body === "协作命令已更新");
  await call(ro.token, "collab.command", commentCommand, "FORBIDDEN");
  await call(rw.token, "collab.command", { ...commentCommand, resourceId: outsideComment.id }, "NOT_FOUND");
  await call(rw.token, "collab.command", { ...commentCommand, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await policies.replaceClientPolicies(admin, client!.id, [{ toolName: "comment.update", effect: "DENY" }]);
  await call(rw.token, "collab.command", commentCommand, "FORBIDDEN");
  await policies.replaceClientPolicies(admin, client!.id, []);
  check("里程碑评论协作保持只读、项目、确认及子工具DENY守卫", true);
  console.log(`通过 ${checks}/${checks} 项工作项附属资源 MCP 验收`);
} finally {
  await app.close();
  await sql.end();
}
