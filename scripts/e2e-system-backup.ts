import "./_env.ts";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { join } from "node:path";
import type { SystemBackupManifest } from "../src/shared/schemas/system-backup.ts";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import * as t from "../src/db/schema.ts";
import { hashPassword, verifyPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { createToken } from "../src/server/services/token.service.ts";
import * as scim from "../src/server/services/scim.service.ts";
import * as twoFactor from "../src/server/services/two-factor.service.ts";
import { base32Decode, totp } from "../src/server/lib/totp.ts";
import {
  masterKey,
  encryptSecret,
  encryptSecretWithKey,
  decryptSecret,
  decryptSecretWithKey,
} from "../src/server/services/crypto.service.ts";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { createEncryptionEnvelope } from "../src/server/services/system-backup/crypto.ts";
import { exportSystemBackup } from "../src/server/services/system-backup/exporter.ts";
import { writeTemporaryKeyHandle } from "../src/server/services/system-backup/storage.ts";
import { authenticateAndReadManifest } from "../src/server/services/system-backup/restore-archive.ts";
import { localRestoreAuditPredicate } from "../src/server/services/system-backup/validator.ts";
import { buildApp } from "../src/server/app.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import {
  backupFixture,
  fixturePassword,
} from "../tests/support/system-backup-fixture.ts";
import {
  createIsolatedDatabase,
  prepareDatabase,
  runNode,
} from "../tests/support/isolated-database.ts";

if (
  !process.env.FERONAVI_TEST_DIRECTORY ||
  !process.env.FERONAVI_TEST_DATABASE ||
  new URL(process.env.DATABASE_URL!).pathname !==
    `/${process.env.FERONAVI_TEST_DATABASE}`
)
  throw new Error("必须经隔离runner执行");

const password = "cross-db-migration-password-123";
const loginPassword = "synthetic-admin-password-123";
// m=1小于Argon2最低内存要求：形状满足v1导入不变量，但任何密码验证都会失败。
const unusableFixtureHash =
  "$argon2id$v=19$m=1,t=1,p=1$Zml4dHVyZS1zYWx0$Zml4dHVyZS1pbXBvc3NpYmxlLWhhc2g";
const blob = Buffer.from("Synthetic cross-database attachment v1\n");
const blobHash = createHash("sha256").update(blob).digest("hex");
const [phase = "orchestrate", shared = process.env.FERONAVI_TEST_DIRECTORY!] =
  process.argv.slice(2);
type Rows = Record<string, Record<string, unknown>[]>;
type Scenario = {
  rows: Record<"safe" | "full", Rows>;
  sourceKey: string;
  token: string;
  scimToken: string;
  totpSecret: string;
  adminId: string;
  manifests: Record<string, SystemBackupManifest>;
};
const dataFile = join(shared, "scenario.json");
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
let stage = phase;

// 只记录阶段、错误类别、SQLSTATE；绝不输出query、参数、行或异常message。
function diagnostic(error: unknown) {
  const e = error as {
    name?: string;
    code?: string;
    cause?: unknown;
    table_name?: string;
    column_name?: string;
  };
  console.error(
    JSON.stringify({
      stage,
      category: /^[A-Za-z]+$/.test(e?.name ?? "") ? e.name : "Error",
      code: /^(?:[A-Z0-9_]{3,40})$/.test(e?.code ?? "")
        ? e.code
        : "UNCLASSIFIED",
      table: /^[a-z_]+$/.test(e?.table_name ?? "") ? e.table_name : undefined,
      column: /^[a-z_]+$/.test(e?.column_name ?? "")
        ? e.column_name
        : undefined,
    }),
  );
  if (e?.cause && e.cause !== error) diagnostic(e.cause);
}

async function snapshot(mode: "safe" | "full"): Promise<Rows> {
  const result: Rows = {};
  for (const dataset of orderedDatasets(mode)) {
    result[dataset.name] = (await sql`select * from ${sql(dataset.tableName)}`)
      .map((row) => dataset.encodeRow(row, { mode, purpose: "migration" }))
      .filter((row): row is Record<string, unknown> => row !== null);
  }
  return json(result);
}

async function assertAuditPreserved(baseline: Record<string, unknown>[]) {
  const after = json(await sql`select * from audit_entry`) as Record<
    string,
    unknown
  >[];
  const existing = new Set(baseline.map((row) => row.id));
  for (const before of baseline) {
    const row = after.find((candidate) => candidate.id === before.id);
    assert.ok(
      row && JSON.stringify(row) === JSON.stringify(before),
      "本地审计ID及全部字段必须原样保留",
    );
  }
  const allowed = new Set(
    (
      await sql`select a.id from audit_entry a where ${localRestoreAuditPredicate()}`
    ).map((row) => row.id),
  );
  for (const row of after)
    if (!existing.has(row.id))
      assert.ok(
        allowed.has(row.id),
        "新增审计必须符合严格本地恢复安全审计谓词",
      );
}

async function seedLocalAuditBaseline() {
  const [record] = await db
    .insert(t.systemRestore)
    .values({
      uploadPath: join(shared, "synthetic-unused"),
      ownerSessionHash: "a".repeat(64),
    })
    .returning();
  await db.insert(t.auditEntry).values({
    actorId: null,
    actorSnapshot: "setup",
    severity: "SECURITY",
    action: "system_restore.uploaded",
    targetType: "system_restore",
    targetId: record!.id,
  });
  return json(await sql`select * from audit_entry`) as Record<
    string,
    unknown
  >[];
}

async function auditGuardCheck() {
  const baseline = await seedLocalAuditBaseline();
  const auditId = baseline[0]!.id as string;
  await assertAuditPreserved(baseline);
  await db
    .update(t.auditEntry)
    .set({ actorSnapshot: "tampered" })
    .where(eq(t.auditEntry.id, auditId));
  await assert.rejects(
    assertAuditPreserved(baseline),
    { code: "ERR_ASSERTION" },
    "同ID字段改写必须被拒绝",
  );
  await db
    .update(t.auditEntry)
    .set({ actorSnapshot: "setup" })
    .where(eq(t.auditEntry.id, auditId));
  await db.insert(t.auditEntry).values({
    actorSnapshot: "synthetic",
    severity: "BUSINESS",
    action: "project.created",
    targetType: "PROJECT",
  });
  await assert.rejects(
    assertAuditPreserved(baseline),
    { code: "ERR_ASSERTION" },
    "额外业务审计必须被拒绝",
  );
  await sql`delete from audit_entry where severity='BUSINESS'`;
  const [actor] = await db
    .insert(t.member)
    .values({
      username: "audit_guard_actor",
      name: "Synthetic audit actor",
      status: "ACTIVE",
      passwordHash: "!",
    })
    .returning();
  const rollback = new Error("synthetic audit mutation rollback");
  for (const [name, change] of [
    ["unlinked target", { targetId: randomUUID() }],
    ["unexpected actor", { actorId: actor!.id }],
    ["unexpected IP", { ip: "127.0.0.1" }],
    [
      "invalid error shape",
      {
        action: "system_restore.failed",
        changes: { errorCode: "INVALID_BACKUP", extra: true },
      },
    ],
  ] as const) {
    try {
      await db.transaction(async () => {
        await db.insert(t.auditEntry).values(
          Object.assign(
            {
              actorSnapshot: "setup",
              severity: "SECURITY",
              action: "system_restore.uploaded",
              targetType: "system_restore",
              targetId: baseline[0]!.target_id as string,
            },
            change,
          ),
        );
        await assert.rejects(
          assertAuditPreserved(baseline),
          { code: "ERR_ASSERTION" },
          name,
        );
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  await db.insert(t.auditEntry).values({
    actorSnapshot: "setup",
    severity: "SECURITY",
    action: "system_restore.failed",
    targetType: "system_restore",
    targetId: baseline[0]!.target_id as string,
    changes: { errorCode: "INVALID_BACKUP" },
  });
  await assertAuditPreserved(baseline);
  console.log(
    "PASS audit guard: same-ID mutation/business leakage/unlinked target/actor/IP/error-shape rejected; strict local failed audit accepted",
  );
}

async function seedMigrationScenario() {
  await db
    .insert(t.organization)
    .values({ name: "Synthetic migration organization" });
  const members = await db
    .insert(t.member)
    .values([
      {
        username: "migration_admin",
        name: "Synthetic Admin",
        email: "admin@example.invalid",
        status: "ACTIVE",
        passwordHash: await hashPassword(loginPassword),
      },
      {
        username: "migration_member",
        name: "Synthetic Member",
        email: "member@example.invalid",
        status: "ACTIVE",
        passwordHash: await hashPassword(loginPassword),
      },
    ])
    .returning();
  const admin = members[0]!;
  for (const [index, roleKey] of ["ADMIN", "MEMBER"].entries()) {
    const [role] = await db
      .select()
      .from(t.role)
      .where(eq(t.role.key, roleKey));
    await db.insert(t.roleAssignment).values({
      memberId: members[index]!.id,
      roleId: role!.id,
      scopeType: "ORG",
    });
  }
  const [project] = await db
    .insert(t.project)
    .values({ key: "MIGRATE", name: "Synthetic project", createdBy: admin.id })
    .returning();
  const [workflow] = await db
    .insert(t.workflow)
    .values({
      projectId: project!.id,
      name: "Synthetic workflow",
      appliesToType: "TASK",
      isDefault: true,
    })
    .returning();
  const states = await db
    .insert(t.workflowState)
    .values([
      {
        workflowId: workflow!.id,
        key: "OPEN",
        name: "Open",
        category: "NOT_STARTED",
        color: "neutral",
      },
      {
        workflowId: workflow!.id,
        key: "DONE",
        name: "Done",
        category: "TERMINAL",
        color: "neutral",
      },
    ])
    .returning();
  await db.insert(t.workflowTransition).values({
    workflowId: workflow!.id,
    fromStateId: states[0]!.id,
    toStateId: states[1]!.id,
    requiresApproval: true,
    approverRoleKeys: ["ADMIN"],
  });
  const [milestone] = await db
    .insert(t.milestone)
    .values({
      projectId: project!.id,
      name: "Synthetic milestone",
      dueDate: "2026-12-01",
    })
    .returning();
  const [iteration] = await db
    .insert(t.iteration)
    .values({
      projectId: project!.id,
      name: "Synthetic iteration",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    })
    .returning();
  let parentId: string | undefined;
  for (let number = 1; number <= 3; number++) {
    const [item] = await db
      .insert(t.workItem)
      .values({
        projectId: project!.id,
        number,
        key: `MIGRATE-${number}`,
        type: "TASK",
        title: `Synthetic work item ${number}`,
        description: "Stable content",
        workflowId: workflow!.id,
        statusId: states[0]!.id,
        reporterId: admin.id,
        assigneeId: members[1]!.id,
        parentId: number === 2 ? parentId : null,
        milestoneId: milestone!.id,
        iterationId: iteration!.id,
      })
      .returning();
    if (number === 1) parentId = item!.id;
  }
  await db.insert(t.comment).values({
    targetType: "WORK_ITEM",
    targetId: parentId!,
    authorId: members[1]!.id,
    body: "Synthetic comment",
  });
  const [page] = await db
    .insert(t.page)
    .values({
      projectId: project!.id,
      title: "Synthetic knowledge",
      slug: "synthetic-knowledge",
    })
    .returning();
  for (const revisionNo of [1, 2]) {
    const [revision] = await db
      .insert(t.pageRevision)
      .values({
        pageId: page!.id,
        revisionNo,
        content: `# Synthetic document\nRevision ${revisionNo}`,
        authorId: admin.id,
      })
      .returning();
    await db
      .update(t.page)
      .set({ currentRevisionId: revision!.id })
      .where(eq(t.page.id, page!.id));
  }
  await fs.mkdir(join(process.env.DATA_DIR!, "attachments"), {
    recursive: true,
  });
  await fs.writeFile(
    join(process.env.DATA_DIR!, "attachments", "synthetic.txt"),
    blob,
  );
  await db.insert(t.attachment).values({
    targetType: "WORK_ITEM",
    targetId: parentId!,
    uploaderId: admin.id,
    originalName: "synthetic.txt",
    storagePath: "synthetic.txt",
    mimeType: "text/plain",
    sizeBytes: blob.length,
    contentHash: blobHash,
  });
  await db.insert(t.approvalRequest).values({
    workItemId: parentId!,
    workflowId: workflow!.id,
    fromStateId: states[0]!.id,
    toStateId: states[1]!.id,
    requestedBy: members[1]!.id,
    approverRoleKeys: ["ADMIN"],
  });
  await db.insert(t.automationRule).values({
    projectId: project!.id,
    name: "Synthetic automation",
    trigger: "WORK_ITEM_CREATED",
    actions: [],
    createdBy: admin.id,
  });
  const [policy] = await db
    .insert(t.slaPolicy)
    .values({
      projectId: project!.id,
      name: "Synthetic SLA",
      responseMinutes: 30,
      resolveMinutes: 60,
    })
    .returning();
  await db.insert(t.workItemSla).values({
    workItemId: parentId!,
    policyId: policy!.id,
    responseDueAt: new Date("2026-11-20T00:00:00Z"),
    resolveDueAt: new Date("2026-11-21T00:00:00Z"),
  });
  await db.insert(t.auditEntry).values({
    actorId: admin.id,
    actorSnapshot: "synthetic",
    severity: "BUSINESS",
    action: "project.created",
    targetType: "PROJECT",
    targetId: project!.id,
  });
  const actor = (await loadActor(admin.id))!;
  const token = await createToken(actor, {
    name: "Synthetic API",
    tier: "ADMIN",
  });
  const scimToken = await scim.createToken(actor, "Synthetic SCIM");
  const factor = await twoFactor.setup(admin.id, {
    account: "migration_admin",
  });
  const secret = factor.otpauthUrl.match(/secret=([A-Z2-7]+)/)![1]!;
  await twoFactor.activate(admin.id, totp(base32Decode(secret)));
  await db.insert(t.mcpClient).values({
    tokenId: token.row.id,
    clientName: "synthetic-client",
    clientVersion: "1.0",
  });
  await db.insert(t.mcpToolPolicy).values({
    tokenId: token.row.id,
    toolName: "workitem.create",
    effect: "DENY",
    argConstraints: { project: "synthetic" },
  });
  await db.insert(t.setting).values([
    {
      key: "smtp.password",
      value: encryptSecret("synthetic-smtp-secret"),
      isSecret: true,
    },
    { key: "ai.enabled", value: false, isSecret: false },
  ]);
  await db.insert(t.aiProviderConfig).values({
    provider: "OPENAI_COMPAT",
    baseUrl: "https://provider.example.invalid/v1",
    model: "synthetic",
    embeddingModel: "synthetic",
    apiKeyEncrypted: encryptSecret("synthetic-ai-secret"),
  });
  await db.insert(t.webhookEndpoint).values({
    name: "Synthetic hook",
    url: "https://hook.example.invalid",
    secretEncrypted: encryptSecret("synthetic-hook-secret"),
    events: [],
  });
  await db.insert(t.idpConfig).values({
    kind: "OIDC",
    issuer: "https://idp.example.invalid",
    clientId: "synthetic",
    clientSecretEncrypted: encryptSecret("synthetic-sso-secret"),
    enabled: true,
  });
  await db.insert(t.imChannel).values({
    name: "Synthetic IM",
    provider: "DINGTALK",
    webhookUrlEncrypted: encryptSecret("https://im.example.invalid"),
    appKeyEncrypted: encryptSecret("synthetic-im-key"),
    appSecretEncrypted: encryptSecret("synthetic-im-secret"),
  });
  // 故意存在的源会话与任务必须排除；真实登录也在导出前产生会话。
  await db.insert(t.setupState).values({ initializedAt: new Date() });
  const app = await buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "migration_admin",
        password: loginPassword,
        totpCode: totp(base32Decode(secret)),
      },
    });
    assert.equal(response.statusCode, 200, "源实例真实登录失败");
  } finally {
    await app.close();
  }
  await db
    .insert(t.job)
    .values({ kind: "synthetic.source-only", payload: { synthetic: true } });
  assert.ok((await sql`select count(*)::int n from session`)[0]!.n > 0);
  const scenario: Scenario = {
    rows: { safe: await snapshot("safe"), full: await snapshot("full") },
    sourceKey: masterKey().toString("hex"),
    token: token.token,
    scimToken: scimToken.token,
    totpSecret: secret,
    adminId: admin.id,
    manifests: {},
  };
  for (const mode of ["safe", "full"] as const) {
    stage = `source.export.${mode}`;
    const backupId = randomUUID();
    const { dataKey, keyEnvelope } = await createEncryptionEnvelope(password);
    try {
      const handle = await writeTemporaryKeyHandle(backupId, dataKey);
      const exported = await exportSystemBackup({
        backupId,
        mode,
        requestedBy: admin.id,
        dataKeyHandle: handle.handle,
        keyEnvelope,
      });
      await fs.copyFile(exported.packagePath, join(shared, `${mode}.fnbak`));
      const verified = await authenticateAndReadManifest(
        exported.packagePath,
        password,
      );
      scenario.manifests[mode] = verified.manifest;
      verified.dataKey.fill(0);
    } finally {
      dataKey.fill(0);
    }
  }
  await fs.writeFile(dataFile, JSON.stringify(scenario), { mode: 0o600 });
  console.log(
    "PASS source: 2 members, 3 work items, workflow/parent/comment/page revisions/blob/planning/approval/automation/SLA/audit/security; real login; safe/full export",
  );
}

async function readScenario(): Promise<Scenario> {
  return JSON.parse(await fs.readFile(dataFile, "utf8"));
}

async function generateFixtures() {
  const source = await readScenario();
  const directory = join(process.cwd(), "scripts", "fixtures");
  await fs.mkdir(directory, { recursive: true });
  const id = (n: number) =>
    `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (const mode of ["safe", "full"] as const) {
    const rows: Rows = {};
    const original = source.rows[mode];
    rows["identity.organization"] = [
      {
        ...original["identity.organization"]![0],
        id: id(1),
        name: "Fixture organization",
      },
    ];
    rows["identity.member"] = [
      {
        ...original["identity.member"]![0],
        id: id(2),
        username: "fixture_unusable",
        name: "Fixture account",
        email: "fixture@example.invalid",
        password_hash: unusableFixtureHash,
        last_login_at: null,
      },
    ];
    const role = original["identity.role"]!.find((row) => row.key === "ADMIN")!;
    rows["identity.role"] = [{ ...role, id: id(3) }];
    rows["identity.role_assignment"] = [
      {
        id: id(4),
        member_id: id(2),
        role_id: id(3),
        scope_type: "ORG",
        scope_id: null,
      },
    ];
    if (mode === "full") {
      rows["security.api_token"] = [
        {
          ...original["security.api_token"]![0],
          id: id(5),
          member_id: id(2),
          token_hash: "not-a-valid-token-hash",
          token_prefix: "fixture_invalid",
          last_used_at: null,
        },
      ];
      rows["operations.setting"] = [
        {
          key: "smtp.password",
          value: encryptSecretWithKey("fixture-secret", Buffer.alloc(32, 7)),
          is_secret: true,
          updated_at: "2026-11-14T00:00:00.000Z",
        },
      ];
    }
    // 每个时间戳固定；包内UUID固定。随机salt/nonce只在显式生成时产生，测试绝不重新生成。
    for (const entries of Object.values(rows))
      for (const row of entries)
        for (const key of Object.keys(row))
          if (key.endsWith("_at") && row[key] !== null)
            row[key] = "2026-11-14T00:00:00.000Z";
    const fixture = await backupFixture(shared, {
      mode,
      datasetRows: rows,
      sourceMasterKey: Buffer.alloc(32, 7),
      manifest: {
        packageId: id(mode === "safe" ? 6 : 7),
        sourceBuild: "v1-compatibility-fixed",
      },
    });
    await fs.copyFile(
      fixture.path,
      join(directory, `system-backup-v1-${mode}.fnbak`),
    );
  }
  console.log(
    "PASS generated synthetic fixed v1 fixtures (explicit generator only)",
  );
}

async function restoreTarget(
  mode: "safe" | "full",
  failure?: string,
  compatibility = false,
) {
  const scenario = await readScenario();
  const app = await buildApp({ logger: false });
  registerBuiltinJobHandlers();
  const reserve = sql.reserve;
  let injected = false;
  sql.reserve = (async (...args: Parameters<typeof reserve>) => {
    const connection = await reserve(...args);
    return new Proxy(connection, {
      get(target, property) {
        if (property === "unsafe")
          return (...query: Parameters<typeof connection.unsafe>) => {
            try {
              if (
                failure === "interruption" &&
                query[0].startsWith('insert into "work_item"')
              ) {
                injected = true;
                throw Object.assign(new Error("synthetic interruption"), {
                  code: "57014",
                });
              }
              const pending = connection.unsafe(...query);
              void pending.catch((error) => diagnostic(error));
              return pending;
            } catch (error) {
              diagnostic(error);
              throw error;
            }
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof reserve;
  const originalRename = fs.rename;
  const originalStatfs = fs.statfs;
  let occupiedProject: string | undefined;
  let restoreId: string | undefined;
  const originalAudits = await seedLocalAuditBaseline();
  let failureBaseline = await snapshot("full");
  const count = async (table: string) =>
    Number((await sql`select count(*)::int n from ${sql(table)}`)[0]!.n);
  const empty = async () => {
    assert.equal(
      (
        await sql`select count(*)::int n from setup_state where initialized_at is not null`
      )[0]!.n,
      0,
    );
    for (const name of [
      "organization",
      "member",
      "work_item",
      "page",
      "attachment",
      "approval_request",
      "automation_rule",
      "sla_policy",
    ])
      assert.equal(
        await count(name),
        occupiedProject && name === "member" ? 1 : 0,
        `${failure}: ${name}必须保持基线`,
      );
    assert.equal(await count("project"), occupiedProject ? 1 : 0);
    const after = await snapshot("full");
    for (const dataset of orderedDatasets("full")) {
      if (dataset.tableName === "audit_entry") {
        await assertAuditPreserved(originalAudits);
        continue;
      }
      const stable = (rows: Record<string, unknown>[]) =>
        rows
          .map((row) => JSON.stringify(row))
          .sort()
          .join("\n");
      assert.ok(
        stable(after[dataset.name]!) === stable(failureBaseline[dataset.name]!),
        `${failure}: ${dataset.name}必须原样保留基线`,
      );
    }
  };
  try {
    let archive = compatibility
      ? join(
          process.cwd(),
          "scripts",
          "fixtures",
          `system-backup-v1-${mode}.fnbak`,
        )
      : join(shared, `${mode}.fnbak`);
    let migrationPassword = compatibility ? fixturePassword : password;
    if (
      [
        "ciphertext",
        "missing-blob",
        "manifest-count",
        "future-version",
      ].includes(failure ?? "")
    ) {
      // 基于同一JSONL顺序先建立正确metadata，再只改count；避免其他hash差异掩盖该用例。
      const manifest =
        failure === "manifest-count"
          ? (
              await backupFixture(process.env.DATA_DIR!, {
                datasetRows: scenario.rows.safe,
                blobContents: [blob],
              })
            ).manifest
          : json(scenario.manifests.safe);
      if (failure === "manifest-count") manifest.datasets[0].rows++;
      const corrupted = await backupFixture(process.env.DATA_DIR!, {
        datasetRows: scenario.rows.safe,
        blobContents: failure === "missing-blob" ? [] : [blob],
        tamper: failure === "ciphertext",
        manifest:
          failure === "manifest-count"
            ? { datasets: manifest.datasets }
            : failure === "missing-blob"
              ? { blobs: manifest.blobs }
              : {},
        header: failure === "future-version" ? { formatVersion: 2 } : undefined,
      });
      archive = corrupted.path;
      migrationPassword = fixturePassword;
    }
    const keyBefore = Buffer.from(masterKey());
    assert.notEqual(keyBefore.toString("hex"), scenario.sourceKey);
    stage = `${phase}.bootstrap`;
    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/setup/restore/bootstrap",
    });
    assert.equal(boot.statusCode, 200);
    const headers = {
      cookie: boot.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
      "csrf-token": boot.json().csrfToken,
    };
    const request = async (
      suffix: string,
      payload: Record<string, unknown>,
    ) => {
      stage = `${phase}.${suffix}`;
      return app.inject({
        method: "POST",
        url: `/api/v1/setup/restore/${restoreId}/${suffix}`,
        headers,
        payload,
      });
    };
    stage = `${phase}.upload`;
    const boundary = "synthetic-system-backup";
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/setup/restore/upload",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="migration.fnbak"\r\n\r\n`,
        ),
        await fs.readFile(archive),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    if (failure === "future-version") {
      assert.equal(upload.json().code, "INCOMPATIBLE_BACKUP");
      await empty();
      console.log(
        `PASS failure ${failure}: upload rejected, target remains empty`,
      );
      return;
    }
    assert.equal(upload.statusCode, 200, "上传失败");
    restoreId = upload.json().id as string;
    if (failure === "occupied-target") {
      const [owner] = await db
        .insert(t.member)
        .values({
          username: "local_owner",
          name: "Local owner",
          status: "ACTIVE",
          passwordHash: "not-a-valid-local-password-hash",
        })
        .returning();
      const [project] = await db
        .insert(t.project)
        .values({
          key: "LOCAL",
          name: "Preexisting local project",
          createdBy: owner!.id,
        })
        .returning();
      occupiedProject = project!.id;
      failureBaseline = await snapshot("full");
    }
    if (failure === "disk-limit") {
      fs.statfs = (async (...args: Parameters<typeof fs.statfs>) => ({
        ...(await originalStatfs(...args)),
        bavail: 0,
      })) as typeof fs.statfs;
      syncBuiltinESMExports();
      injected = true;
    }
    const preflight = await request("preflight", {
      migrationPassword:
        failure === "wrong-password"
          ? "synthetic-wrong-password"
          : migrationPassword,
    });
    const early = [
      "wrong-password",
      "ciphertext",
      "missing-blob",
      "manifest-count",
      "occupied-target",
      "disk-limit",
    ].includes(failure ?? "");
    if (early) {
      const wanted =
        failure === "occupied-target"
          ? "TARGET_NOT_EMPTY"
          : failure === "disk-limit"
            ? "INSUFFICIENT_STORAGE"
            : "INVALID_BACKUP";
      assert.equal(
        preflight.json().code,
        wanted,
        `${failure} 必须在preflight拒绝`,
      );
      await empty();
      if (occupiedProject)
        assert.equal(
          (await sql`select id from project`)[0]!.id,
          occupiedProject,
          "既有项目必须保留",
        );
      console.log(
        `PASS failure ${failure}: preflight ${wanted}; no imported business rows; local history preserved`,
      );
      return;
    }
    assert.equal(preflight.statusCode, 200, "预检失败");
    const auditBeforeConfirm = json(
      await sql`select * from audit_entry`,
    ) as Record<string, unknown>[];
    const baselineAudits = auditBeforeConfirm.map((row) => row.id);
    const confirm = await request("confirm", {
      migrationPassword,
      confirmation: "恢复此实例",
    });
    if (confirm.statusCode !== 200) {
      diagnostic({ name: "DomainError", code: confirm.json().code });
      assert.equal(
        confirm.statusCode,
        200,
        `确认失败（${confirm.json().code}）`,
      );
    }
    const localJobs = (await sql`select id from job`).map((row) => row.id);
    if (failure === "rename-failure")
      fs.rename = async (from, to) => {
        if (String(to).includes("/attachments/restored/")) {
          injected = true;
          throw Object.assign(new Error("synthetic rename failure"), {
            code: "EACCES",
          });
        }
        return originalRename(from, to);
      };
    stage = `${phase}.worker.import`;
    const result = await runJobWorkerOnce(`cross-db-${mode}`, 1);
    if (failure) {
      assert.equal(result.failed, 1);
      assert.equal(injected, true, "故障必须实际触发");
      await empty();
      const [restored] =
        await sql`select status,last_error from system_restore where id=${restoreId!}`;
      assert.equal(restored!.status, "FAILED");
      assert.match(restored!.last_error, /^RESTORE_FAILED:/);
      const promoted = join(
        process.env.DATA_DIR!,
        "attachments",
        "restored",
        scenario.manifests.safe!.packageId,
      );
      await assert.rejects(fs.stat(promoted), { code: "ENOENT" });
      await assert.rejects(
        fs.stat(join(process.env.DATA_DIR!, "system-restores", restoreId!)),
        { code: "ENOENT" },
      );
      await assertAuditPreserved(auditBeforeConfirm);
      console.log(
        `PASS failure ${failure}: actual worker rollback, no business rows or promoted blobs; local jobs/audit retained`,
      );
      return;
    }
    assert.equal(result.succeeded, 1, "恢复worker失败；见脱敏阶段/类别诊断");
    const [restored] =
      await sql`select status,package_id from system_restore where id=${restoreId!}`;
    assert.equal(restored!.status, "SUCCEEDED");
    assert.deepEqual(
      await fs.readFile(join(process.env.DATA_DIR!, "master.key")),
      keyBefore,
    );
    assert.equal(await count("session"), 0, "源会话不得迁移");
    assert.equal(
      (
        await sql`select count(*)::int n from job where kind='synthetic.source-only'`
      )[0]!.n,
      0,
    );
    // 成功目标额外含源业务审计，仍逐字段证明所有本地基线未改写。
    const allAudits = json(await sql`select * from audit_entry`) as Record<
      string,
      unknown
    >[];
    for (const before of auditBeforeConfirm)
      assert.ok(
        allAudits.some(
          (row) =>
            row.id === before.id &&
            JSON.stringify(row) === JSON.stringify(before),
        ),
        "成功恢复保留本地审计全部字段",
      );
    for (const id of localJobs)
      assert.equal(
        (await sql`select count(*)::int n from job where id=${id}`)[0]!.n,
        1,
      );
    assert.equal(
      (
        await sql`select count(*)::int n from job where kind='restore.rebuild'`
      )[0]!.n,
      1,
    );
    if (compatibility) {
      assert.equal(await count("member"), 1);
      assert.equal(
        (await sql`select password_hash from member`)[0]!.password_hash,
        unusableFixtureHash,
      );
      assert.equal(
        await verifyPassword(unusableFixtureHash, loginPassword),
        false,
      );
      assert.equal(
        (await sql`select id from member`)[0]!.id,
        "10000000-0000-4000-8000-000000000002",
      );
      assert.equal(
        (await sql`select id from organization`)[0]!.id,
        "10000000-0000-4000-8000-000000000001",
      );
      if (mode === "full")
        assert.equal(
          (await sql`select token_hash from api_token`)[0]!.token_hash,
          "not-a-valid-token-hash",
        );
      if (mode === "full")
        assert.equal(
          decryptSecret(
            (await sql`select value from setting where key='smtp.password'`)[0]!
              .value,
          ),
          "fixture-secret",
        );
      console.log(
        `PASS fixed v1 ${mode}: committed archive imported by current reader; synthetic IDs/hash/secret retained`,
      );
      return;
    }
    stage = `${phase}.compare`;
    const actual = await snapshot(mode);
    let datasetsCompared = 0,
      rowsCompared = 0,
      fieldsCompared = 0;
    const sourceKey = Buffer.from(scenario.sourceKey, "hex");
    for (const dataset of orderedDatasets(mode)) {
      stage = `${phase}.compare.${dataset.name}`;
      let expected = scenario.rows[mode][dataset.name]!;
      let target = actual[dataset.name]!;
      if (dataset.tableName === "audit_entry") {
        const ids = new Set(expected.map((row) => row.id));
        target = target.filter((row) => ids.has(row.id));
        assert.equal(
          await count("audit_entry"),
          expected.length + baselineAudits.length + 2,
          "源审计+本地预检审计+started/completed",
        );
      }
      if (dataset.tableName === "attachment")
        expected = expected.map((row) => ({
          ...row,
          storage_backend: "local",
          storage_path: `restored/${restored!.package_id}/${row.content_hash}`,
        }));
      // 重加密字段比较明文等价和目标key归属；其他字段（含不可逆hash）逐字段原样比较。
      const normalize = (rows: Record<string, unknown>[], source: boolean) =>
        rows
          .map((input) => {
            const row = { ...input };
            for (const column of dataset.rewrapColumns)
              if (
                (dataset.tableName !== "setting" || row.is_secret === true) &&
                typeof row[column] === "string" &&
                row[column]
              ) {
                if (!source)
                  assert.throws(() =>
                    decryptSecretWithKey(row[column] as string, sourceKey),
                  );
                row[column] = source
                  ? decryptSecretWithKey(row[column] as string, sourceKey)
                  : decryptSecret(row[column] as string);
              }
            return row;
          })
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const a = normalize(expected, true),
        b = normalize(target, false);
      assert.equal(b.length, a.length, `${dataset.name}: count`);
      for (let i = 0; i < a.length; i++) {
        assert.deepEqual(
          Object.keys(b[i]!).sort(),
          Object.keys(a[i]!).sort(),
          `${dataset.name}: columns`,
        );
        for (const column of Object.keys(a[i]!))
          assert.ok(
            JSON.stringify(b[i]![column]) === JSON.stringify(a[i]![column]),
            `${dataset.name}.${column}: stable value mismatch`,
          );
        fieldsCompared += Object.keys(a[i]!).length;
      }
      datasetsCompared++;
      rowsCompared += a.length;
    }
    const [attachment] =
      await sql`select storage_backend,storage_path from attachment`;
    assert.equal(attachment!.storage_backend, "local");
    assert.equal(
      createHash("sha256")
        .update(
          await fs.readFile(
            join(
              process.env.DATA_DIR!,
              "attachments",
              attachment!.storage_path,
            ),
          ),
        )
        .digest("hex"),
      blobHash,
    );
    if (mode === "safe") {
      for (const table of [
        "api_token",
        "scim_token",
        "two_factor_secret",
        "mcp_client",
        "mcp_tool_policy",
      ])
        assert.equal(await count(table), 0);
      assert.equal(
        (await sql`select count(*)::int n from setting where is_secret`)[0]!.n,
        0,
      );
      for (const [table, columns] of [
        ["ai_provider_config", ["api_key_encrypted"]],
        ["webhook_endpoint", ["secret_encrypted"]],
        ["idp_config", ["client_secret_encrypted"]],
        [
          "im_channel",
          [
            "webhook_url_encrypted",
            "app_key_encrypted",
            "app_secret_encrypted",
          ],
        ],
      ] as const)
        for (const column of columns)
          assert.ok(
            (await sql`select ${sql(column)} v from ${sql(table)}`).every(
              (row) => !row.v,
            ),
          );
    }
    stage = `${phase}.auth.http`;
    if (mode === "safe") {
      const tokenProbe = await app.inject({
        method: "POST",
        url: "/api/v1/mcp",
        headers: { authorization: `Bearer ${scenario.token}` },
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "synthetic", version: "1" },
          },
        },
      });
      assert.equal(tokenProbe.statusCode, 401);
    }
    stage = `${phase}.auth.scim`;
    const scimProbe = await app.inject({
      method: "GET",
      url: "/scim/v2/Users",
      headers: { authorization: `Bearer ${scenario.scimToken}` },
    });
    assert.equal(scimProbe.statusCode, mode === "full" ? 200 : 401);
    if (mode === "full") {
      stage = `${phase}.auth.2fa-required`;
      const missingFactor = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "migration_admin", password: loginPassword },
      });
      assert.equal(missingFactor.statusCode, 403);
      assert.equal(missingFactor.json().details.twoFactorRequired, true);
    }
    stage = `${phase}.auth.login`;
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "migration_admin",
        password: loginPassword,
        ...(mode === "full"
          ? { totpCode: totp(base32Decode(scenario.totpSecret)) }
          : {}),
      },
    });
    assert.equal(login.statusCode, 200, "迁移后密码/2FA真实登录失败");
    const authenticated = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: {
        cookie: login.cookies
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; "),
      },
    });
    assert.equal(authenticated.statusCode, 200);
    if (mode === "full") {
      stage = `${phase}.auth.mcp`;
      // MCP raw transport需要真实HTTP socket，Fastify inject不模拟接管后的raw req/res。
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      assert.ok(address && typeof address !== "string");
      const rpc = async (body: unknown) => {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/v1/mcp`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              authorization: `Bearer ${scenario.token}`,
            },
            body: JSON.stringify(body),
          },
        );
        assert.equal(response.status, 200);
        return response.json() as Promise<{ result: { serverInfo: { name: string }; isError?: boolean } }>;
      };
      const initialize = await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "synthetic-client", version: "1.0" },
        },
      });
      assert.equal(initialize.result.serverInfo.name, "feronavi");
      const denied = await rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "workitem.create", arguments: {} },
      });
      assert.equal(denied.result.isError, true);
      assert.match(JSON.stringify(denied.result), /FORBIDDEN/);
    }
    stage = `${phase}.rebuild`;
    const rebuild = await runJobWorkerOnce(`cross-db-rebuild-${mode}`, 1);
    assert.equal(rebuild.succeeded, 1);
    assert.ok((await count("page_chunk")) > 0, "真实重建知识chunk");
    assert.ok((await count("metric_snapshot")) > 0, "真实重建迭代指标");
    console.log(
      `PASS cross-db ${mode}: datasets=${datasetsCompared}, rows=${rowsCompared}, stableFields=${fieldsCompared}, blobHashes=1; IDs/counts/content/security; HTTP login/API/SCIM${mode === "full" ? "/2FA/MCP initialize+DENY/target-key rewrap" : "/credentials excluded"}; real rebuild; local audit/jobs preserved`,
    );
  } finally {
    sql.reserve = reserve;
    fs.rename = originalRename;
    fs.statfs = originalStatfs;
    syncBuiltinESMExports();
    await app.close();
  }
}

async function cancellationCheck(signal?: AbortSignal, resistant = false) {
  signal?.throwIfAborted();
  const marker = join(shared, `cancellation-${randomUUID()}.json`);
  const adminUrl = new URL(process.env.DATABASE_URL!);
  adminUrl.pathname = "/postgres";
  const child = spawn(
    process.execPath,
    [
      "scripts/run-isolated-test.ts",
      "scripts/e2e-system-backup.ts",
      "cancel-orchestrate",
      marker,
    ],
    {
      env: {
        ...process.env,
        TEST_DATABASE_ADMIN_URL: adminUrl.toString(),
        SYSTEM_BACKUP_RESIST_TERM: resistant ? "1" : "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  let resources: { pid: number; name: string; directory: string }[] = [];
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const kill = (pid: number, signal: NodeJS.Signals) => {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const abort = () => kill(child.pid!, "SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const deadline = Date.now() + 60_000;
    while (!resources.length && Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        resources = JSON.parse(await fs.readFile(marker, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!resources.length)
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    stage = "cancellation-check.ready";
    if (resources.length !== 2) {
      console.error("[cancellation-child]", output.slice(-3000));
      assert.equal(resources.length, 2, "外层/内层隔离资源必须已就绪");
    }
    const started = performance.now();
    kill(child.pid!, "SIGTERM");
    const timeout = setTimeout(() => kill(child.pid!, "SIGKILL"), 20_000);
    let code: number | null;
    try {
      code = await exited;
    } finally {
      clearTimeout(timeout);
    }
    stage = "cancellation-check.exit";
    console.log(
      `CANCEL lifecycle: exit=${code}; elapsed=${Math.round(performance.now() - started)}ms; ignoredTERM=${output.includes("TERM_RESISTANT child ignored SIGTERM")}`,
    );
    assert.equal(code, 130, "外层runner取消退出130");
    const elapsed = performance.now() - started;
    assert.ok(
      elapsed < 20_000,
      "内层终止及清理必须在20秒内完成，早于受控外层30秒强杀",
    );
    if (resistant) {
      assert.match(output, /TERM_RESISTANT child ignored SIGTERM/);
      assert.ok(elapsed >= 900, "忽略TERM的子进程必须由1秒强杀宽限结束");
    }
    const names = resources.map((resource) => resource.name);
    const remaining =
      await admin`select datname from pg_database where datname in ${admin(names)}`;
    console.log(
      `CANCEL observation: exit=${code}; remainingDatabases=${remaining.length}`,
    );
    stage = "cancellation-check.databases";
    assert.equal(remaining.length, 0, "SIGTERM必须清理外层及内层数据库");
    for (const resource of resources) {
      await assert.rejects(fs.stat(resource.directory), { code: "ENOENT" });
      assert.throws(
        () => process.kill(resource.pid, 0),
        { code: "ESRCH" },
        "必须等待内层子进程退出",
      );
    }
    assert.match(output, /CLEANED cancellation-child/);
    console.log(
      `PASS cancellation${resistant ? " resistant" : ""}: actual SIGTERM -> outer runner 130; both databases/directories absent; detached child terminated before cleanup; elapsed=${Math.round(elapsed)}ms`,
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    // RED阶段也只清理marker明确登记的本次合成资源，绝不遗留失败探针。
    kill(child.pid!, "SIGTERM");
    const stopTimeout = setTimeout(() => kill(child.pid!, "SIGKILL"), 10_000);
    try {
      await exited;
    } finally {
      clearTimeout(stopTimeout);
    }
    for (const resource of resources) {
      assert.match(resource.name, /^feronavi_test_[a-f0-9]{32}$/);
      assert.ok(
        resource.directory.startsWith(
          join(process.cwd(), ".cache", "isolated-test-"),
        ),
      );
      kill(resource.pid, "SIGKILL");
      await admin.unsafe(
        `DROP DATABASE IF EXISTS "${resource.name}" WITH (FORCE)`,
      );
      await fs.rm(resource.directory, { recursive: true, force: true });
    }
    await admin.end();
    await fs.rm(marker, { force: true });
  }
}

async function cancellationHold() {
  if (process.env.SYSTEM_BACKUP_RESIST_TERM === "1")
    process.on("SIGTERM", () => {
      console.log("TERM_RESISTANT child ignored SIGTERM");
    });
  await sql`select 1`;
  const resources = [
    JSON.parse(process.env.SYSTEM_BACKUP_CANCEL_PARENT!),
    {
      pid: process.pid,
      name: process.env.FERONAVI_TEST_DATABASE!,
      directory: process.env.FERONAVI_TEST_DIRECTORY!,
    },
  ];
  await fs.writeFile(`${shared}.tmp`, JSON.stringify(resources));
  await fs.rename(`${shared}.tmp`, shared);
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
}

async function orchestrate(cancelProbe = false) {
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort();
    process.exitCode = 130;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  // runner刻意不向应用传递管理串；仅从其已验证随机测试库派生同账号postgres管理库。
  const admin = new URL(process.env.DATABASE_URL!);
  admin.pathname = "/postgres";
  const originalAdmin = process.env.TEST_DATABASE_ADMIN_URL;
  process.env.TEST_DATABASE_ADMIN_URL = admin.toString();
  const run = async (name: string, ...args: string[]) => {
    controller.signal.throwIfAborted();
    const isolated = await createIsolatedDatabase(controller.signal);
    try {
      // 受控外层给30秒；内层1秒强杀后须在20秒探针预算内完成close及清理。
      await prepareDatabase(isolated, controller.signal, {
        terminationGraceMs: 1000,
      });
      console.log(`INSTANCE ${name}: ${isolated.name}; independent DATA_DIR`);
      const output = await runNode(
        ["scripts/e2e-system-backup.ts", ...args, shared],
        {
          ...isolated.env,
          SYSTEM_BACKUP_CANCEL_PARENT: JSON.stringify({
            pid: process.pid,
            name: process.env.FERONAVI_TEST_DATABASE!,
            directory: process.env.FERONAVI_TEST_DIRECTORY!,
          }),
        },
        180_000,
        controller.signal,
        { terminationGraceMs: 1000 },
      );
      process.stdout.write(output.stdout);
      process.stderr.write(output.stderr);
    } catch (error) {
      const output = error as { stdout?: string; stderr?: string };
      if (output.stdout) process.stdout.write(output.stdout);
      if (output.stderr) process.stderr.write(output.stderr);
      throw Object.assign(new Error(`隔离阶段失败：${name}`), {
        code: "E2E_FAILED",
      });
    } finally {
      await isolated.cleanup();
      console.log(`CLEANED ${name}: database and DATA_DIR`);
    }
  };
  try {
    if (cancelProbe) {
      await run("cancellation-child", "cancel-hold");
      return;
    }
    await run("audit-guard", "audit-guard-check");
    await run("source", "source");
    if (process.env.GENERATE_SYSTEM_BACKUP_FIXTURES === "1")
      await generateFixtures();
    for (const mode of ["safe", "full"] as const)
      await run(`${mode}-target`, mode);
    for (const failure of [
      "wrong-password",
      "ciphertext",
      "missing-blob",
      "manifest-count",
      "future-version",
      "occupied-target",
      "disk-limit",
      "interruption",
      "rename-failure",
    ])
      await run(`failure-${failure}`, `failure:${failure}`);
    for (const mode of ["safe", "full"] as const)
      await run(`fixed-v1-${mode}`, `compat:${mode}`);
    await cancellationCheck(controller.signal);
    await cancellationCheck(controller.signal, true);
    console.log(
      "PASS system backup acceptance: safe/full cross-database migration; 9 failure cases; 2 committed v1 fixtures; all temporary resources cleaned",
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (originalAdmin === undefined) delete process.env.TEST_DATABASE_ADMIN_URL;
    else process.env.TEST_DATABASE_ADMIN_URL = originalAdmin;
  }
}

try {
  if (phase === "audit-guard-check") await auditGuardCheck();
  else if (phase === "cancellation-check") await cancellationCheck();
  else if (phase === "cancellation-resistant-check")
    await cancellationCheck(undefined, true);
  else if (phase === "cancel-orchestrate") await orchestrate(true);
  else if (phase === "cancel-hold") await cancellationHold();
  else if (phase === "orchestrate") await orchestrate();
  else if (phase === "source") await seedMigrationScenario();
  else if (phase === "safe" || phase === "full") await restoreTarget(phase);
  else if (phase.startsWith("failure:"))
    await restoreTarget("safe", phase.slice(8));
  else if (phase.startsWith("compat:"))
    await restoreTarget(phase.slice(7) as "safe" | "full", undefined, true);
  else throw new Error("未知验收阶段");
} catch (error) {
  diagnostic(error);
  if (process.exitCode !== 130) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
