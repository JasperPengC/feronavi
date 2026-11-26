import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { runReleaseGateScenario } from "./release-gate-fixture.ts";
import { backupFixture } from "./system-backup-fixture.ts";
import { manifestSchema } from "../../src/shared/schemas/system-backup.ts";
import { orderedDatasets } from "../../src/server/services/system-backup/registry.ts";
import { importDatasets } from "../../src/server/services/system-backup/import-data.ts";
import { db, sql, inTransaction } from "../../src/db/index.ts";
import { organization } from "../../src/db/schema.ts";
import { masterKey } from "../../src/server/services/crypto.service.ts";
const rows: {
  safe: Record<string, Record<string, unknown>[]>;
  full: Record<string, Record<string, unknown>[]>;
} = { safe: {}, full: {} };
const rollback = new Error("rollback fixture"),
  features = [
    "persistent-collaboration-and-conversations",
    "requirement-history",
    "document-folders",
    "product-attribution",
    "requirement-changes",
    "test-case-library",
    "test-execution",
    "test-execution-builds",
    "delivery-evidence",
    "release-gate",
  ];
try {
  await assert.rejects(
    inTransaction(async () => {
      await db.insert(organization).values({ name: "发布恢复" });
      await runReleaseGateScenario();
      for (const mode of ["safe", "full"] as const)
        for (const d of orderedDatasets(mode))
          rows[mode][d.name] = (await sql`select * from ${sql(d.tableName)}`)
            .map((r) => d.encodeRow(r, { mode, purpose: "migration" }))
            .filter((r): r is Record<string, unknown> => r !== null);
      throw rollback;
    }),
    (e) => e === rollback,
  );
  for (const mode of ["safe", "full"] as const) {
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      mode,
      datasetRows: rows[mode],
      sourceMasterKey: masterKey(),
      manifest: { requiredFeatures: features },
    });
    await assert.rejects(
      inTransaction(async () => {
        await importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
          mode === "full"
            ? { sourceKey: masterKey(), targetKey: randomBytes(32) }
            : undefined,
        );
        assert.equal(
          (await sql`select count(*)::int n from release_verification`)[0]!.n,
          1,
        );
        assert.equal(
          (await sql`select count(*)::int n from release_feedback`)[0]!.n,
          1,
        );
        await sql`set constraints all immediate`;
        throw rollback;
      }),
      (e) => e === rollback,
    );
  }
  for (const damage of [
    "scope",
    "source",
    "snapshot",
    "proof",
    "test",
    "feedback",
  ]) {
    const data = structuredClone(rows.safe),
      candidate = data["projects.release_candidate"][0],
      verification = data["projects.release_verification"][0],
      snapshot = verification.snapshot as {
        build: string;
        checks: {
          key: string;
          passed: boolean;
          testRunIds?: string[];
          evidenceIds: string[];
        }[];
      };
    if (damage === "scope")
      candidate.work_items = [
        {
          id: crypto.randomUUID(),
          key: "FAKE-1",
          title: "伪造范围",
          version: 1,
        },
      ];
    if (damage === "source") candidate.source_version = 99;
    if (damage === "snapshot") snapshot.build = "different";
    if (damage === "proof")
      snapshot.checks.find((c) => c.key === "merge")!.evidenceIds = [
        crypto.randomUUID(),
      ];
    if (damage === "test")
      snapshot.checks.find((c) => c.key.startsWith("test:"))!.testRunIds = [];
    if (damage === "feedback")
      data["projects.release_feedback"][0].source_url = "/Users/local/path";
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: data,
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
      (await sql`select count(*)::int n from release_verification`)[0]!.n,
      0,
    );
  }
  const legacy = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
    datasetRows: rows.safe,
    omitDatasets: [
      "projects.release_candidate",
      "projects.release_verification",
      "projects.release_feedback",
    ],
    manifest: {
      requiredFeatures: features.filter((f) => f !== "release-gate"),
    },
  });
  await assert.rejects(
    inTransaction(async () => {
      await importDatasets(
        legacy.innerPath,
        manifestSchema.parse(legacy.manifest),
      );
      assert.equal(
        (await sql`select count(*)::int n from release_verification`)[0]!.n,
        0,
      );
      throw rollback;
    }),
    (e) => e === rollback,
  );
  console.log("release gate restore passed");
} finally {
  await sql.end({ timeout: 5 });
}
