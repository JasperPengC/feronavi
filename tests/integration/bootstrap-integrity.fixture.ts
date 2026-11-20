/** Missing composition must fail before any business data is written. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, workItem } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const { createWorkItem } = await import("../../src/server/services/work-item.service.ts");
try {
  const [admin] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: `boot-${randomUUID()}`, name: "Bootstrap integrity", passwordHash: "not-a-login", status: "ACTIVE", mustChangePassword: false }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: admin!.id, scopeType: "ORG" });
  const actor = (await loadActor(person!.id))!;
  const project = await createProject(actor, { key: "BOOTCHECK", name: "Bootstrap integrity" });
  await assert.rejects(createWorkItem(actor, project.id, { type: "TASK", title: "must not partially persist" }), /application root/);
  const rows = await db.select({ id: workItem.id }).from(workItem).where(eq(workItem.projectId, project.id));
  assert.equal(rows.length, 0, "missing domain ports must not leave a committed work item");
  console.log("bootstrap integrity passed");
} finally { await sql.end({ timeout: 2 }); }
