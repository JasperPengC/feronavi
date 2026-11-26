import assert from "node:assert/strict";
import { backupFixture } from "./system-backup-fixture.ts";
import { manifestSchema } from "../../src/shared/schemas/system-backup.ts";
import { orderedDatasets } from "../../src/server/services/system-backup/registry.ts";
import { importDatasets } from "../../src/server/services/system-backup/import-data.ts";
assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
const { db, sql, inTransaction } = await import("../../src/db/index.ts");
const { organization, member, role, roleAssignment } =
  await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { hashPassword } = await import("../../src/server/auth/password.ts");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
await (
  await import("../../src/server/application/bootstrap-business-effects.ts")
).bootstrapBusinessEffects();
const { createProject } =
  await import("../../src/server/services/project.service.ts");
const changes =
  await import("../../src/server/services/requirement-change.service.ts");
const { createWorkItem } =
  await import("../../src/server/services/work-item.service.ts");
const rows: Record<string, Record<string, unknown>[]> = {};
const rollback = new Error("fixture rollback");
const features = [
  "persistent-collaboration-and-conversations",
  "requirement-history",
  "document-folders",
  "product-attribution",
];
try {
  await assert.rejects(
    inTransaction(async () => {
      await db.insert(organization).values({ name: "变更恢复验收" });
      const [admin] = await db
        .insert(member)
        .values({
          username: "restore-changes",
          name: "变更验收",
          status: "ACTIVE",
          passwordHash: await hashPassword("fixture-only-password"),
        })
        .returning();
      const [adminRole] = await db
        .select()
        .from(role)
        .where(eq(role.key, "ADMIN"));
      await db
        .insert(roleAssignment)
        .values({
          memberId: admin!.id,
          roleId: adminRole!.id,
          scopeType: "ORG",
          scopeId: null,
        });
      const actor = (await loadActor(admin!.id))!;
      const project = await createProject(actor, {
        key: "RESTOREC",
        name: "变更备份",
      });
      const req = (await createWorkItem(actor, project.id, {
        type: "REQUIREMENT",
        title: "原需求",
        description: "原正文",
      }))!;
      await createWorkItem(actor, project.id, {
        type: "TASK",
        title: "受影响任务",
        parentId: req.id,
      });
      const ctx = await changes.getChangeContext(actor, req.id);
      let change = await changes.createRequirementChange(actor, req.id, {
        baseRevisionId: ctx.baseRevision.id,
        expectedWorkItemVersion: ctx.workItemVersion,
        impactFingerprint: ctx.impactFingerprint,
        title: "新需求",
        description: "新正文",
        reason: "范围调整",
      });
      change = await changes.decideRequirementChange(actor, req.id, change.id, {
        expectedVersion: change.version,
        decision: "APPROVE",
        note: "评审通过",
      });
      change = await changes.applyRequirementChange(actor, req.id, change.id, {
        expectedVersion: change.version,
        expectedWorkItemVersion: req.version,
      });
      await changes.acknowledgeRequirementImpact(actor, req.id, change.id, {
        expectedVersion: change.version,
        impactId: change.impacts[0]!.id,
        note: "已评估",
      });
      for (const dataset of orderedDatasets("safe")) {
        rows[dataset.name] = (
          await sql`select * from ${sql(dataset.tableName)}`
        )
          .map((row) =>
            dataset.encodeRow(row, { mode: "safe", purpose: "migration" }),
          )
          .filter((row): row is Record<string, unknown> => row !== null);
      }
      throw rollback;
    }),
    (error) => error === rollback,
  );
  for (const legacy of [false, true]) {
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: rows,
      omitDatasets: legacy
        ? ["projects.requirement_change", "projects.requirement_change_impact"]
        : [],
      manifest: {
        requiredFeatures: [
          ...features,
          ...(legacy ? [] : ["requirement-changes"]),
        ],
      },
    });
    await assert.rejects(
      inTransaction(async () => {
        await importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
        );
        const restored = await sql`select * from requirement_change`;
        assert.equal(restored.length, legacy ? 0 : 1);
        if (!legacy) {
          assert.equal(restored[0]!.status, "APPLIED");
          assert.equal(restored[0]!.version, 4);
          assert.equal(restored[0]!.review_note, "评审通过");
          assert.equal(
            (await sql`select note from requirement_change_impact`)[0]!.note,
            "已评估",
          );
        }
        assert.equal(
          (await sql`select count(*)::int n from requirement_revision`)[0]!.n,
          2,
        );
        throw rollback;
      }),
      (e) => e === rollback,
    );
  }
  for (const damage of [
    "fingerprint",
    "snapshot",
    "revision",
    "acknowledgement",
  ]) {
    const broken = structuredClone(rows),
      change = broken["projects.requirement_change"]![0]!,
      impact = broken["projects.requirement_change_impact"]![0]!;
    if (damage === "fingerprint") change.impact_fingerprint = "0".repeat(64);
    if (damage === "snapshot")
      impact.snapshot = { ...(impact.snapshot as object), title: "伪造影响" };
    if (damage === "revision")
      change.applied_revision_id = change.base_revision_id;
    if (damage === "acknowledgement") {
      change.status = "PENDING";
      change.applied_at = null;
      change.applied_revision_id = null;
    }
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: broken,
      manifest: { requiredFeatures: [...features, "requirement-changes"] },
    });
    await assert.rejects(
      inTransaction(() =>
        importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
        ),
      ),
      (e) => (e as { code?: string }).code === "INVALID_BACKUP",
      damage,
    );
  }
  console.log("requirement changes restore passed");
} finally {
  await sql.end({ timeout: 5 });
}
