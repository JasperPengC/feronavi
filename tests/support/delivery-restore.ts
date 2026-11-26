import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { backupFixture } from "./system-backup-fixture.ts";
import { manifestSchema } from "../../src/shared/schemas/system-backup.ts";
import { orderedDatasets } from "../../src/server/services/system-backup/registry.ts";
import { importDatasets } from "../../src/server/services/system-backup/import-data.ts";
assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
const { db, sql, inTransaction } = await import("../../src/db/index.ts");
const s = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { hashPassword } = await import("../../src/server/auth/password.ts"),
  { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { masterKey, decryptSecretWithKey } =
  await import("../../src/server/services/crypto.service.ts");
await (
  await import("../../src/server/application/bootstrap-business-effects.ts")
).bootstrapBusinessEffects();
const { createProject } =
    await import("../../src/server/services/project.service.ts"),
  wi = await import("../../src/server/services/work-item.service.ts"),
  integrations =
    await import("../../src/server/services/integration.service.ts"),
  sources =
    await import("../../src/server/services/delivery-source.service.ts"),
  evidence =
    await import("../../src/server/services/delivery-evidence.service.ts");
const rows: {
  safe: Record<string, Record<string, unknown>[]>;
  full: Record<string, Record<string, unknown>[]>;
} = { safe: {}, full: {} };
const rollback = new Error("rollback fixture");
const features = [
  "persistent-collaboration-and-conversations",
  "requirement-history",
  "document-folders",
  "product-attribution",
  "requirement-changes",
  "test-case-library",
  "test-execution",
  "test-execution-builds",
  "delivery-evidence",
];
const names = [
  "projects.delivery_source",
  "projects.delivery_evidence",
  "projects.delivery_evidence_link",
  "projects.delivery_receipt",
  "projects.release_candidate",
  "projects.release_verification",
  "projects.release_feedback",
];
try {
  await assert.rejects(
    inTransaction(async () => {
      await db.insert(s.organization).values({ name: "交付恢复" });
      const [m] = await db
        .insert(s.member)
        .values({
          username: "restore-delivery",
          name: "恢复账号",
          status: "ACTIVE",
          passwordHash: await hashPassword("fixture-password"),
        })
        .returning();
      const [r] = await db.select().from(s.role).where(eq(s.role.key, "ADMIN"));
      await db
        .insert(s.roleAssignment)
        .values({
          memberId: m!.id,
          roleId: r!.id,
          scopeType: "ORG",
          scopeId: null,
        });
      const actor = (await loadActor(m!.id))!;
      const p = await createProject(actor, { key: "RD", name: "交付恢复" }),
        task = (await wi.createWorkItem(actor, p.id, {
          type: "TASK",
          title: "证据任务",
        }))!;
      const i = await integrations.createIntegration(actor, {
        kind: "GITHUB",
        name: "仓库",
        projectId: p.id,
        baseUrl: "https://8.8.8.8",
        token: "restore-token",
        config: { repo: "acme/app" },
      });
      const source = await sources.configureDeliverySource(actor, p.id, {
        integrationId: i.id,
        expectedVersion: 0,
        webhookSecret: "restore-webhook-secret-123456",
      });
      await evidence.createDeliveryEvidence(actor, p.id, {
        kind: "BUILD",
        title: "自报",
        repository: "acme/app",
        commitSha: "a".repeat(40),
        build: "local",
        status: "SUCCEEDED",
        url: "https://example.com/log",
        workItemIds: [task.id],
      });
      // 隔离恢复fixture：模拟已通过适配器核验的持久化快照，验签测试在独立领域套件覆盖。
      const [proof] = await db
        .insert(s.deliveryEvidence)
        .values({
          projectId: p.id,
          sourceId: source.id,
          sourceVersion: 1,
          kind: "CI",
          title: "CI",
          repository: "acme/app",
          commitSha: "b".repeat(40),
          build: "b".repeat(40),
          status: "FAILED",
          verification: "PROVIDER_API",
          externalId: "10",
          providerUpdatedAt: new Date(),
          url: "https://github.com/acme/app/actions/runs/10",
          details: { workflowId: 7, conclusion: "failure" },
        })
        .returning();
      await db
        .insert(s.deliveryReceipt)
        .values({
          sourceId: source.id,
          sourceVersion: 1,
          deliveryId: "fixture",
          payloadHash: "a".repeat(64),
          eventType: "workflow_run",
          evidenceId: proof!.id,
        });
      await evidence.linkDeliveryEvidence(actor, p.id, proof!.id, [task.id]);
      for (const mode of ["safe", "full"] as const)
        for (const d of orderedDatasets(mode))
          rows[mode][d.name] = (await sql`select * from ${sql(d.tableName)}`)
            .map((row) => d.encodeRow(row, { mode, purpose: "migration" }))
            .filter((r): r is Record<string, unknown> => r !== null);
      throw rollback;
    }),
    (e) => e === rollback,
  );
  const sourceKey = masterKey(),
    targetKey = randomBytes(32);
  for (const mode of ["safe", "full"] as const) {
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      mode,
      datasetRows: rows[mode],
      sourceMasterKey: sourceKey,
      manifest: { requiredFeatures: features },
    });
    await assert.rejects(
      inTransaction(async () => {
        await importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
          mode === "full" ? { sourceKey, targetKey } : undefined,
        );
        assert.equal(
          (await sql`select count(*)::int n from delivery_evidence`)[0]!.n,
          2,
        );
        const [source] = await sql`select * from delivery_source`;
        if (mode === "safe") {
          assert.equal(source!.integration_id, null);
          assert.equal(source!.enabled, false);
          assert.equal(source!.webhook_secret_encrypted, null);
        } else {
          assert.equal(
            decryptSecretWithKey(source!.webhook_secret_encrypted, targetKey),
            "restore-webhook-secret-123456",
          );
          assert.equal(
            (await sql`select count(*)::int n from integration`)[0]!.n,
            1,
          );
        }
        await sql`set constraints all immediate`;
        throw rollback;
      }),
      (e) => e === rollback,
    );
  }
  const activeSafe = structuredClone(rows.safe);
  activeSafe["projects.delivery_source"][0].enabled = true;
  const sanitized = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
    datasetRows: activeSafe,
    manifest: { requiredFeatures: features },
  });
  await assert.rejects(
    inTransaction(async () => {
      await importDatasets(
        sanitized.innerPath,
        manifestSchema.parse(sanitized.manifest),
      );
      assert.equal(
        (await sql`select enabled from delivery_source`)[0]!.enabled,
        false,
      );
      throw rollback;
    }),
    (e) => e === rollback,
  );
  const legacy = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
    datasetRows: rows.safe,
    omitDatasets: names,
    manifest: {
      requiredFeatures: features.filter((f) => f !== "delivery-evidence"),
    },
  });
  await assert.rejects(
    inTransaction(async () => {
      await importDatasets(
        legacy.innerPath,
        manifestSchema.parse(legacy.manifest),
      );
      assert.equal(
        (await sql`select count(*)::int n from delivery_evidence`)[0]!.n,
        0,
      );
      throw rollback;
    }),
    (e) => e === rollback,
  );
  for (const damage of [
    "provenance",
    "receipt",
    "url",
    "kind",
    "workflow",
    "version",
  ]) {
    const broken = structuredClone(rows.safe),
      proof = broken["projects.delivery_evidence"]!.find(
        (e) => e.verification === "PROVIDER_API",
      )!;
    if (damage === "provenance") proof.project_id = crypto.randomUUID();
    if (damage === "receipt")
      broken["projects.delivery_receipt"]![0]!.source_version = 2;
    if (damage === "url") proof.url = "/Users/local/output";
    if (damage === "kind") proof.kind = "BUILD";
    if (damage === "workflow") proof.details = {};
    if (damage === "version") proof.source_version = 2;
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: broken,
      manifest: { requiredFeatures: features },
    });
    await assert.rejects(
      inTransaction(() =>
        importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
        ),
      ),
      undefined,
      damage,
    );
    assert.equal(
      (await sql`select count(*)::int n from delivery_evidence`)[0]!.n,
      0,
      "损坏恢复整体回滚",
    );
  }
  console.log("delivery restore passed");
} finally {
  await sql.end({ timeout: 5 });
}
