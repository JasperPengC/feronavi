/** 随机隔离库：导入预演绑定、回滚修改保护与仓库重复配置回归。 */
import assert from "node:assert/strict";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../src/db/index.ts");
const { member, role, roleAssignment, workItem, importBatch, importMapping } = await import("../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../src/server/auth/actor-loader.ts");
const { createProject } = await import("../src/server/services/project.service.ts");
const imports = await import("../src/server/services/import.service.ts");
const integrations = await import("../src/server/services/integration.service.ts");
const workItems = await import("../src/server/services/work-item.service.ts");
const { closeCache } = await import("../src/server/auth/cache.ts");
const { ensureInitialized } = await import("./_test-helpers.ts");
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL ${name}: ${(error as Error).message}`); }
}
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: "import-safety", name: "导入安全回归", passwordHash: "no-login", status: "ACTIVE", mustChangePassword: false }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(person!.id))!;
  const project = await createProject(actor, { key: "IMPSAFE", name: "导入安全测试" });
  let sequence = 0;
  const batch = async (rows = "一条待导入记录,第一份说明") => {
    const serial = ++sequence;
    const value = await imports.createBatch(actor, project.id, { filename: "fixture.csv", buffer: Buffer.from(`标题,说明,外部ID\n${rows},${serial}\n`) });
    await imports.setMapping(actor, value.batch.id, { fieldMap: { 标题: "title", 说明: "description" }, externalIdColumn: "外部ID" });
    return value.batch.id;
  };
  const records = async (id: string) => db.select().from(workItem).where(eq(workItem.projectId, id));

  await check("没有预演不能确认且不写入工作项", async () => {
    const id = await batch();
    const before = (await records(project.id)).length;
    await assert.rejects(imports.confirm(actor, id), { code: "CONFLICT" });
    assert.equal((await records(project.id)).length, before);
  });
  await check("预演后改映射必须重新预演", async () => {
    const id = await batch();
    assert.equal((await imports.dryRun(actor, id)).willCreate, 1);
    await imports.setMapping(actor, id, { fieldMap: { 标题: "title" }, externalIdColumn: "外部ID" });
    await assert.rejects(imports.confirm(actor, id), { code: "CONFLICT" });
    await imports.dryRun(actor, id);
    assert.equal((await imports.confirm(actor, id)).created, 1);
  });
  await check("预演后源行变化使确认失效", async () => {
    const id = await batch();
    await imports.dryRun(actor, id);
    await db.update(importBatch).set({ rows: [{ 标题: "被替换的记录", 外部ID: `tampered-${sequence}` }] }).where(eq(importBatch.id, id));
    await assert.rejects(imports.confirm(actor, id), { code: "CONFLICT" });
  });
  await check("有效预演可确认且重复确认不创建重复项", async () => {
    const id = await batch();
    await imports.dryRun(actor, id);
    const result = await imports.confirm(actor, id);
    assert.equal(result.created, 1); assert.equal(result.status, "SUCCEEDED");
    assert.equal((await imports.confirm(actor, id)).created, 0);
    const maps = await db.select().from(importMapping).where(eq(importMapping.batchId, id));
    assert.equal(maps.length, 1);
  });
  await check("回滚保留导入后修改项并保持其去重映射", async () => {
    const id = await batch(); await imports.dryRun(actor, id); await imports.confirm(actor, id);
    const [mapping] = await db.select().from(importMapping).where(eq(importMapping.batchId, id));
    const original = await workItems.getWorkItem(actor, mapping!.internalId);
    await workItems.updateWorkItem(actor, original.id, { version: original.version, title: "导入后用户修改" });
    const rolled = await imports.rollback(actor, id);
    assert.equal(rolled.removed, 0);
    assert.equal((rolled as { retainedModified?: number }).retainedModified, 1);
    const [row] = await db.select().from(workItem).where(eq(workItem.id, original.id));
    assert.equal(row!.deletedAt, null); assert.equal(row!.title, "导入后用户修改");
    const [active] = await db.select().from(importMapping).where(eq(importMapping.id, mapping!.id));
    assert.equal(active!.isActive, true);
    const repeated = await imports.rollback(actor, id);
    assert.equal(repeated.alreadyRolledBack, true); assert.equal(repeated.removed, 0);
  });
  await check("回滚删除未修改项且已经删除项不重复计数", async () => {
    const id = await batch(); await imports.dryRun(actor, id); await imports.confirm(actor, id);
    const removed = await imports.rollback(actor, id);
    assert.equal(removed.removed, 1);
    assert.equal((removed as { retainedModified?: number }).retainedModified, 0);
    const second = await batch(); await imports.dryRun(actor, second); await imports.confirm(actor, second);
    const [mapping] = await db.select().from(importMapping).where(eq(importMapping.batchId, second));
    await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, mapping!.internalId));
    const skipped = await imports.rollback(actor, second);
    assert.equal(skipped.removed, 0);
    assert.equal((skipped as { skippedDeleted?: number }).skippedDeleted, 1);
  });
  await check("旧批次没有导入版本基线时安全保留", async () => {
    const id = await batch(); await imports.dryRun(actor, id); await imports.confirm(actor, id);
    const value = await imports.getBatch(actor, id);
    const { _importedVersions: _baseline, ...legacyConfig } = value.mappingConfig as Record<string, unknown>;
    await db.update(importBatch).set({ mappingConfig: legacyConfig }).where(eq(importBatch.id, id));
    const result = await imports.rollback(actor, id);
    assert.equal(result.removed, 0);
    assert.equal((result as { retainedUnknown?: number }).retainedUnknown, 1);
  });
  await check("预演含无效行仍可明确部分导入并只重试失败行", async () => {
    const id = await batch("有效行,说明,partial-valid\n,无标题");
    const preview = await imports.dryRun(actor, id);
    assert.equal(preview.willCreate, 1); assert.equal(preview.failed, 1);
    const result = await imports.confirm(actor, id);
    assert.equal(result.status, "PARTIAL"); assert.equal(result.created, 1); assert.equal(result.failed, 1);
    const retry = await imports.confirm(actor, id, { retryFailedOnly: true });
    assert.equal(retry.created, 0); assert.equal(retry.failed, 1);
  });
  await check("仅修改仓库配置也不能与同范围集成重复", async () => {
    const input = { kind: "GITHUB", baseUrl: "https://1.1.1.1", projectId: project.id, token: "fixture-not-a-real-secret" };
    await integrations.createIntegration(actor, { ...input, name: "仓库一", config: { repo: "fixture/first" } });
    const next = await integrations.createIntegration(actor, { ...input, name: "仓库二", config: { repo: "fixture/second" } });
    await assert.rejects(integrations.updateIntegration(actor, next.id, { config: { repo: "fixture/first" } }), { code: "VALIDATION" });
    const after = (await integrations.listIntegrations(actor, project.id)).find(row => row.id === next.id)!;
    assert.equal((after.config as { repo: string }).repo, "fixture/second");
    await integrations.updateIntegration(actor, next.id, { config: { repo: "fixture/third" } });
  });
  await check("集成换服务地址必须重新提供凭据且不能继承旧令牌", async () => {
    const item = await integrations.createIntegration(actor, { kind: "GITHUB", name: "目的地绑定", baseUrl: "https://1.1.1.1", projectId: project.id, token: "fixture-old-destination-token", config: { repo: "fixture/destination" } });
    await assert.rejects(integrations.updateIntegration(actor, item.id, { baseUrl: "https://8.8.8.8" }), { code: "VALIDATION" });
    const before = (await integrations.listIntegrations(actor, project.id)).find(row => row.id === item.id)!;
    assert.equal(before.baseUrl, "https://1.1.1.1");
    await assert.rejects(integrations.updateIntegration(actor, item.id, { baseUrl: "https://8.8.8.8", token: "  " }), { code: "VALIDATION" });
    const after = await integrations.updateIntegration(actor, item.id, { baseUrl: "https://8.8.8.8", token: "fixture-new-destination-token" });
    assert.equal(after.baseUrl, "https://8.8.8.8");
  });
  await check("集成换项目必须重新提供项目范围凭据", async () => {
    const target = await createProject(actor, { key: "IMPTARGET", name: "集成目标项目" });
    const item = await integrations.createIntegration(actor, { kind: "GITHUB", name: "范围绑定", baseUrl: "https://1.1.1.1", projectId: project.id, token: "fixture-scoped-token", config: { repo: "fixture/scope" } });
    const targetOnly = { ...actor, grants: [{ roleKey: "ADMIN", scopeType: "PROJECT" as const, scopeId: target.id }] };
    await assert.rejects(integrations.updateIntegration(targetOnly, item.id, { projectId: target.id, token: "fixture-target-token" }), { code: "FORBIDDEN" });
    await assert.rejects(integrations.updateIntegration(actor, item.id, { projectId: target.id }), { code: "VALIDATION" });
    const updated = await integrations.updateIntegration(actor, item.id, { projectId: target.id, token: "fixture-target-scoped-token" });
    assert.equal(updated.projectId, target.id);
  });
  assert.equal(failures.length, 0, `领域安全回归失败：${failures.join("；")}`);
} finally { await closeCache(); await sql.end({ timeout: 5 }); }
