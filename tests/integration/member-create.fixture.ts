import assert from "node:assert/strict";
import Fastify from "fastify";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, auditEntry } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createMember } = await import("../../src/server/services/invite.service.ts");
const { verifyPassword } = await import("../../src/server/auth/password.ts");
const { changeOwnPassword } = await import("../../src/server/services/password-reset.service.ts");
const { registerMemberRoutes } = await import("../../src/server/routes/members.ts");
const app = Fastify();
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [admin] = await db.insert(member).values({ username: "creation-admin", name: "创建管理员", status: "ACTIVE", passwordHash: "no-login" }).returning();
  await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(admin!.id))!;
  let requestActor = actor;
  app.decorate("csrfProtection", async () => {});
  app.addHook("preHandler", async req => { req.actor = requestActor; });
  app.setErrorHandler((error, _req, reply) => { const err = error as { httpStatus: number; code: string; message: string }; reply.status(err.httpStatus ?? 500).send({ code: err.code, message: err.message }); });
  await registerMemberRoutes(app);
  const input = { username: "Created.Member", name: " 新成员 ", email: "Created@Example.test", password: "initial-member-password" };
  const response = await app.inject({ method: "POST", url: "/api/v1/members", payload: input });
  assert.equal(response.statusCode, 201, response.body);
  const output = response.json();
  assert.deepEqual(Object.keys(output).sort(), ["id", "username"]);
  assert.equal(output.username, "created.member");
  const [created] = await db.select().from(member).where(eq(member.id, output.id));
  assert.equal(created!.name, "新成员");
  assert.equal(created!.email, "created@example.test");
  assert.equal(await verifyPassword(created!.passwordHash, input.password), true);
  const createdActor = (await loadActor(output.id))!;
  assert.equal(createdActor.mustChangePassword, true, "管理员设置的初始密码应要求首次登录修改");
  assert.equal(createdActor.permissions.has("member:invite"), false);
  const assignments = await db.select({ key: role.key, scope: roleAssignment.scopeType }).from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId)).where(eq(roleAssignment.memberId, output.id));
  assert.deepEqual(assignments, [{ key: "MEMBER", scope: "ORG" }]);
  const audits = await db.select().from(auditEntry).where(eq(auditEntry.targetId, output.id));
  assert.ok(audits.some(row => row.action === "member.created"));
  assert.equal(JSON.stringify(audits).includes(input.password), false);
  await changeOwnPassword(output.id, input.password, "changed-member-password");
  assert.equal((await loadActor(output.id))!.mustChangePassword, false);

  requestActor = createdActor;
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/members", payload: { ...input, username: "forbidden" } })).statusCode, 403);
  await assert.rejects(createMember(createdActor, input), (error: unknown) => (error as { code: string }).code === "FORBIDDEN");
  requestActor = actor;
  for (const values of [{ name: "   " }, { username: "deleted-reserved" }, { password: "short" }, { email: "bad-email" }, { roleIds: [adminRole!.id] }]) {
    const invalid = await app.inject({ method: "POST", url: "/api/v1/members", payload: { ...input, username: "invalid-new", email: "invalid@example.test", ...values } });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
  for (const values of [{ username: "created.member", email: "other@example.test" }, { username: "other", email: "created@example.test" }]) {
    const duplicate = await app.inject({ method: "POST", url: "/api/v1/members", payload: { ...input, ...values } });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
  }
  const simultaneous = await Promise.all([0, 1].map(() => app.inject({ method: "POST", url: "/api/v1/members", payload: { ...input, username: "concurrent", email: "concurrent@example.test" } })));
  assert.deepEqual(simultaneous.map(r => r.statusCode).sort(), [201, 409]);

  // 在独立库注入角色写入失败，确认不会留下无角色账号。
  await sql.unsafe(`CREATE FUNCTION reject_creation_role() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM member WHERE id = NEW.member_id AND username = 'rollback-member') THEN RAISE EXCEPTION 'isolated role failure'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER reject_creation_role BEFORE INSERT ON role_assignment FOR EACH ROW EXECUTE FUNCTION reject_creation_role()");
  await assert.rejects(createMember(actor, { ...input, username: "rollback-member", email: "rollback@example.test" }));
  assert.equal((await db.select().from(member).where(eq(member.username, "rollback-member"))).length, 0);
  console.log("member creation contracts passed");
} finally { await app.close(); await sql.end({ timeout: 2 }); }
