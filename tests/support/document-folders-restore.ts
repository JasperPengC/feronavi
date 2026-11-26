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
const wiki = await import("../../src/server/services/wiki.service.ts");
const { organizePage } = await import("../../src/server/services/page-structure.service.ts");
const rows: Record<string, Record<string, unknown>[]> = {};
const rollback = new Error("fixture rollback");
let folderId = "", documentId = "", revisionId: string | null = "";
try {
  await assert.rejects(inTransaction(async () => {
    await db.insert(organization).values({ name: "目录恢复验收" });
    const [admin] = await db.insert(member).values({ username: "restore-folders", name: "恢复验收", status: "ACTIVE", passwordHash: await hashPassword("fixture-only-password") }).returning();
    const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
    await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
    const actor = (await loadActor(admin!.id))!;
    const project = await createProject(actor, { key: "RESTOREF", name: "目录备份" });
    const folder = await wiki.createPage(actor, project.id, { title: "资料", kind: "FOLDER" });
    const document = await wiki.createPage(actor, project.id, { title: "原始正文", content: "不可变文档内容", parentId: folder.id });
    folderId = folder.id; documentId = document.id; revisionId = document.currentRevisionId;
    await organizePage(actor, folderId, { expectedStructureVersion: 1, archived: true });
    for (const dataset of orderedDatasets("safe")) {
      const data = await sql`select * from ${sql(dataset.tableName)}`;
      rows[dataset.name] = data.map(row => dataset.encodeRow(row, { mode: "safe", purpose: "migration" })).filter((row): row is Record<string, unknown> => row !== null);
    }
    throw rollback;
  }), error => error === rollback);
  for (const legacy of [false, true]) {
    const data = structuredClone(rows);
    if (legacy) {
      data["content.page"] = data["content.page"]!.filter(row => row.id !== folderId).map(row => {
        const { kind: _kind, structure_version: _version, created_by: _owner, archived_at: _archive, ...rest } = row;
        return { ...rest, parent_id: null };
      });
    }
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, { datasetRows: data,
      manifest: { requiredFeatures: ["persistent-collaboration-and-conversations", "requirement-history", ...(legacy ? [] : ["document-folders"])] } });
    await assert.rejects(inTransaction(async () => {
      await importDatasets(fixture.innerPath, manifestSchema.parse(fixture.manifest));
      const [doc] = await sql`select * from page where id = ${documentId}`;
      assert.equal(doc!.current_revision_id, revisionId);
      assert.equal(doc!.kind, "DOCUMENT");
      assert.equal(doc!.structure_version, 1);
      const [archived] = await sql`select id from archived_page where id = ${documentId}`;
      assert.equal(Boolean(archived), !legacy);
      if (!legacy) {
        const [folder] = await sql`select * from page where id = ${folderId}`;
        assert.equal(folder!.kind, "FOLDER"); assert.equal(folder!.structure_version, 2);
        assert.equal(folder!.current_revision_id, null); assert.ok(folder!.created_by);
      }
      throw rollback;
    }), error => error === rollback);
  }
  const broken = structuredClone(rows);
  delete broken["content.page"]![0]!.kind;
  const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, { datasetRows: broken,
    manifest: { requiredFeatures: ["persistent-collaboration-and-conversations", "requirement-history", "document-folders"] } });
  await assert.rejects(inTransaction(() => importDatasets(fixture.innerPath, manifestSchema.parse(fixture.manifest))), error => (error as { code?: string }).code === "INVALID_BACKUP");
  assert.equal(Number((await sql`select count(*) n from page`)[0]!.n), 0);
  console.log("document folders restore passed");
} finally { await sql.end({ timeout: 5 }); }
