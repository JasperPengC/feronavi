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
const products = await import("../../src/server/services/product.service.ts");
const { createWorkItem } = await import("../../src/server/services/work-item.service.ts");
const rows: Record<string, Record<string, unknown>[]> = {};
const rollback = new Error("fixture rollback");
let productId = "", requirementId = "";
const features = ["persistent-collaboration-and-conversations", "requirement-history", "document-folders"];
try {
  await assert.rejects(inTransaction(async () => {
    await db.insert(organization).values({ name: "产品恢复验收" });
    const [admin] = await db.insert(member).values({ username: "restore-products", name: "恢复验收", status: "ACTIVE", passwordHash: await hashPassword("fixture-only-password") }).returning();
    const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
    await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
    const actor = (await loadActor(admin!.id))!;
    const one = await createProject(actor, { key: "RESTOREP", name: "产品备份" });
    const two = await createProject(actor, { key: "RESTOREQ", name: "另一个项目" });
    let p = await products.createProduct(actor, one.id, { name: "共享产品" });
    p = await products.linkProductProject(actor, one.id, p.id, { targetProjectId: two.id, expectedVersion: p.version });
    const requirement = await createWorkItem(actor, one.id, { type: "REQUIREMENT", title: "稳定归属", productId: p.id });
    productId = p.id; requirementId = requirement!.id;
    await products.updateProduct(actor, one.id, p.id, { archived: true, expectedVersion: p.version });
    for (const dataset of orderedDatasets("safe")) {
      const data = await sql`select * from ${sql(dataset.tableName)}`;
      rows[dataset.name] = data.map(row => dataset.encodeRow(row, { mode: "safe", purpose: "migration" })).filter((row): row is Record<string, unknown> => row !== null);
    }
    throw rollback;
  }), error => error === rollback);
  for (const legacy of [false, true]) {
    const data = structuredClone(rows);
    if (legacy) data["projects.work_item"] = data["projects.work_item"]!.map(row => { const { product_id: _product, ...rest } = row; return rest; });
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, { datasetRows: data,
      omitDatasets: legacy ? ["projects.product", "projects.product_project"] : [],
      manifest: { requiredFeatures: [...features, ...(legacy ? [] : ["product-attribution"])] } });
    await assert.rejects(inTransaction(async () => {
      await importDatasets(fixture.innerPath, manifestSchema.parse(fixture.manifest));
      const [requirement] = await sql`select product_id from work_item where id=${requirementId}`;
      assert.equal(requirement!.product_id, legacy ? null : productId);
      const [count] = await sql`select count(*)::int as n from product_project where product_id=${productId}`;
      assert.equal(count!.n, legacy ? 0 : 2);
      if (!legacy) {
        const [product] = await sql`select version,archived_at from product where id=${productId}`;
        assert.equal(product!.version,3);assert.ok(product!.archived_at);
      }
      throw rollback;
    }), error => error === rollback);
  }
  const broken=structuredClone(rows);delete broken["projects.work_item"]![0]!.product_id;
  const fixture=await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!,{datasetRows:broken,manifest:{requiredFeatures:[...features,"product-attribution"]}});
  await assert.rejects(inTransaction(()=>importDatasets(fixture.innerPath,manifestSchema.parse(fixture.manifest))),error=>(error as {code?:string}).code==="INVALID_BACKUP");
  console.log("product attribution restore passed");
} finally {await sql.end({timeout:5});}
