import "./_env.ts";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, sql as pg } from "../src/db/index.ts";
import { databaseContext } from "../src/db/context.ts";
import {
  organization,
  member,
  role,
  roleAssignment,
  team,
  department,
  project,
  page,
  pageRevision,
  workItem,
  setupState,
  systemRestore,
  auditEntry,
  job,
} from "../src/db/schema.ts";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { buildApp } from "../src/server/app.ts";
import { hashPassword, verifyPassword } from "../src/server/auth/password.ts";
import {
  backupFixture,
  fixturePassword,
} from "../tests/support/system-backup-fixture.ts";
import { assertBusinessEmpty } from "../src/server/services/system-backup/validator.ts";
import { complete } from "../src/server/services/setup.service.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import {
  getJobHandler,
  recoverStalled,
  registerJobHandler,
  runJobWorkerOnce,
} from "../src/server/services/job.service.ts";

if (!process.env.FERONAVI_TEST_DIRECTORY || !process.env.DATABASE_URL)
  throw new Error("必须经隔离runner执行");
const app = await buildApp();
const password = "source-admin-password-123";
const datasetRows: Record<string, Record<string, unknown>[]> = {};
let sourceAdmin = "",
  sourcePage = "",
  sourceRevision = "";
const rollback = new Error("source-fixture-rollback");
try {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(organization).values({ name: "源组织" });
      const [admin] = await tx
        .insert(member)
        .values({
          username: "restore_admin",
          name: "源管理员",
          email: "restore@example.test",
          status: "ACTIVE",
          passwordHash: await hashPassword(password),
        })
        .returning();
      sourceAdmin = admin!.id;
      const [adminRole] = await tx
        .select()
        .from(role)
        .where(eq(role.key, "ADMIN"));
      await tx.insert(roleAssignment).values({
        memberId: sourceAdmin,
        roleId: adminRole!.id,
        scopeType: "ORG",
        scopeId: null,
      });
      const [parent] = await tx
        .insert(team)
        .values({ name: "父团队" })
        .returning();
      await tx.insert(team).values({ name: "子团队", parentId: parent!.id });
      await tx.insert(department).values({ name: "部门" });
      const [proj] = await tx
        .insert(project)
        .values({ key: "RESTORE", name: "恢复项目", createdBy: sourceAdmin })
        .returning();
      const [workflow] =
        await pg`select id from workflow where applies_to_type='TASK' and project_id is null`;
      const [status] =
        await pg`select id from workflow_state where workflow_id=${workflow!.id} limit 1`;
      await tx.insert(workItem).values({
        projectId: proj!.id,
        number: 1,
        key: "RESTORE-1",
        type: "TASK",
        title: "恢复工作项",
        workflowId: workflow!.id,
        statusId: status!.id,
        reporterId: sourceAdmin,
      });
      const [p] = await tx
        .insert(page)
        .values({ projectId: proj!.id, title: "页面", slug: "restore-page" })
        .returning();
      sourcePage = p!.id;
      const [rev] = await tx
        .insert(pageRevision)
        .values({
          pageId: sourcePage,
          revisionNo: 1,
          content: "恢复正文",
          authorId: sourceAdmin,
        })
        .returning();
      sourceRevision = rev!.id;
      await tx
        .update(page)
        .set({ currentRevisionId: sourceRevision })
        .where(eq(page.id, sourcePage));
      for (const dataset of orderedDatasets("safe")) {
        const rows = await pg`select * from ${pg(dataset.tableName)}`;
        datasetRows[dataset.name] = rows
          .map((row) =>
            dataset.encodeRow(row, { mode: "safe", purpose: "migration" }),
          )
          .filter((row): row is Record<string, unknown> => row !== null);
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY, {
    datasetRows,
  });
  const boot = await app.inject({
    method: "POST",
    url: "/api/v1/setup/restore/bootstrap",
  });
  assert.equal(boot.statusCode, 200, boot.body);
  const cookie = boot.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const headers = { cookie, "csrf-token": boot.json().csrfToken };
  let ip = 1;
  async function prepare(path = fixture.path) {
    const boundary = "restore-data";
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/v1/setup/restore/upload",
      remoteAddress: `127.1.0.${ip++}`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="backup.fnbak"\r\n\r\n`,
        ),
        await readFile(path),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const id = uploaded.json().id as string;
    const checked = await app.inject({
      method: "POST",
      url: `/api/v1/setup/restore/${id}/preflight`,
      headers,
      remoteAddress: `127.2.0.${ip++}`,
      payload: { migrationPassword: fixturePassword },
    });
    assert.equal(checked.statusCode, 200, checked.body);
    return id;
  }
  async function confirm(
    id: string,
    migrationPassword = fixturePassword,
    extraHeaders = headers,
    address = `127.3.0.${ip++}`,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/setup/restore/${id}/confirm`,
      headers: extraHeaders,
      remoteAddress: address,
      payload: { migrationPassword, confirmation: "恢复此实例" },
    });
  }
  async function runImport(id: string) {
    const [{ payload }] =
      await pg`select payload from job where kind='restore.system' and payload->>'restoreId'=${id}`;
    const { importSystemBackup } =
      await import("../src/server/services/system-backup/importer.ts");
    return importSystemBackup(
      payload as { restoreId: string; dataKeyHandle: string },
    );
  }
  const id = await prepare();
  assert.equal(
    (await confirm(id, fixturePassword, {} as typeof headers)).statusCode,
    403,
  );
  assert.equal(
    (await confirm(id, "wrong-password-123")).json().code,
    "INVALID_BACKUP",
  );
  for (let request = 0; request < 6; request++)
    assert.equal(
      (await confirm(id, "wrong-password-123", headers, "127.4.0.1"))
        .statusCode,
      request < 5 ? 400 : 429,
    );
  const stolen = {
    ...headers,
    cookie: cookie.replace(
      /setup_restore_session=[^;]+/,
      `setup_restore_session=${"A".repeat(43)}`,
    ),
  };
  assert.equal((await confirm(id, fixturePassword, stolen)).statusCode, 403);
  const blocker = await pg.reserve();
  try {
    await blocker`select pg_advisory_lock(hashtextextended('feronavi.system-restore.v1',0))`;
    assert.equal((await confirm(id)).json().code, "CONFLICT");
    await assert.rejects(complete({} as Parameters<typeof complete>[0]), {
      code: "CONFLICT",
    });
  } finally {
    await blocker`select pg_advisory_unlock(hashtextextended('feronavi.system-restore.v1',0))`;
    blocker.release();
  }
  const [nonempty] = await db
    .insert(organization)
    .values({ name: "不允许覆盖" })
    .returning();
  assert.equal((await confirm(id)).json().code, "TARGET_NOT_EMPTY");
  await db.delete(organization).where(eq(organization.id, nonempty!.id));
  const changed = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY, {
    datasetRows,
    manifest: { sourceBuild: "changed-after-preflight" },
  });
  const [control] = await db
    .select()
    .from(systemRestore)
    .where(eq(systemRestore.id, id));
  await copyFile(changed.path, control!.uploadPath);
  assert.equal((await confirm(id)).json().code, "INVALID_BACKUP");
  await copyFile(fixture.path, control!.uploadPath);
  await pg`create function fail_restore_enqueue() returns trigger language plpgsql as $$ begin raise sqlstate '53100' using message = 'synthetic disk full'; end $$`;
  await pg`create trigger fail_restore_enqueue before insert on job for each row execute function fail_restore_enqueue()`;
  assert.equal((await confirm(id)).json().code, "INSUFFICIENT_STORAGE");
  assert.equal(
    (await db.select().from(systemRestore).where(eq(systemRestore.id, id)))[0]!
      .status,
    "PREFLIGHT_PASSED",
  );
  await pg`drop trigger fail_restore_enqueue on job`;
  await pg`drop function fail_restore_enqueue()`;
  const accepted = await confirm(id);
  assert.equal(accepted.statusCode, 200, accepted.body);
  registerBuiltinJobHandlers();
  let ordinaryRan = false;
  registerJobHandler("test.restore-lock", async () => {
    ordinaryRan = true;
  });
  const [ordinary] = await db
    .insert(job)
    .values({ kind: "test.restore-lock", maxAttempts: 1 })
    .returning();
  const lockDuringClaim = await pg.reserve();
  try {
    await lockDuringClaim`select pg_advisory_lock(hashtextextended('feronavi.system-restore.v1',0))`;
    await runJobWorkerOnce("restore-lock-test");
    const [queued] =
      await pg`select status, attempts from job where kind='restore.system' and payload->>'restoreId'=${id}`;
    assert.equal(queued!.status, "PENDING");
    assert.equal(queued!.attempts, 0);
    assert.equal(ordinaryRan, true, "锁竞争不能阻断其他job");
    assert.equal(
      (
        await db.select().from(systemRestore).where(eq(systemRestore.id, id))
      )[0]!.status,
      "RESTORING",
    );
  } finally {
    await lockDuringClaim`select pg_advisory_unlock(hashtextextended('feronavi.system-restore.v1',0))`;
    lockDuringClaim.release();
    await db.delete(job).where(eq(job.id, ordinary!.id));
  }
  await assert.rejects(complete({} as Parameters<typeof complete>[0]), {
    code: "CONFLICT",
  });
  const status = await app.inject({
    method: "GET",
    url: `/api/v1/setup/restore/${id}/status`,
    headers: { cookie },
  });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().status, "RESTORING");
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/v1/setup/restore/${id}/status`,
        headers: { cookie: stolen.cookie },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/health" })).statusCode,
    200,
  );
  for (const url of [
    "/api/v1/setup/complete",
    "/api/v1/setup/database/test",
    "/api/v1/setup/step",
    "/api/v1/setup/restore/bootstrap",
  ]) {
    assert.equal(
      (await app.inject({ method: "POST", url, headers, payload: {} }))
        .statusCode,
      409,
      url,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/v1/setup/restore/${id}`,
        headers: { cookie },
      })
    ).statusCode,
    409,
  );
  await pg`create function fail_import_department() returns trigger language plpgsql as $$ begin raise exception 'test-only fail third dataset'; end $$`;
  await pg`create trigger fail_import_department before insert on department for each row execute function fail_import_department()`;
  const failedWorker = await runJobWorkerOnce("restore-after-unlock", 1);
  assert.equal(failedWorker.failed, 1);
  const [failedJob] =
    await pg`select status, attempts from job where kind='restore.system' and payload->>'restoreId'=${id}`;
  assert.equal(failedJob!.status, "DEAD");
  assert.equal(failedJob!.attempts, 1, "普通执行失败仍遵守maxAttempts=1");
  for (const table of [
    "organization",
    "member",
    "project",
    "team",
    "department",
  ])
    assert.equal(
      (await pg`select count(*)::int as n from ${pg(table)}`)[0]!.n,
      0,
      table,
    );
  assert.equal(
    (await db.select().from(setupState)).some((s) => s.initializedAt !== null),
    false,
  );
  assert.equal(
    (await db.select().from(systemRestore).where(eq(systemRestore.id, id)))[0]!
      .status,
    "FAILED",
  );
  await pg`drop trigger fail_import_department on department`;
  await pg`drop function fail_import_department()`;
  for (const changes of [
    { errorCode: "SECRET" },
    { errorCode: "RESTORE_FAILED", extra: "secret" },
  ]) {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(auditEntry).values({
          actorId: null,
          actorSnapshot: "setup",
          severity: "SECURITY",
          action: "system_restore.failed",
          targetType: "system_restore",
          targetId: id,
          changes,
        });
        await assert.rejects(assertBusinessEmpty(), {
          code: "TARGET_NOT_EMPTY",
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(auditEntry).values({
        actorId: null,
        actorSnapshot: "setup",
        severity: "SECURITY",
        action: "system_restore.started",
        targetType: "system_restore",
        targetId: id,
        changes: { errorCode: "RESTORE_FAILED" },
      });
      await assert.rejects(assertBusinessEmpty(), { code: "TARGET_NOT_EMPTY" });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  for (const payload of [
    { restoreId: id, dataKeyHandle: "A".repeat(43), extra: true },
    { restoreId: id, dataKeyHandle: "bad" },
    {
      restoreId: "00000000-0000-4000-8000-000000000001",
      dataKeyHandle: "A".repeat(43),
    },
    1,
  ]) {
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(job)
          .values({ kind: "restore.system", payload: payload as object });
        await assert.rejects(assertBusinessEmpty(), {
          code: "TARGET_NOT_EMPTY",
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  const { importSystemBackup } =
    await import("../src/server/services/system-backup/importer.ts");
  const workerCheck = await prepare();
  assert.equal((await confirm(workerCheck)).statusCode, 200);
  const [workerControl] = await db
    .select()
    .from(systemRestore)
    .where(eq(systemRestore.id, workerCheck));
  await copyFile(changed.path, workerControl!.uploadPath);
  await assert.rejects(runImport(workerCheck), { code: "INVALID_BACKUP" });
  const workerEmpty = await prepare();
  assert.equal((await confirm(workerEmpty)).statusCode, 200);
  const [foreignOrg] = await db
    .insert(organization)
    .values({ name: "确认后写入" })
    .returning();
  await assert.rejects(runImport(workerEmpty), { code: "TARGET_NOT_EMPTY" });
  await db.delete(organization).where(eq(organization.id, foreignOrg!.id));
  const cases: Array<[string, (rows: typeof datasetRows) => void]> = [
    [
      "no-organization",
      (rows) => {
        rows["identity.organization"] = [];
      },
    ],
    [
      "no-admin",
      (rows) => {
        rows["identity.role_assignment"] = [];
      },
    ],
    [
      "no-local-password",
      (rows) => {
        rows["identity.member"]![0]!.password_hash = "!";
      },
    ],
    [
      "unknown-field",
      (rows) => {
        rows["identity.organization"]![0]!.injected = "secret";
      },
    ],
    [
      "missing-required",
      (rows) => {
        delete rows["identity.organization"]![0]!.name;
      },
    ],
    [
      "duplicate-id",
      (rows) => {
        rows["identity.team"]!.push(rows["identity.team"]![0]!);
      },
    ],
    [
      "invalid-fk",
      (rows) => {
        rows["identity.member"]![0]!.department_id =
          "00000000-0000-4000-8000-000000000001";
      },
    ],
    [
      "workflow-status-mismatch",
      (rows) => {
        const item = rows["projects.work_item"]![0]!;
        item.status_id = rows["projects.workflow_state"]!.find(
          (s) => s.workflow_id !== item.workflow_id,
        )!.id;
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    const rows = structuredClone(datasetRows);
    mutate(rows);
    const bad = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY, {
      datasetRows: rows,
    });
    const attempt = await prepare(bad.path);
    const confirmed = await confirm(attempt);
    assert.equal(confirmed.statusCode, 200, `${name}: ${confirmed.body}`);
    await assert.rejects(runImport(attempt), { code: "INVALID_BACKUP" }, name);
    assert.equal(
      (await pg`select count(*)::int as n from organization`)[0]!.n,
      0,
      name,
    );
    assert.equal(
      (await pg`select count(*)::int as n from member`)[0]!.n,
      0,
      name,
    );
    assert.equal(
      (
        await pg`select count(*)::int as n from setup_state where initialized_at is not null`
      )[0]!.n,
      0,
      name,
    );
  }
  // full的接受、换钥和鉴权回归由e2e-system-backup-full独立验证。
  const largeRows = structuredClone(datasetRows);
  const largeComments = Array.from({ length: 3 }, () => ({
    id: randomUUID(),
    target_type: "PAGE",
    target_id: sourcePage,
    author_id: sourceAdmin,
    body: randomBytes(3 * 1024 * 1024).toString("base64"),
    parent_id: null as string | null,
    edited_at: null,
    deleted_at: null,
    created_at: "2026-11-14T00:00:00.000Z",
    updated_at: "2026-11-14T00:00:00.000Z",
  }));
  largeComments[1]!.parent_id = largeComments[0]!.id;
  largeComments[2]!.parent_id = largeComments[1]!.id;
  largeRows["content.comment"] = largeComments;
  const largeFixture = await backupFixture(
    process.env.FERONAVI_TEST_DIRECTORY,
    {
      datasetRows: largeRows,
    },
  );
  const next = await prepare(largeFixture.path);
  assert.equal((await confirm(next)).statusCode, 200);
  await pg`update job set status='DEAD' where kind='restore.system' and payload->>'restoreId'<>${next}`;
  const restoreHandler = getJobHandler("restore.system")!;
  const observer = await pg.reserve();
  const realSetInterval = globalThis.setInterval;
  let leaseCheckError: unknown;
  registerJobHandler("restore.system", async (payload, row) => {
    try {
      await db.transaction(async () => {
        await observer`update job set locked_at=now()-interval '11 minutes' where id=${row.id}`;
        const deadline = Date.now() + 2000;
        let renewed = false;
        while (Date.now() < deadline) {
          const [lease] =
            await observer`select locked_at > now()-interval '1 minute' as renewed from job where id=${row.id}`;
          if (lease!.renewed) {
            renewed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(
          renewed,
          true,
          "导入事务未提交时，其他连接必须已能看到续租",
        );
        assert.equal(await databaseContext.exit(recoverStalled), 0);
        const [lease] =
          await observer`select status, attempts from job where id=${row.id}`;
        assert.equal(lease!.status, "RUNNING", "有效续租不可被僵死回收误杀");
        assert.equal(lease!.attempts, 1);
      });
    } catch (error) {
      leaseCheckError = error;
      throw error;
    }
    await restoreHandler(payload, row);
  });
  // 仅加速真实worker的心跳间隔，不替换续租SQL或事务行为。
  globalThis.setInterval = ((callback, delay, ...args) =>
    realSetInterval(
      callback,
      delay === 60_000 ? 10 : delay,
      ...args,
    )) as typeof setInterval;
  let successfulWorker;
  try {
    successfulWorker = await runJobWorkerOnce("restore-success", 1);
  } finally {
    globalThis.setInterval = realSetInterval;
    registerJobHandler("restore.system", restoreHandler);
    observer.release();
  }
  assert.ifError(leaseCheckError);
  assert.equal(successfulWorker.succeeded, 1);
  const [{ payload: completedPayload }] =
    await pg`select payload from job where kind='restore.system' and payload->>'restoreId'=${next}`;
  assert.deepEqual(Object.keys(completedPayload).sort(), [
    "dataKeyHandle",
    "restoreId",
  ]);
  assert.equal(
    JSON.stringify(completedPayload).includes(fixturePassword),
    false,
  );
  await assert.rejects(
    importSystemBackup(
      completedPayload as Parameters<typeof importSystemBackup>[0],
    ),
    { code: "CONFLICT" },
  );
  const [state] = await db.select().from(setupState);
  assert.ok(state!.initializedAt);
  assert.equal(state!.currentStep, 6);
  assert.equal(state!.restoredPackageId, largeFixture.manifest.packageId);
  const [restored] = await db
    .select()
    .from(member)
    .where(eq(member.id, sourceAdmin));
  assert.ok(await verifyPassword(restored!.passwordHash, password));
  assert.equal(
    (await db.select().from(page).where(eq(page.id, sourcePage)))[0]!
      .currentRevisionId,
    sourceRevision,
  );
  assert.equal(
    (
      await pg`select count(*)::int as n from team c join team p on c.parent_id=p.id`
    )[0]!.n,
    1,
  );
  for (const comment of largeComments) {
    const [restoredComment] =
      await pg`select parent_id, length(body) as bytes, md5(body) as digest from comment where id=${comment.id}`;
    assert.equal(restoredComment!.parent_id, comment.parent_id);
    assert.equal(restoredComment!.bytes, 4 * 1024 * 1024);
    assert.equal(
      restoredComment!.digest,
      createHash("md5").update(comment.body).digest("hex"),
      "第二遍引用回填必须保留大正文",
    );
  }
  for (const dataset of largeFixture.manifest.datasets) {
    const definition = orderedDatasets("safe").find(
      (d) => d.name === dataset.name,
    )!;
    const [{ n }] =
      await pg`select count(*)::int as n from ${pg(definition.tableName)}`;
    if (definition.tableName === "audit_entry") assert.ok(n > dataset.rows);
    else assert.equal(n, dataset.rows, dataset.name);
  }
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/v1/setup/restore/${next}/status`,
        headers: { cookie },
      })
    ).json().status,
    "SUCCEEDED",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/v1/setup/restore/${next}/confirm`,
        headers,
        payload: {},
      })
    ).statusCode,
    403,
  );
  console.log(
    "PASS restore data: confirm authentication/CSRF, maintenance, worker lock contention, independently committed lease heartbeat, rollback, exact counts, local audit baseline, self/deferred references, initialized marker, local admin password",
  );
} finally {
  await app.close();
  await pg.end();
}
