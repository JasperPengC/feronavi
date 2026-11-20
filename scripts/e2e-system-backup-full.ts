import "./_env.ts";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import * as tables from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import {
  masterKey,
  resetKeyCache,
  encryptSecret,
  encryptSecretWithKey,
  decryptSecret,
  decryptSecretWithKey,
} from "../src/server/services/crypto.service.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import {
  createToken,
  authenticateToken,
} from "../src/server/services/token.service.ts";
import * as scim from "../src/server/services/scim.service.ts";
import * as twoFactor from "../src/server/services/two-factor.service.ts";
import { base32Decode, totp } from "../src/server/lib/totp.ts";
import { assertToolPolicyAllowed } from "../src/server/services/mcp-client.service.ts";
import { createEncryptionEnvelope } from "../src/server/services/system-backup/crypto.ts";
import { exportSystemBackup } from "../src/server/services/system-backup/exporter.ts";
import { writeTemporaryKeyHandle } from "../src/server/services/system-backup/storage.ts";
import { authenticateAndReadManifest } from "../src/server/services/system-backup/restore-archive.ts";
import {
  manifestHash,
  restoreOwnerHash,
} from "../src/server/services/system-backup/validator.ts";
import { confirmSystemRestore } from "../src/server/services/system-backup/importer.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import {
  runJobWorkerOnce,
  getJobHandler,
} from "../src/server/services/job.service.ts";
import { getSettingRaw } from "../src/server/services/setting.service.ts";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import {
  backupFixture,
  fixturePassword,
} from "../tests/support/system-backup-fixture.ts";
import { recoverInterruptedRestores } from "../src/server/services/system-backup/restore-recovery.ts";
import {
  createBackupRecord,
  updateBackupRecord,
} from "../src/server/repos/system-transfer.repo.ts";

const root = process.env.DATA_DIR!;
if (!process.env.FERONAVI_TEST_DIRECTORY || !root)
  throw new Error("必须经隔离runner执行");
const password = "full-migration-password-123";
const installSession = randomBytes(32).toString("base64url");
let sourceKey: Buffer | undefined;
let targetKey: Buffer | undefined;
let app:
  | Awaited<ReturnType<typeof import("../src/server/app.ts").buildApp>>
  | undefined;
const originalFetch = globalThis.fetch;
let mockFailure = false,
  embeddingCalls = 0;
let embeddingHold: Promise<void> | undefined;
let embeddingStarted = () => {};
// 数字公共IP仅用于统一出站校验；传输完全在本进程mock，不发出网络请求。
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), "https://8.8.8.8/v1/embeddings");
  assert.equal(
    new Headers(init?.headers).get("authorization"),
    "Bearer embedding-secret",
  );
  embeddingCalls++;
  embeddingStarted();
  await embeddingHold;
  if (mockFailure)
    return new Response("private provider diagnostic", { status: 503 });
  const body = JSON.parse(String(init?.body)) as { input: string[] };
  return Response.json({
    data: body.input.map(() => ({ embedding: Array(1024).fill(0.1) })),
    usage: { total_tokens: 12 },
  });
};

try {
  await db.insert(tables.organization).values({ name: "完整迁移源组织" });
  const [admin] = await db
    .insert(tables.member)
    .values({
      username: "full_admin",
      name: "迁移管理员",
      status: "ACTIVE",
      passwordHash: await hashPassword("admin-password-123"),
    })
    .returning();
  const [adminRole] = await db
    .select()
    .from(tables.role)
    .where(eq(tables.role.key, "ADMIN"));
  await db
    .insert(tables.roleAssignment)
    .values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(admin!.id))!;
  const createdToken = await createToken(actor, {
    name: "迁移API",
    tier: "ADMIN",
  });
  const token = { token: createdToken.token, id: createdToken.row.id };
  const scimToken = await scim.createToken(actor, "迁移SCIM");
  const tfa = await twoFactor.setup(admin!.id, { account: "full_admin" });
  const totpSecret = base32Decode(
    tfa.otpauthUrl.match(/secret=([A-Z2-7]+)/)![1]!,
  );
  await twoFactor.activate(admin!.id, totp(totpSecret));
  await db.insert(tables.mcpClient).values({
    tokenId: token.id,
    clientName: "original-client",
    clientVersion: "1.0",
  });
  await db.insert(tables.mcpToolPolicy).values({
    tokenId: token.id,
    toolName: "work_item.create",
    effect: "DENY",
    argConstraints: { project: "preserved" },
  });
  const [project] = await db
    .insert(tables.project)
    .values({ key: "FULL", name: "迁移项目", createdBy: admin!.id })
    .returning();
  const pageIds: string[] = [];
  for (const word of ["AlphaUnique", "BetaUnique"]) {
    const [page] = await db
      .insert(tables.page)
      .values({ projectId: project!.id, title: word, slug: word })
      .returning();
    pageIds.push(page!.id);
    const [revision] = await db
      .insert(tables.pageRevision)
      .values({
        pageId: page!.id,
        revisionNo: 1,
        content: `# ${word}\n${word} searchable restored document`,
        authorId: admin!.id,
      })
      .returning();
    await db
      .update(tables.page)
      .set({ currentRevisionId: revision!.id })
      .where(eq(tables.page.id, page!.id));
  }
  const [iteration] = await db
    .insert(tables.iteration)
    .values({
      projectId: project!.id,
      name: "恢复指标",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    })
    .returning();
  for (const [key, value, isSecret] of [
    ["smtp.password", "smtp-secret", true],
    ["ai.apiKey", "embedding-secret", true],
    ["ai.enabled", true, false],
    ["ai.baseUrl", "https://8.8.8.8/v1", false],
    ["ai.model", "local-mock", false],
    ["storage.kind", "s3", false],
    ["storage.s3.bucket", "source-bucket", false],
    ["storage.s3.secretKey", "s3-secret", true],
    ["knowledge.active_generation", 76543, false],
  ] as const)
    await db.insert(tables.setting).values({
      key,
      value: (isSecret ? encryptSecret(String(value)) : value) as object,
      isSecret,
    });
  await db.insert(tables.webhookEndpoint).values({
    name: "hook",
    url: "https://8.8.8.8/hook",
    secretEncrypted: encryptSecret("webhook-secret"),
    events: [],
  });
  await db.insert(tables.aiProviderConfig).values({
    provider: "OPENAI_COMPAT",
    baseUrl: "https://8.8.8.8/v1",
    model: "mock",
    embeddingModel: "mock",
    apiKeyEncrypted: encryptSecret("provider-secret"),
  });
  await db.insert(tables.idpConfig).values({
    kind: "OIDC",
    issuer: "https://8.8.8.8",
    clientId: "source-client",
    clientSecretEncrypted: encryptSecret("sso-secret"),
    enabled: true,
  });
  await db.insert(tables.integration).values({
    kind: "GITHUB",
    name: "source-github",
    baseUrl: "https://8.8.8.8",
    tokenEncrypted: encryptSecret("integration-secret"),
  });
  await db.insert(tables.imChannel).values({
    name: "source-im",
    provider: "DINGTALK",
    webhookUrlEncrypted: encryptSecret("https://8.8.8.8/im"),
    appKeyEncrypted: encryptSecret("im-key"),
    appSecretEncrypted: encryptSecret("im-secret"),
  });
  sourceKey = Buffer.from(masterKey());
  const sourceRows: Record<string, Record<string, unknown>[]> = {};
  for (const dataset of orderedDatasets("full")) {
    const rows = await sql`select * from ${sql(dataset.tableName)}`;
    sourceRows[dataset.name] = rows.map((row) =>
      dataset.encodeRow(row, { mode: "full", purpose: "migration" })!,
    );
  }
  const exported = new Map<string, string>();
  for (const mode of ["full", "safe"] as const) {
    const backupId = randomUUID();
    const { dataKey, keyEnvelope } = await createEncryptionEnvelope(password);
    try {
      const handle = await writeTemporaryKeyHandle(backupId, dataKey);
      const result = await exportSystemBackup({
        backupId,
        mode,
        requestedBy: admin!.id,
        dataKeyHandle: handle.handle,
        keyEnvelope,
      });
      exported.set(mode, result.packagePath);
    } finally {
      dataKey.fill(0);
    }
  }
  async function emptyTarget(label: string) {
    const names = (
      await sql<
        { tablename: string }[]
      >`select tablename from pg_tables where schemaname='public'`
    ).map((r) => r.tablename);
    await sql`truncate table ${sql(names)} restart identity cascade`;
    process.env.DATA_DIR = join(root, label);
    resetKeyCache();
    return Buffer.from(masterKey());
  }
  async function restore(
    mode: "full" | "safe",
    archive = exported.get(mode)!,
    migrationPassword = password,
    success = true,
  ) {
    const verified = await authenticateAndReadManifest(
      archive,
      migrationPassword,
    );
    try {
      const [record] = await db
        .insert(tables.systemRestore)
        .values({
          packageId: verified.manifest.packageId,
          status: "PREFLIGHT_PASSED",
          uploadPath: archive,
          manifestHash: manifestHash(verified.manifest),
          mode,
          ownerSessionHash: restoreOwnerHash(installSession),
        })
        .returning();
      await confirmSystemRestore(record!.id, migrationPassword);
      registerBuiltinJobHandlers();
      const stats = await runJobWorkerOnce("full-restore", 1);
      assert.equal(
        success ? stats.succeeded : stats.failed,
        1,
        JSON.stringify(stats),
      );
      const [restored] = await db
        .select()
        .from(tables.systemRestore)
        .where(eq(tables.systemRestore.id, record!.id));
      assert.equal(restored!.status, success ? "SUCCEEDED" : "FAILED");
      if (!success) {
        assert.match(restored!.lastError!, /^INVALID_BACKUP:/);
        assert.equal(
          (await sql`select count(*)::int as n from organization`)[0]!.n,
          0,
        );
      }
      return restored!;
    } finally {
      verified.dataKey.fill(0);
    }
  }
  targetKey = await emptyTarget("full-target");
  assert.notDeepEqual(sourceKey, targetKey);
  const keyBefore = await readFile(join(process.env.DATA_DIR!, "master.key"));
  const badFull = await backupFixture(root, {
    mode: "full",
    sourceMasterKey: sourceKey,
    datasetRows: {
      ...sourceRows,
      "operations.feature_flag": [
        {
          key: "hidden-cipher",
          enabled: false,
          config: {
            nested: [encryptSecretWithKey("unknown secret", sourceKey)],
          },
        },
      ],
    },
  });
  await restore("full", badFull.path, fixturePassword, false);
  const safeRows = Object.fromEntries(
    orderedDatasets("safe").map((dataset) => [
      dataset.name,
      sourceRows[dataset.name]!.map((row) =>
        dataset.encodeRow(row, { mode: "safe", purpose: "migration" }),
      ).filter((row) => row !== null),
    ]),
  );
  const badSafe = await backupFixture(root, {
    mode: "safe",
    datasetRows: {
      ...safeRows,
      "operations.setting": [
        ...safeRows["operations.setting"]!,
        {
          key: "smtp.password",
          value: "injected-password",
          is_secret: false,
          updated_at: new Date().toISOString(),
        },
      ],
    },
  });
  await restore("safe", badSafe.path, fixturePassword, false);
  await sql`create function fail_rebuild_enqueue() returns trigger language plpgsql as $$ begin if NEW.kind='restore.rebuild' then raise exception 'private queue diagnostic'; end if; return NEW; end $$`;
  await sql`create trigger fail_rebuild_enqueue before insert on job for each row execute function fail_rebuild_enqueue()`;
  const errors: unknown[][] = [];
  const originalError = console.error;
  const originalLog = console.log;
  const notices: unknown[] = [];
  console.log = (...args) => {
    const notice =
      args.length === 1
        ? (args[0] as { code?: string; message?: string })
        : undefined;
    if (
      notice?.code === "25P01" &&
      notice.message === "there is no transaction in progress"
    )
      notices.push(notice);
    else originalLog(...args);
  };
  const reserve = sql.reserve;
  let loseCommitReceipt = true;
  sql.reserve = (async (...args: Parameters<typeof reserve>) => {
    const connection = await reserve(...args);
    let wroteMarker = false;
    return new Proxy(connection, {
      get(target, property) {
        if (property === "unsafe")
          return (...query: Parameters<typeof connection.unsafe>) => {
            if (query[0].startsWith('insert into "setup_state"'))
              wroteMarker = true;
            if (query[0] !== "commit" || !wroteMarker)
              return connection.unsafe(...query);
            return (async () => {
              const result = await connection.unsafe(...query);
              if (loseCommitReceipt) {
                loseCommitReceipt = false;
                throw new Error("synthetic lost commit receipt");
              }
              return result;
            })();
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof reserve;
  let restored: typeof tables.systemRestore.$inferSelect;
  console.error = (...args) => {
    errors.push(args);
  };
  try {
    restored = await restore("full");
  } finally {
    console.error = originalError;
    console.log = originalLog;
    sql.reserve = reserve;
  }
  assert.equal(loseCommitReceipt, false, "已在真实COMMIT成功后注入丢失回执");
  assert.equal(notices.length, 1, "仅产生一次预期25P01回滚notice");
  assert.deepEqual(errors, [
    ["系统恢复重建入队失败", { code: "RESTORE_REBUILD_FAILED" }],
  ]);
  const rebuild =
    await import("../src/server/services/system-backup/post-restore-rebuild.ts");
  assert.deepEqual(
    await rebuild.getPostRestoreRebuildSummary(restored.packageId!),
    {
      status: "NOT_STARTED",
      message: "数据已恢复，索引重建尚未开始",
      canRetry: true,
    },
  );
  await sql`drop trigger fail_rebuild_enqueue on job`;
  await sql`drop function fail_rebuild_enqueue()`;
  await recoverInterruptedRestores();
  await Promise.all([
    rebuild.enqueuePostRestoreRebuilds(restored.packageId!),
    rebuild.enqueuePostRestoreRebuilds(restored.packageId!),
  ]);
  assert.deepEqual(
    await readFile(join(process.env.DATA_DIR!, "master.key")),
    keyBefore,
  );
  assert.deepEqual(await readFile(join(root, "master.key")), sourceKey);
  assert.ok(
    !(await readdir(process.env.DATA_DIR!, { recursive: true })).some((name) =>
      name.includes("source-master-key"),
    ),
  );
  assert.deepEqual(masterKey(), targetKey);
  assert.equal(
    (await authenticateToken(token.token, "127.0.0.1"))?.ctx.tokenId,
    token.id,
  );
  assert.ok(await scim.authenticate(`Bearer ${scimToken.token}`));
  const { login } = await import("../src/server/services/auth.service.ts");
  assert.ok(
    (
      await login(
        {
          username: "full_admin",
          password: "admin-password-123",
          totpCode: totp(totpSecret),
        },
        { ip: "127.0.0.1", userAgent: "migration-test" },
      )
    ).token,
  );
  assert.ok(
    (
      await login(
        {
          username: "full_admin",
          password: "admin-password-123",
          recoveryCode: tfa.recoveryCodes[0]!,
        },
        { ip: "127.0.0.1", userAgent: "migration-test" },
      )
    ).token,
  );
  assert.equal(
    (
      await sql`select client_name from mcp_client where token_id=${token.id}`
    )[0]!.client_name,
    "original-client",
  );
  assert.deepEqual(
    (
      await sql`select arg_constraints from mcp_tool_policy where token_id=${token.id}`
    )[0]!.arg_constraints,
    { project: "preserved" },
  );
  await assert.rejects(assertToolPolicyAllowed(token.id, "work_item.create"), {
    code: "FORBIDDEN",
  });
  await assertToolPolicyAllowed(token.id, "work_item.get");
  for (const [table, column, want] of [
    ["webhook_endpoint", "secret_encrypted", "webhook-secret"],
    ["ai_provider_config", "api_key_encrypted", "provider-secret"],
    ["idp_config", "client_secret_encrypted", "sso-secret"],
    ["integration", "token_encrypted", "integration-secret"],
    ["im_channel", "webhook_url_encrypted", "https://8.8.8.8/im"],
    ["im_channel", "app_key_encrypted", "im-key"],
    ["im_channel", "app_secret_encrypted", "im-secret"],
  ]) {
    const value = (
      await sql`select ${sql(column!)} as v from ${sql(table!)}`
    )[0]!.v as string;
    assert.equal(decryptSecret(value), want);
    assert.throws(() => decryptSecretWithKey(value, sourceKey!));
  }
  assert.equal(await getSettingRaw("smtp.password"), "smtp-secret");
  assert.equal(await getSettingRaw("ai.apiKey"), "embedding-secret");
  assert.equal(await getSettingRaw("storage.kind"), "local");
  assert.equal(await getSettingRaw("storage.s3.secretKey"), null);
  assert.equal(
    await getSettingRaw("migration.disabled.storage.s3.secretKey"),
    "s3-secret",
  );

  await rebuild.enqueuePostRestoreRebuilds(restored.packageId!);
  await rebuild.retryPostRestoreRebuilds(restored.packageId!);
  assert.equal(
    (
      await sql`select count(*)::int as n from job where kind='restore.rebuild'`
    )[0]!.n,
    1,
  );
  mockFailure = true;
  assert.equal((await runJobWorkerOnce("rebuild-fails", 1)).failed, 1);
  assert.equal(
    (
      await db
        .select()
        .from(tables.systemRestore)
        .where(eq(tables.systemRestore.id, restored.id))
    )[0]!.status,
    "SUCCEEDED",
  );
  assert.deepEqual(
    await rebuild.getPostRestoreRebuildSummary(restored.packageId!),
    { status: "FAILED", message: "数据已恢复，索引重建失败", canRetry: true },
  );
  assert.equal((await sql`select count(*)::int as n from page_chunk`)[0]!.n, 0);
  const { buildApp } = await import("../src/server/app.ts");
  app = await buildApp({ logger: false });
  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      username: "full_admin",
      password: "admin-password-123",
      totpCode: totp(totpSecret),
    },
  });
  assert.equal(loginResponse.statusCode, 200, loginResponse.body);
  const cookie = loginResponse.cookies
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  const headers = { cookie, "csrf-token": loginResponse.json().csrfToken };
  const rebuildUrl = `/api/v1/system/restores/${restored.packageId}/rebuild`;
  assert.equal(
    (await app.inject({ method: "GET", url: rebuildUrl })).statusCode,
    403,
  );
  const adminStatus = await app.inject({
    method: "GET",
    url: rebuildUrl,
    headers,
  });
  assert.equal(adminStatus.statusCode, 200, adminStatus.body);
  assert.equal(adminStatus.json().status, "FAILED");
  const currentRebuildUrl = "/api/v1/system/restores/current";
  assert.equal(
    (await app.inject({ method: "GET", url: currentRebuildUrl })).statusCode,
    403,
  );
  const currentRebuild = await app.inject({
    method: "GET",
    url: currentRebuildUrl,
    headers,
  });
  assert.equal(currentRebuild.statusCode, 200, currentRebuild.body);
  assert.deepEqual(currentRebuild.json(), {
    packageId: restored.packageId,
    rebuild: {
      status: "FAILED",
      message: "数据已恢复，索引重建失败",
      canRetry: true,
    },
  });
  const backupFailureCases = [
    {
      lastError: "系统备份失败（INSUFFICIENT_STORAGE）",
      expectedCode: "INSUFFICIENT_STORAGE",
    },
    {
      lastError: "private test diagnostic token=never-expose",
      expectedCode: "BACKUP_FAILED",
    },
    {
      lastError: "任务执行租约已过期",
      expectedCode: "BACKUP_INTERRUPTED",
    },
  ] as const;
  const backupFailureIds: string[] = [];
  for (const failure of backupFailureCases) {
    const record = await createBackupRecord({
      requestedBy: admin!.id,
      mode: "safe",
      headerDraft: {},
      expiresAt: new Date(Date.now() + 60_000),
    });
    backupFailureIds.push(record.id);
    await updateBackupRecord(record.id, { status: "FAILED" }, "PENDING");
    await db.insert(tables.job).values({
      kind: "backup.system",
      status: "DEAD",
      payload: { backupId: record.id },
      attempts: 1,
      maxAttempts: 1,
      lastError: failure.lastError,
    });
  }
  const backupList = await app.inject({
    method: "GET",
    url: "/api/v1/system/backups",
    headers,
  });
  assert.equal(backupList.statusCode, 200, backupList.body);
  const listedBackups = backupList.json().backups as {
    id: string;
    failureCode?: string | null;
  }[];
  for (let index = 0; index < backupFailureCases.length; index++) {
    const listed = listedBackups.find(
      (item) => item.id === backupFailureIds[index],
    );
    assert.ok(listed, "失败备份应出现在历史摘要中");
    assert.equal(listed.failureCode, backupFailureCases[index]!.expectedCode);
  }
  assert.equal(backupList.body.includes("never-expose"), false);

  await sql`update setup_state set restored_package_id = null where initialized_at is not null`;
  const ordinarySetup = await app.inject({
    method: "GET",
    url: currentRebuildUrl,
    headers,
  });
  assert.equal(ordinarySetup.statusCode, 200, ordinarySetup.body);
  assert.equal(ordinarySetup.json(), null, "普通初始化实例没有当前恢复包");
  await sql`update setup_state set restored_package_id = ${restored.packageId} where initialized_at is not null`;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${rebuildUrl}/retry`,
        headers: { cookie },
      })
    ).statusCode,
    403,
  );
  await db.insert(tables.member).values({
    username: "no_backup_permission",
    name: "无设置权限",
    status: "ACTIVE",
    passwordHash: await hashPassword("viewer-password-123"),
  });
  const viewerLogin = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      username: "no_backup_permission",
      password: "viewer-password-123",
    },
  });
  const viewerHeaders = {
    cookie: viewerLogin.cookies
      .map((item) => `${item.name}=${item.value}`)
      .join("; "),
    "csrf-token": viewerLogin.json().csrfToken,
  };
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: rebuildUrl,
        headers: viewerHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: currentRebuildUrl,
        headers: viewerHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${rebuildUrl}/retry`,
        headers: viewerHeaders,
      })
    ).statusCode,
    403,
  );
  const installerStatus = await app.inject({
    method: "GET",
    url: `/api/v1/setup/restore/${restored.id}/status`,
    headers: { cookie: `setup_restore_session=${installSession}` },
  });
  assert.equal(installerStatus.statusCode, 200, installerStatus.body);
  assert.deepEqual(installerStatus.json().rebuild, {
    status: "FAILED",
    message: "数据已恢复，索引重建失败",
    canRetry: true,
  });
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/v1/setup/restore/${restored.id}/status`,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/v1/setup/restore/${restored.id}/confirm`,
        headers: { cookie: `setup_restore_session=${installSession}` },
        payload: { migrationPassword: password, confirmation: "恢复此实例" },
      })
    ).statusCode,
    403,
  );
  mockFailure = false;
  const retried = await app.inject({
    method: "POST",
    url: `${rebuildUrl}/retry`,
    headers,
  });
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(retried.json().status, "PENDING");
  await rebuild.retryPostRestoreRebuilds(restored.packageId!);
  let releaseEmbedding = () => {};
  embeddingHold = new Promise<void>((resolve) => {
    releaseEmbedding = resolve;
  });
  const reachedEmbedding = new Promise<void>((resolve) => {
    embeddingStarted = resolve;
  });
  await sql`create function fail_rebuild_ack() returns trigger language plpgsql as $$ begin if NEW.kind='restore.rebuild' and NEW.status='SUCCEEDED' and OLD.status='RUNNING' then raise exception 'synthetic queue acknowledgement failure'; end if; return NEW; end $$`;
  await sql`create trigger fail_rebuild_ack before update on job for each row execute function fail_rebuild_ack()`;
  const worker = runJobWorkerOnce("rebuild-retry", 1);
  await reachedEmbedding;
  const recovery = recoverInterruptedRestores();
  try {
    const resumed = await Promise.race([
      recovery.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    assert.equal(
      resumed,
      true,
      "重建进行中时另一worker的启动协调不能等待长索引事务",
    );
  } finally {
    embeddingHold = undefined;
    releaseEmbedding();
    await recovery;
    await worker;
    await sql`drop trigger fail_rebuild_ack on job`;
    await sql`drop function fail_rebuild_ack()`;
  }
  assert.equal((await worker).failed, 1, "派生事务已提交，但队列完成回执失败");
  assert.equal(
    (await rebuild.getPostRestoreRebuildSummary(restored.packageId!)).status,
    "SUCCEEDED",
  );
  assert.equal((await sql`select count(*)::int as n from page_chunk`)[0]!.n, 2);
  assert.equal(
    (await sql`select count(*)::int as n from chunk_embedding`)[0]!.n,
    2,
  );
  assert.equal(await getSettingRaw("knowledge.active_generation"), 2);
  const [completedRecord] = await db
    .select()
    .from(tables.systemRestore)
    .where(eq(tables.systemRestore.id, restored.id));
  assert.ok(completedRecord!.rebuildCompletedAt, "完成证明与派生数据一同提交");
  const [completedJob] = await db
    .select()
    .from(tables.job)
    .where(eq(tables.job.id, completedRecord!.rebuildJobId!));
  assert.equal(
    completedJob!.status,
    "DEAD",
    "真实队列确认失败后仍有独立提交证明",
  );
  const usageBefore =
    await sql`select embedding_tokens,embedding_calls from ai_usage_counter where member_id=${admin!.id} order by period`;
  const callsAtCommit = embeddingCalls;
  await getJobHandler("restore.rebuild")!(
    { packageId: restored.packageId! },
    completedJob!,
  );
  await rebuild.retryPostRestoreRebuilds(restored.packageId!);
  await rebuild.enqueuePostRestoreRebuilds(restored.packageId!);
  assert.equal(
    embeddingCalls,
    callsAtCommit,
    "提交后重入不能再次调用向量供应方",
  );
  assert.deepEqual(
    await sql`select embedding_tokens,embedding_calls from ai_usage_counter where member_id=${admin!.id} order by period`,
    usageBefore,
  );
  assert.equal(await getSettingRaw("knowledge.active_generation"), 2);
  assert.equal((await sql`select count(*)::int as n from page_chunk`)[0]!.n, 2);
  const knowledge = await import("../src/server/services/knowledge.service.ts");
  const restoredActor = (await loadActor(admin!.id))!;
  for (let index = 0; index < pageIds.length; index++) {
    const word = ["AlphaUnique", "BetaUnique"][index]!;
    const hits = await knowledge.searchKnowledge(
      restoredActor,
      project!.id,
      word,
    );
    assert.ok(JSON.stringify(hits).includes(pageIds[index]!));
  }
  assert.equal(
    (
      await sql`select count(*)::int as n from metric_snapshot where iteration_id=${iteration!.id}`
    )[0]!.n,
    1,
  );
  await rebuild.enqueuePostRestoreRebuilds(restored.packageId!);
  assert.equal(
    (
      await sql`select count(*)::int as n from job where kind='restore.rebuild'`
    )[0]!.n,
    2,
  );
  assert.ok(embeddingCalls >= 3);
  assert.ok(cookie);
  await app.close();
  app = undefined;

  targetKey.fill(0);
  targetKey = await emptyTarget("safe-target");
  const safeRestored = await restore("safe");
  for (const table of [
    "api_token",
    "scim_token",
    "two_factor_secret",
    "mcp_client",
    "mcp_tool_policy",
    "integration",
    "webhook_endpoint",
  ])
    assert.equal(
      (await sql`select count(*)::int as n from ${sql(table)}`)[0]!.n,
      0,
    );
  for (const [table, flag] of [
    ["ai_provider_config", "is_active"],
    ["idp_config", "enabled"],
    ["im_channel", "enabled"],
  ])
    assert.equal(
      (await sql`select ${sql(flag!)} as active from ${sql(table!)}`)[0]!
        .active,
      false,
    );
  assert.equal(await getSettingRaw("smtp.password"), null);
  assert.equal(await getSettingRaw("storage.kind"), "local");
  assert.equal(await getSettingRaw("storage.s3.bucket"), null);
  const callsBefore = embeddingCalls;
  assert.equal((await runJobWorkerOnce("safe-rebuild", 1)).succeeded, 1);
  assert.equal(
    (await rebuild.getPostRestoreRebuildSummary(safeRestored.packageId!))
      .status,
    "SUCCEEDED",
  );
  assert.equal(embeddingCalls, callsBefore);
  assert.equal((await sql`select count(*)::int as n from page_chunk`)[0]!.n, 2);
  assert.equal(
    (await sql`select count(*)::int as n from chunk_embedding`)[0]!.n,
    0,
  );
  console.log(
    "full迁移E2E通过：真实加密导出/恢复、原凭据鉴权、目标换钥、safe停用、失败后真实重建重试和多页检索",
  );
} finally {
  sourceKey?.fill(0);
  targetKey?.fill(0);
  globalThis.fetch = originalFetch;
  await app?.close();
  await sql.end();
}
