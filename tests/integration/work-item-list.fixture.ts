import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, projectMembership, workItem } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const items = await import("../../src/server/services/work-item.service.ts");
const { createSession } = await import("../../src/server/auth/session.ts");
const { closeCache } = await import("../../src/server/auth/cache.ts");
const { ensureInitialized } = await import("../../scripts/_test-helpers.ts");
const { buildApp } = await import("../../src/server/app.ts");
const { listWorkItemsQuerySchema } = await import("../../src/shared/schemas/work-item.ts");
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
const failures: string[] = [];
async function check(name: string, action: () => Promise<void>) {
  try { await action(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${(error as Error).message}`); }
}

try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [owner, outsider, participant] = await db.insert(member).values([
    { username: "list-owner", name: "Owner", passwordHash: "no-password-login", status: "ACTIVE", mustChangePassword: false },
    { username: "list-outsider", name: "Outsider", passwordHash: "no-password-login", status: "ACTIVE", mustChangePassword: false },
    { username: "list-participant", name: "Participant", passwordHash: "no-password-login", status: "ACTIVE", mustChangePassword: false },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: owner!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(owner!.id))!;
  const outsiderActor = (await loadActor(outsider!.id))!;
  const project = await createProject(actor, { key: "LISTCONTRACT", name: "Private list contract" });
  await db.insert(projectMembership).values({ projectId: project.id, memberId: participant!.id, roleId: adminRole!.id });
  const rows = [];
  const priorities = ["LOW", "URGENT", "HIGH", null] as const;
  for (let index = 0; index < 4; index++) {
    const row = (await items.createWorkItem(actor, project.id, {
      type: "TASK", title: index === 0 ? "中文检索 合同 标题" : `Private list item ${index + 1}`,
      description: index === 1 ? "description-only-needle 中文全文 合同" : null,
      assigneeId: index === 0 ? owner!.id : null,
      priority: priorities[index], dueDate: index === 3 ? null : `2026-12-0${3 - index}`,
    }))!;
    await db.update(workItem).set({
      createdAt: new Date(`2026-11-0${index + 1}T00:00:00Z`),
      updatedAt: new Date(`2026-11-0${4 - index}T00:00:00Z`),
    }).where(eq(workItem.id, row.id));
    rows.push(row);
  }
  const removed = (await items.createWorkItem(actor, project.id, { type: "TASK", title: "deleted search title" }))!;
  await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, removed.id));
  const ownerSession = await createSession({ memberId: owner!.id });
  const outsiderSession = await createSession({ memberId: outsider!.id });
  const participantSession = await createSession({ memberId: participant!.id });
  // 完整生产应用、真实会话和实际 socket；不替换 Actor、路由或数据库。
  app = await buildApp();
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  async function request(query = "", session = ownerSession.token, projectId = project.id) {
    const response = await fetch(`${base}/api/v1/projects/${projectId}/work-items${query}`, {
      headers: { cookie: `feronavi_session=${session}` }, signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() };
  }
  await check("private project denies default/filtered/empty lists and anonymous HTTP", async () => {
    await assert.rejects(items.listWorkItems(outsiderActor, project.id), { code: "FORBIDDEN" });
    for (const query of ["", "?q=unmatched", "?statusKey=missing", "?priority=URGENT", "?page=20"]) {
      const response = await request(query, outsiderSession.token);
      assert.equal(response.status, 403, query);
      assert.equal(response.body.items, undefined);
    }
    assert.equal((await request("", "invalid-session")).status, 403);
    assert.equal((await request("", ownerSession.token, randomUUID())).status, 403);
    const allowed = await request("", participantSession.token);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.total, 4);
  });
  await check("total counts all matching live rows before pagination", async () => {
    for (const [page, length] of [[1, 2], [2, 2], [3, 0]]) {
      const response = await request(`?page=${page}&pageSize=2`);
      assert.equal(response.status, 200);
      assert.equal(response.body.total, 4);
      assert.equal(response.body.items.length, length);
      assert.equal(response.body.page, page);
      assert.equal(response.body.pageSize, 2);
    }
  });
  await check("priority, assignee, status, type and unscheduled filters agree with service", async () => {
    const current = await items.getWorkItem(actor, rows[0]!.id);
    const expectations: [Parameters<typeof items.listWorkItems>[2], number[]][] = [
      [{ priority: "URGENT" }, [1]], [{ priority: "LOWEST" }, []], [{ assigneeId: owner!.id }, [0]],
      [{ statusKey: "missing" }, []], [{ statusKey: current.statusKey! }, [0, 1, 2, 3]],
      [{ type: "DEFECT" }, []], [{ type: "TASK" }, [0, 1, 2, 3]],
      [{ unscheduled: true }, [3]], [{ unscheduled: false }, [0, 1, 2]],
    ];
    for (const [filters, indexes] of expectations) {
      const response = await request(`?${new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]))}`);
      const expected = await items.listWorkItems(actor, project.id, filters);
      assert.equal(response.status, 200);
      const expectedIds = indexes.map(index => rows[index]!.id).sort();
      assert.deepEqual(response.body.items.map((row: { id: string }) => row.id).sort(), expectedIds);
      assert.deepEqual(expected.items.map(row => row.id).sort(), expectedIds);
      assert.equal(response.body.total, expectedIds.length);
      assert.equal(expected.total, expectedIds.length);
    }
  });
  await check("every legacy and explicit sort uses deterministic business order with nulls last", async () => {
    const expectations: [string, number[]][] = [
      ["sort=created", [3, 2, 1, 0]], ["sort=updated", [0, 1, 2, 3]],
      ["sort=priority", [1, 2, 0, 3]], ["sort=dueDate", [2, 1, 0, 3]],
      ["sortBy=number&sortDir=desc", [3, 2, 1, 0]],
      ["sortBy=created_at&sortDir=asc", [0, 1, 2, 3]],
      ["sortBy=updated_at&sortDir=desc", [0, 1, 2, 3]],
      ["sortBy=due_date&sortDir=desc", [0, 1, 2, 3]],
      ["sortBy=priority&sortDir=asc", [0, 2, 1, 3]],
    ];
    for (const [query, indexes] of expectations) {
      const response = await request(`?${query}`);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.items.map((row: { id: string }) => row.id), indexes.map(index => rows[index]!.id), query);
      const service = await items.listWorkItems(actor, project.id, listWorkItemsQuerySchema.parse(Object.fromEntries(new URLSearchParams(query))));
      assert.deepEqual(service.items.map(row => row.id), indexes.map(index => rows[index]!.id), query);
    }
    await db.update(workItem).set({ createdAt: new Date("2026-11-01T00:00:00Z") }).where(eq(workItem.projectId, project.id));
    const first = await request("?sort=created&pageSize=2");
    const second = await request("?sort=created&page=2&pageSize=2");
    assert.deepEqual([...first.body.items, ...second.body.items].map(row => row.id), rows.map(row => row.id));
  });
  await check("Chinese full text and title/key/description substring searches share their results", async () => {
    for (const [query, indexes] of [["标题", [0]], ["cription-only", [1]], ["CONTRACT-3", [2]], ["标题 合同", [0]], ["not-in-project", []]] as [string, number[]][]) {
      const response = await request(`?q=${encodeURIComponent(query)}&sortBy=number&sortDir=asc`);
      const expected = indexes.map(index => rows[index]!.id);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.items.map((row: { id: string }) => row.id), expected, query);
      const service = await items.listWorkItems(actor, project.id, { q: query });
      assert.deepEqual(service.items.map(row => row.id), expected, query);
      assert.equal(response.body.total, expected.length);
    }
  });
  await check("REST keeps timestamps and service keeps workflow/status/planning projections", async () => {
    const response = await request("?sortBy=number&sortDir=asc");
    const service = await items.listWorkItems(actor, project.id);
    assert.deepEqual(response.body.items.map((row: { id: string }) => row.id), service.items.map(row => row.id));
    for (const field of ["id", "key", "number", "type", "title", "statusId", "assigneeId", "priority", "dueDate", "version", "projectId", "createdAt", "updatedAt", "workflowId", "statusKey", "statusName", "statusCategory", "milestoneId", "iterationId", "releaseId", "moduleId"]) {
      assert.ok(Object.hasOwn(response.body.items[0], field), `missing REST field ${field}`);
    }
  });
  assert.deepEqual(failures, []);
  console.log("work item list HTTP contracts passed");
} finally {
  await app?.close();
  await closeCache();
  await sql.end({ timeout: 5 });
}
