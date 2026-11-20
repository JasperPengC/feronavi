import "./_env.ts";
/** 工作项协作、通用评论和附件的真实 HTTP MCP 验收。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql, inTransaction } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const app = await buildApp({ logger: false });
const marker = randomUUID().replaceAll("-", "").slice(0, 10);
let checks = 0;
const check = (name: string, ok: unknown) => { assert.ok(ok, name); checks++; console.log(`OK ${name}`); };
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: `content-${marker}`, name: "内容验收", email: `${marker}@content.test`, status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(person!.id))!;
  const inside = await projects.createProject(actor, { key: `CI${marker}`, name: "内容闭环" });
  const target = await wiki.createPage(actor, inside.id, { title: "ACL并发替换", visibility: "RESTRICTED" });
  const [second] = await db.insert(member).values({ username: `acl-${marker}`, name: "新授权成员", email: `${marker}@acl.test`, status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  const permission = (id: string) => [{ principalType: "MEMBER" as const, principalId: id, canRead: true, canWrite: false }];
  await wiki.setPermissions(actor, target.id, permission(person!.id));
  let releaseFirst!: () => void, firstReady!: () => void;
  const held = new Promise<void>(resolve => { releaseFirst = resolve; });
  const ready = new Promise<void>(resolve => { firstReady = resolve; });
  const first = inTransaction(async () => { await wiki.setPermissions(actor, target.id, permission(person!.id)); firstReady(); await held; });
  await ready;
  let secondError: unknown;
  const label = `acl-race-${marker}`;
  const pending = inTransaction(async () => {
    await sql`select set_config('application_name', ${label}, true)`;
    return wiki.setPermissions(actor, target.id, permission(second!.id));
  }).catch(error => { secondError = error; });
  try {
    const deadline = Date.now() + 10_000;
    let blocked = false;
    while (Date.now() < deadline && !secondError) {
      const [state] = await sql<{ waiting: boolean }[]>`select wait_event_type = 'Lock' as waiting from pg_stat_activity where application_name = ${label}`;
      if (state?.waiting) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(blocked, "第二个授权替换必须实际发生锁竞争");
  } finally { releaseFirst(); await first; await pending; }
  if (secondError) throw secondError;
  const permissions = await wiki.listPermissions(actor, target.id);
  assert.deepEqual(permissions.map(row => row.principalId), [second!.id], "后提交ACL替换必须覆盖完整集合，不能变成并发授权并集");
  check("并发ACL替换保持完整替换语义", true);
  const before = permissions.map(row => row.principalId);
  await assert.rejects(inTransaction(async () => { await wiki.setPermissions(actor, target.id, permission(person!.id)); throw new Error("rollback-acl"); }));
  assert.deepEqual((await wiki.listPermissions(actor, target.id)).map(row => row.principalId), before);
  check("ACL外层回滚保留原授权", true);
  console.log(`MCP权限竞态 ${checks}/${checks}`);
} finally { await app.close(); await sql.end({ timeout: 5 }); }
