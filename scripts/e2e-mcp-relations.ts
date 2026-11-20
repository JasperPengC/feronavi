import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { buildApp } from "../src/server/app.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as membership from "../src/server/services/project-member.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as relations from "../src/server/services/relation.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
const [admin, scoped] = await db.insert(member).values([
  { username: "relation-admin", email: "ra@test.invalid", name: "Admin", passwordHash: "test", status: "ACTIVE" },
  { username: "relation-scoped", email: "rs@test.invalid", name: "Scoped", passwordHash: "test", status: "ACTIVE" },
]).returning();
await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG" });
const actor = (await loadActor(admin!.id))!;
const p = await projects.createProject(actor, { key: "RELONE", name: "关联测试" });
const p2 = await projects.createProject(actor, { key: "RELTWO", name: "不可见项目" });
await membership.addProjectMember(actor, p.id, { memberId: scoped!.id, roleIds: [adminRole!.id] });
const scopedActor = (await loadActor(scoped!.id))!;
const bearer = (await tokens.createToken(scopedActor, { name: "relations", tier: "READ_WRITE" })).token;
const a = await items.createWorkItem(actor, p.id, { type: "TASK", title: "a" });
const b = await items.createWorkItem(actor, p.id, { type: "TASK", title: "b" });
const hidden = await items.createWorkItem(actor, p2.id, { type: "TASK", title: "hidden" });
const app = await buildApp({ logger: false });
let calls = 0;
async function call(name: string, raw: Record<string, unknown>, token = bearer) {
  const args = confirmedTestArgs(name, raw);
  const response = await app.inject({ method: "POST", url: "/api/v1/mcp", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, payload: { jsonrpc: "2.0", id: ++calls, method: "tools/call", params: { name, arguments: args } } });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.json().result.content[0].text);
}
try {
  for (const type of ["BLOCKED_BY", "BLOCKS", "RELATES_TO"]) {
    const denied = await call("workitem.link", { fromWorkItemId: a.id, toWorkItemId: hidden.id, type });
    assert.equal(denied.code, "FORBIDDEN", `${type}必须验证另一端项目可见性`);
  }
  console.log("OK 正反向关系均拒绝不可见目标");
  const args = { fromWorkItemId: a.id, toWorkItemId: b.id, type: "BLOCKED_BY" };
  const first = await call("workitem.link", args);
  assert.ok(first.id);
  assert.equal((await call("workitem.link", args)).id, first.id, "重复关系天然幂等");
  assert.equal((await call("workitem.link", { fromWorkItemId: b.id, toWorkItemId: a.id, type: "BLOCKS" })).id, first.id);
  assert.equal((await call("workitem.link", { fromWorkItemId: a.id, toWorkItemId: b.id, type: "BLOCKS" })).code, "VALIDATION", "环被拒绝");
  assert.equal((await call("workitem.link", { ...args, type: "CAUSES" })).code, "VALIDATION", "未实现关系类型不得宣称支持");
  const list = await call("workitem.relations", { workItemId: a.id });
  assert.equal(list.blockedBy.length, 1);
  const crossProject = await relations.addRelation(actor, a.id, { targetId: hidden.id, type: "RELATES_TO" });
  const scopedView = await call("workitem.relations", { workItemId: a.id });
  assert.ok(!scopedView.others.some((row: { id: string }) => row.id === crossProject.id), "已撤销另一端可见性后不返回对方标题");
  const restricted = (await tokens.createToken(actor, { name: "relations-project-only", tier: "READ_ONLY", projectWhitelist: [p.id] })).token;
  const restrictedView = await call("workitem.relations", { workItemId: a.id }, restricted);
  assert.ok(!restrictedView.others.some((row: { id: string }) => row.id === crossProject.id), "项目令牌不能经关系列表读出外部标题");
  console.log(`OK 关系归一、重复重放、依赖环与schema；HTTP ${calls}次`);
} finally { await app.close(); await sql.end(); }
