import "./_env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, sql as pg } from "../src/db/index.ts";
import {
  auditEntry,
  organization,
  member,
  project,
  setupState,
  systemRestore,
} from "../src/db/schema.ts";
import { buildApp } from "../src/server/app.ts";
import {
  backupFixture,
  fixturePassword,
} from "../tests/support/system-backup-fixture.ts";

if (!process.env.FERONAVI_TEST_DIRECTORY || !process.env.DATABASE_URL)
  throw new Error("必须通过 scripts/run-isolated-test.ts 执行");

const app = await buildApp();
type Client = { cookies: Record<string, string>; token: string };
const cookieHeader = (client: Client) =>
  Object.entries(client.cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
async function bootstrap(ip: string): Promise<Client> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/setup/restore/bootstrap",
    remoteAddress: ip,
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    cookies: Object.fromEntries(
      response.cookies.map((cookie) => [cookie.name, cookie.value]),
    ),
    token: response.json().csrfToken,
  };
}
let sequence = 1;
async function upload(client: Client, path: string, csrf = true) {
  const boundary = "restore-boundary";
  return app.inject({
    method: "POST",
    url: "/api/v1/setup/restore/upload",
    remoteAddress: `127.0.1.${sequence++}`,
    headers: {
      cookie: cookieHeader(client),
      ...(csrf ? { "csrf-token": client.token } : {}),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="secret-source.fnbak"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      await readFile(path),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}
async function preflight(
  client: Client,
  id: string,
  password = fixturePassword,
  csrf = true,
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/setup/restore/${id}/preflight`,
    remoteAddress: `127.0.2.${sequence++}`,
    headers: {
      cookie: cookieHeader(client),
      ...(csrf ? { "csrf-token": client.token } : {}),
    },
    payload: { migrationPassword: password },
  });
}
async function status(client: Client, id: string) {
  return app.inject({
    method: "GET",
    url: `/api/v1/setup/restore/${id}`,
    headers: { cookie: cookieHeader(client) },
  });
}
try {
  const owner = await bootstrap("127.0.0.1");
  assert.equal(owner.cookies.setup_restore_session?.length, 43);
  const stranger = await bootstrap("127.0.0.2");
  const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY, {
    manifest: {
      sourceBuild: fixturePassword,
      excludedData: [{ key: "sensitive", reason: fixturePassword }],
    },
  });
  assert.equal((await upload(owner, fixture.path, false)).statusCode, 403);
  const uploaded = await upload(owner, fixture.path);
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const id = uploaded.json().id as string;
  const [record] = await db
    .select()
    .from(systemRestore)
    .where(eq(systemRestore.id, id));
  assert.match(record!.ownerSessionHash!, /^[a-f0-9]{64}$/);
  assert.equal((await stat(record!.uploadPath)).mode & 0o777, 0o600);
  assert.equal((await status(stranger, id)).statusCode, 403);
  assert.equal(
    (await app.inject({ method: "GET", url: `/api/v1/setup/restore/${id}` }))
      .statusCode,
    403,
  );
  assert.equal((await preflight(stranger, id)).statusCode, 403);
  assert.equal(
    (await preflight(owner, id, fixturePassword, false)).statusCode,
    403,
  );
  assert.equal(
    (await preflight(owner, id, "wrong-password-123")).json().code,
    "INVALID_BACKUP",
  );
  const passed = await preflight(owner, id);
  assert.equal(passed.statusCode, 200, passed.body);
  assert.equal(passed.json().status, "PREFLIGHT_PASSED");
  for (const word of [
    "uploadPath",
    "ownerSessionHash",
    "encryption",
    "password",
    "sourceBuild",
    "datasets",
    "secret-source",
  ])
    assert.ok(!passed.body.includes(word), word);
  assert.ok(!passed.body.includes(fixturePassword));
  const [persisted] = await db
    .select()
    .from(systemRestore)
    .where(eq(systemRestore.id, id));
  assert.ok(
    !JSON.stringify(persisted!.manifestSummary).includes(fixturePassword),
  );
  await db
    .transaction(async (tx) => {
      await tx
        .update(systemRestore)
        .set({ status: "RESTORING" })
        .where(eq(systemRestore.id, id));
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/setup/restore/${id}`,
        remoteAddress: "127.0.9.1",
        headers: { cookie: cookieHeader(owner), "csrf-token": owner.token },
      });
      assert.equal(response.statusCode, 409);
      assert.ok((await stat(persisted!.uploadPath)).size > 0);
      throw new Error("rollback fixture");
    })
    .catch((error) => {
      assert.equal(error.message, "rollback fixture");
    });

  const { assertBusinessEmpty } =
    await import("../src/server/services/system-backup/validator.ts");
  assert.equal((await assertBusinessEmpty()).empty, true);
  // 更改任一严格审计属性均应阻断，不能整张audit_entry豁免。
  const [audit] = await db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.targetId, id));
  assert.ok(audit);
  for (const patch of [
    { actorSnapshot: "other" },
    { actorSnapshot: null },
    { severity: "BUSINESS" },
    { action: "system_restore.forged" },
    { targetType: "other" },
    { targetId: randomUUID() },
    { changes: { password: "secret" } },
    { ip: "127.0.0.1" },
    { userAgent: "forged" },
  ]) {
    await db.update(auditEntry).set(patch).where(eq(auditEntry.id, audit.id));
    await assert.rejects(assertBusinessEmpty(), { code: "TARGET_NOT_EMPTY" });
    await db
      .update(auditEntry)
      .set({
        actorSnapshot: audit.actorSnapshot,
        actorId: audit.actorId,
        severity: audit.severity,
        action: audit.action,
        targetType: audit.targetType,
        targetId: audit.targetId,
        changes: audit.changes,
        ip: audit.ip,
        userAgent: audit.userAgent,
      })
      .where(eq(auditEntry.id, audit.id));
  }
  await db
    .transaction(async (tx) => {
      const [actor] = await tx
        .insert(member)
        .values({
          username: "auditactor",
          name: "actor",
          status: "ACTIVE",
          passwordHash: "test-only-unusable",
        })
        .returning();
      await tx
        .update(auditEntry)
        .set({ actorId: actor!.id })
        .where(eq(auditEntry.id, audit.id));
      await assert.rejects(assertBusinessEmpty(), (error: unknown) => {
        const blocking = (
          error as { details: { blockingTables: Array<{ table: string }> } }
        ).details.blockingTables;
        return blocking.some((item) => item.table === "audit_entry");
      });
      throw new Error("rollback fixture");
    })
    .catch((error) => {
      assert.equal(error.message, "rollback fixture");
    });
  for (const table of [organization, member, project]) {
    await db
      .transaction(async (tx) => {
        if (table === organization)
          await tx.insert(organization).values({ name: "existing" });
        if (table === member)
          await tx.insert(member).values({
            username: "existing",
            email: "existing@test.invalid",
            name: "existing",
            status: "ACTIVE",
            passwordHash: "test-only-unusable",
          });
        if (table === project) {
          const [creator] = await tx
            .insert(member)
            .values({
              username: "creator",
              name: "creator",
              status: "ACTIVE",
              passwordHash: "test-only-unusable",
            })
            .returning();
          await tx
            .insert(project)
            .values({ key: "EXIST", name: "existing", createdBy: creator!.id });
        }
        await assert.rejects(assertBusinessEmpty(), {
          code: "TARGET_NOT_EMPTY",
        });
        throw new Error("rollback fixture");
      })
      .catch((error) => {
        assert.equal(error.message, "rollback fixture");
      });
  }
  await db
    .insert(setupState)
    .values({ initializedAt: new Date(), currentStep: 6 });
  await assert.rejects(assertBusinessEmpty(), { code: "TARGET_NOT_EMPTY" });
  assert.equal((await status(owner, id)).statusCode, 200);
  assert.equal((await status(stranger, id)).statusCode, 403);
  assert.equal((await upload(owner, fixture.path)).statusCode, 403);
  assert.equal((await preflight(owner, id)).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/setup/restore/bootstrap",
      })
    ).statusCode,
    403,
  );
  await db.delete(setupState);
  const bad = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY, {
    tamper: true,
  });
  const badUpload = await upload(owner, bad.path);
  assert.equal(badUpload.statusCode, 200);
  assert.equal(
    (await preflight(owner, badUpload.json().id)).json().code,
    "INVALID_BACKUP",
  );
  const deletion = {
    method: "DELETE" as const,
    url: `/api/v1/setup/restore/${badUpload.json().id}`,
  };
  assert.equal(
    (
      await app.inject({
        ...deletion,
        headers: {
          cookie: cookieHeader(stranger),
          "csrf-token": stranger.token,
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        ...deletion,
        headers: { cookie: cookieHeader(owner) },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        ...deletion,
        headers: { cookie: cookieHeader(owner), "csrf-token": owner.token },
      })
    ).statusCode,
    200,
  );
  const [deleted] = await db
    .select()
    .from(systemRestore)
    .where(eq(systemRestore.id, badUpload.json().id));
  assert.equal(deleted!.status, "FAILED");
  await assert.rejects(stat(deleted!.uploadPath), { code: "ENOENT" });
  const tinyLimit = process.env.SYSTEM_BACKUP_MAX_BYTES;
  process.env.SYSTEM_BACKUP_MAX_BYTES = "100";
  assert.equal((await upload(owner, fixture.path)).statusCode, 400);
  if (tinyLimit === undefined) delete process.env.SYSTEM_BACKUP_MAX_BYTES;
  else process.env.SYSTEM_BACKUP_MAX_BYTES = tinyLimit;
  for (let i = 0; i < 6; i++)
    await app.inject({
      method: "POST",
      url: "/api/v1/setup/restore/bootstrap",
      remoteAddress: "127.0.0.99",
    });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/setup/restore/bootstrap",
        remoteAddress: "127.0.0.99",
      })
    ).statusCode,
    429,
  );
  for (const path of [
    "/api/v1/setup/restore/upload",
    `/api/v1/setup/restore/${id}/preflight`,
  ]) {
    let response;
    for (let i = 0; i < 6; i++)
      response = await app.inject({
        method: "POST",
        url: path,
        remoteAddress: "127.0.8.8",
        headers: { cookie: cookieHeader(owner), "csrf-token": owner.token },
        payload: { migrationPassword: fixturePassword },
      });
    assert.equal(response!.statusCode, 429, path);
  }
  assert.equal((await assertBusinessEmpty()).empty, true);
  const audits = await db.select().from(auditEntry);
  assert.ok(audits.some((row) => row.action === "system_restore.uploaded"));
  assert.ok(audits.some((row) => row.action === "system_restore.preflighted"));
  assert.ok(!JSON.stringify(audits).includes(fixturePassword));
  console.log(
    "PASS restore preflight: upload, ownership/CSRF, validation, strict audit allowlist, empty gate, initialized status, rate limits",
  );
} finally {
  await app.close();
  await pg.end();
}
