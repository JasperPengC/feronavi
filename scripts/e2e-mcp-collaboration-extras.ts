import "./_env.ts";
/** 工作项协作、通用评论和附件的真实 HTTP MCP 验收。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, mcpClient } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as ideas from "../src/server/services/idea.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const app = await buildApp({ logger: false });
const marker = randomUUID().replaceAll("-", "").slice(0, 10);
let id = 0, checks = 0;
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.error, undefined); return body.result;
}
async function call(token: string, name: string, args: object, error?: string) {
  const response = await rpc(token, "tools/call", { name, arguments: args });
  const data = JSON.parse(response.content[0].text);
  if (error) { assert.equal(response.isError, true); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(response.structuredContent, data); }
  return data;
}
const check = (name: string, ok: unknown) => { assert.ok(ok, name); checks++; console.log(`OK ${name}`); };
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: `content-${marker}`, name: "内容验收", email: `${marker}@content.test`, status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(person!.id))!;
  const inside = await projects.createProject(actor, { key: `CI${marker}`, name: "内容闭环" });
  const outside = await projects.createProject(actor, { key: `CO${marker}`, name: "范围外" });
  const rw = await tokens.createToken(actor, { name: "内容读写", tier: "READ_WRITE", projectWhitelist: [inside.id] });
  const ro = await tokens.createToken(actor, { name: "内容只读", tier: "READ_ONLY", projectWhitelist: [inside.id] });
  const required = ["workitem.delete", "workitem.listProgress", "workitem.addProgress", "workitem.deleteProgress", "workitem.listTransfers", "workitem.transfer", "workitem.listCollaborators", "workitem.addCollaborator", "workitem.removeCollaborator", "workitem.listWatchers", "workitem.follow", "workitem.unfollow", "comment.list", "comment.create", "project.archive", "project.unarchive"];
  const names = (await rpc(rw.token, "tools/list")).tools.map((t: { name: string }) => t.name);
  check("目录覆盖协作与生命周期入口", required.every(name => names.includes(name)));
  const item = await items.createWorkItem(actor, inside.id, { type: "TASK", title: "协作流程验收" });
  const itemScope = { projectId: inside.id, workItemId: item.id };
  const confirmed = { ...itemScope, userConfirmed: true };
  const foreign = await items.createWorkItem(actor, outside.id, { type: "TASK", title: "范围外任务" });
  await call(rw.token, "workitem.follow", { ...confirmed, channels: ["IN_APP"] });
  await call(rw.token, "workitem.follow", { ...confirmed, channels: ["IN_APP"] });
  check("重复关注幂等且读回本人", (await call(ro.token, "workitem.listWatchers", itemScope)).watchers.filter((r: { memberId: string }) => r.memberId === person!.id).length === 1);
  await call(rw.token, "workitem.unfollow", confirmed);
  check("取消关注持久化", (await call(ro.token, "workitem.listWatchers", itemScope)).watchers.length === 0);
  const [other] = await db.insert(member).values({ username: `collab-${marker}`, name: "协作成员", email: `${marker}@collab.test`, status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  await call(rw.token, "workitem.addCollaborator", { ...confirmed, memberId: other!.id });
  check("协作者写后可读", (await call(ro.token, "workitem.listCollaborators", itemScope)).collaborators.some((r: { memberId: string }) => r.memberId === other!.id));
  await call(rw.token, "workitem.removeCollaborator", { ...confirmed, memberId: other!.id });
  check("移除协作者持久化", (await call(ro.token, "workitem.listCollaborators", itemScope)).collaborators.length === 0);
  const note = await call(rw.token, "workitem.addProgress", { ...confirmed, summary: "修复完成", nextSteps: "多人复验", blockers: "无" });
  check("结构化进展三字段保存", (await call(ro.token, "workitem.listProgress", itemScope)).updates.some((r: { id: string; nextSteps: string; blockers: string }) => r.id === note.id && r.nextSteps === "多人复验" && r.blockers === "无"));
  await call(rw.token, "workitem.deleteProgress", { ...confirmed, progressUpdateId: note.id });
  check("进展删除复读", (await call(ro.token, "workitem.listProgress", itemScope)).updates.length === 0);
  const current = await items.getWorkItem(actor, item.id);
  await call(rw.token, "workitem.transfer", { ...confirmed, assigneeId: person!.id, version: current.version, reason: "统一负责人" });
  check("转派原因和最终负责人可复读", (await call(ro.token, "workitem.listTransfers", itemScope)).transfers.some((r: { reason: string; toAssigneeId: string }) => r.reason === "统一负责人" && r.toAssigneeId === person!.id));
  const page = await wiki.createPage(actor, inside.id, { title: "附属内容页" });
  const milestone = (await plans.createPlan(actor, inside.id, "milestone", { name: "附属里程碑" }))!;
  const idea = await ideas.createIdea(actor, inside.id, { title: "附件想法" });
  const targetCases = [["PAGE", page.id], ["MILESTONE", milestone.id], ["WORK_ITEM", item.id]] as const;
  let commentId = "";
  for (const [targetType, targetId] of targetCases) {
    const scope = { projectId: inside.id, targetType, targetId };
    const comment = await call(rw.token, "comment.create", { ...scope, body: `${targetType} 协作讨论`, userConfirmed: true });
    const reply = await call(rw.token, "comment.create", { ...scope, parentId: comment.id, body: "确认回复", userConfirmed: true });
    check(`${targetType}评论与回复可读`, (await call(ro.token, "comment.list", scope)).comments.some((r: { id: string }) => r.id === comment.id) && (await call(ro.token, "comment.list", { ...scope, parentId: comment.id })).comments.some((r: { id: string }) => r.id === reply.id));
    commentId = comment.id;
  }
  for (const [targetType, targetId] of [...targetCases, ["IDEA", idea!.id], ["COMMENT", commentId]]) {
    const scope = { projectId: inside.id, targetType, targetId };
    const bytes = Buffer.from(`${targetType} 附件真实字节`);
    const file = await call(rw.token, "attachment.upload", { ...scope, originalName: "验收.txt", mimeType: "text/plain", dataBase64: bytes.toString("base64"), userConfirmed: true });
    const listing = await call(ro.token, "attachment.list", scope);
    const fetched = await call(ro.token, "attachment.download", { ...scope, attachmentId: file.id });
    check(`${targetType}附件上传列表下载闭环`, listing.attachments.some((r: { id: string }) => r.id === file.id) && !JSON.stringify(listing).includes("storageKey") && Buffer.from(fetched.dataBase64, "base64").equals(bytes));
    await call(rw.token, "attachment.delete", { ...scope, attachmentId: file.id, userConfirmed: true });
    check(`${targetType}附件删除闭环`, (await call(ro.token, "attachment.list", scope)).attachments.length === 0);
  }
  const writes: [string, Record<string, unknown>][] = [
    ["workitem.delete", confirmed], ["workitem.addProgress", { ...confirmed, summary: "禁止写入" }],
    ["workitem.deleteProgress", { ...confirmed, progressUpdateId: note.id }],
    ["workitem.transfer", { ...confirmed, assigneeId: null, version: 2 }],
    ["workitem.addCollaborator", { ...confirmed, memberId: other!.id }], ["workitem.removeCollaborator", { ...confirmed, memberId: other!.id }],
    ["workitem.follow", confirmed], ["workitem.unfollow", confirmed],
    ["comment.create", { projectId: inside.id, targetType: "PAGE", targetId: page.id, body: "禁止评论", userConfirmed: true }],
    ["project.archive", { projectId: inside.id, userConfirmed: true }], ["project.unarchive", { projectId: inside.id, userConfirmed: true }],
  ];
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, rw.row.id));
  for (const [name, args] of writes) {
    await call(ro.token, name, args, "FORBIDDEN");
    await call(rw.token, name, { ...args, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    const { userConfirmed: _c, ...missing } = args;
    await call(rw.token, name, missing, "VALIDATION");
    await call(rw.token, name, { ...args, projectId: outside.id }, "NOT_FOUND");
    await policies.replaceClientPolicies(actor, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(rw.token, name, args, "FORBIDDEN");
    await policies.replaceClientPolicies(actor, client!.id, []);
  }
  check("全部新增写入口拒绝只读未确认范围外和DENY", true);
  await call(rw.token, "workitem.delete", { ...confirmed, workItemId: foreign.id }, "NOT_FOUND");
  await call(rw.token, "attachment.list", { projectId: inside.id, targetType: "WORK_ITEM", targetId: foreign.id }, "NOT_FOUND");
  await call(rw.token, "attachment.list", { ...itemScope, targetType: "WORK_ITEM", targetId: item.id }, "VALIDATION");
  check("实际归属与附件目标歧义被拒绝", !!(await items.getWorkItem(actor, foreign.id)));
  await call(rw.token, "workitem.delete", confirmed);
  check("工作项软删除后列表消失", !(await call(ro.token, "workitem.list", { projectId: inside.id })).items.some((r: { id: string }) => r.id === item.id));
  await call(rw.token, "project.archive", { projectId: inside.id, userConfirmed: true });
  check("项目归档复读", !!(await call(ro.token, "project.get", { projectId: inside.id })).archivedAt);
  await call(rw.token, "project.unarchive", { projectId: inside.id, userConfirmed: true });
  check("项目恢复归档复读", !(await call(ro.token, "project.get", { projectId: inside.id })).archivedAt);
  console.log(`MCP协作附属闭环 ${checks}/${checks}`);
} finally { await app.close(); await sql.end({ timeout: 5 }); }
