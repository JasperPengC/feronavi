import assert from "node:assert/strict";
import { backupFixture } from "./system-backup-fixture.ts";
import { manifestSchema } from "../../src/shared/schemas/system-backup.ts";
import { orderedDatasets } from "../../src/server/services/system-backup/registry.ts";
import { importDatasets } from "../../src/server/services/system-backup/import-data.ts";

assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql, inTransaction } = await import("../../src/db/index.ts");
const { organization, member, role, roleAssignment } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { hashPassword } = await import("../../src/server/auth/password.ts");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { createProject } = await import("../../src/server/services/project.service.ts");
const { createWorkItem, updateWorkItem } = await import("../../src/server/services/work-item.service.ts");
const rows: Record<string, Record<string, unknown>[]> = {};
const rollback = new Error("fixture rollback");
let workItemId = "";
try {
  await assert.rejects(inTransaction(async () => {
    await db.insert(organization).values({ name: "需求版本恢复验收" });
    const [admin] = await db.insert(member).values({ username: "restore-history-admin", name: "恢复验收", status: "ACTIVE", passwordHash: await hashPassword("fixture-only-password") }).returning();
    const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
    await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
    const actor = (await loadActor(admin!.id))!;
    const project = await createProject(actor, { key: "HISTORY", name: "历史备份" });
    const item = (await createWorkItem(actor, project.id, { type: "REQUIREMENT", title: "恢复需求", description: "第一版正文" }))!;
    workItemId = item.id;
    await updateWorkItem(actor, item.id, { version: item.version, description: "第二版正文" });
    for (const dataset of orderedDatasets("safe")) {
      const data = await sql`select * from ${sql(dataset.tableName)}`;
      rows[dataset.name] = data.map(row => dataset.encodeRow(row, { mode: "safe", purpose: "migration" })).filter((row): row is Record<string, unknown> => row !== null);
    }
    throw rollback;
  }), error => error === rollback);
  for (const legacy of [false, true]) {
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: rows,
      omitDatasets: legacy ? ["projects.requirement_revision", "projects.requirement_change", "projects.requirement_change_impact", "projects.test_suite", "projects.test_case", "projects.test_case_revision", "projects.test_case_requirement", "projects.test_plan", "projects.test_plan_case", "projects.test_run", "projects.test_run_defect", "projects.release_candidate", "projects.release_verification", "projects.release_feedback"] : [],
      manifest: { requiredFeatures: legacy ? ["persistent-collaboration-and-conversations"] : ["persistent-collaboration-and-conversations", "requirement-history"] },
    });
    await assert.rejects(inTransaction(async () => {
      await importDatasets(fixture.innerPath, manifestSchema.parse(fixture.manifest));
      const revisions = await sql`select * from requirement_revision where work_item_id=${workItemId} order by revision_no`;
      assert.equal(revisions.length, legacy ? 1 : 2);
      assert.equal(revisions.at(-1)!.description, "第二版正文");
      assert.equal(revisions.at(-1)!.work_item_version, 2);
      if (legacy) {
        assert.equal(revisions[0]!.source, "BASELINE");
        assert.equal(revisions[0]!.author_id, null);
      } else {
        assert.equal(revisions[0]!.description, "第一版正文");
        assert.deepEqual(revisions.map(row => row.id), rows["projects.requirement_revision"]!.map(row => row.id));
      }
      throw rollback;
    }), error => error === rollback);
  }
  const broken = structuredClone(rows);
  broken["projects.requirement_revision"]!.at(-1)!.description = "损坏正文";
  const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, { datasetRows: broken, manifest: { requiredFeatures: ["persistent-collaboration-and-conversations", "requirement-history"] } });
  await assert.rejects(inTransaction(() => importDatasets(fixture.innerPath, manifestSchema.parse(fixture.manifest))), error => (error as { code?: string }).code === "INVALID_BACKUP");
  assert.equal(Number((await sql`select count(*) as n from work_item`)[0]!.n), 0, "坏备份完全回滚");
  console.log("requirement history restore passed");
} finally { await sql.end({ timeout: 5 }); }
