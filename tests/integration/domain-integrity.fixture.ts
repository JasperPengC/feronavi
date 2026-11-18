import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, page, intakeSubmission, project: projectTable, notification, mention } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const projects = await import("../../src/server/services/project.service.ts");
const planning = await import("../../src/server/services/planning.service.ts");
const items = await import("../../src/server/services/work-item.service.ts");
const wiki = await import("../../src/server/services/wiki.service.ts");
const imports = await import("../../src/server/services/import.service.ts");
const intake = await import("../../src/server/services/intake.service.ts");
const comments = await import("../../src/server/services/comment.service.ts");
const portfolios = await import("../../src/server/services/portfolio.service.ts");
const itemLinks = await import("../../src/server/services/work-item-link.service.ts");
const attachments = await import("../../src/server/services/attachment.service.ts");

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
}
const validation = (error: unknown) => (error as { code?: string }).code === "VALIDATION";
try {
  const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
  assert.ok(adminRole);
  const [admin] = await db.insert(member).values({ username: "domain-admin", name: "领域验收", email: "domain@example.invalid", passwordHash: "isolated-no-login", status: "ACTIVE" }).returning();
  assert.ok(admin);
  await db.insert(roleAssignment).values({ memberId: admin.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const actor = await loadActor(admin.id);
  assert.ok(actor);
  const project = await projects.createProject(actor, { key: "DOMAIN", name: "领域隔离测试" });
  const other = await projects.createProject(actor, { key: "OTHER", name: "另一项目" });
  const createItem = (title: string, parentId?: string) => items.createWorkItem(actor, project.id, { type: "TASK", title, parentId });

  await check("模块拒绝祖孙循环", async () => {
    const root = await planning.createPlan(actor, project.id, "module", { name: "root" });
    const child = await planning.createPlan(actor, project.id, "module", { name: "child", parentId: root!.id });
    const leaf = await planning.createPlan(actor, project.id, "module", { name: "leaf", parentId: child!.id });
    await assert.rejects(planning.updatePlan(actor, root!.id, "module", { parentId: leaf!.id }), validation);
    assert.equal((await planning.get(actor, root!.id, "module")).parentId, null);
  });
  await check("模块并发改父级不能形成环", async () => {
    const a = await planning.createPlan(actor, project.id, "module", { name: "concurrent-a" });
    const b = await planning.createPlan(actor, project.id, "module", { name: "concurrent-b" });
    const results = await Promise.allSettled([
      planning.updatePlan(actor, a!.id, "module", { parentId: b!.id }),
      planning.updatePlan(actor, b!.id, "module", { parentId: a!.id }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected" && validation(r.reason)).length, 1);
  });
  await check("工作项更新拒绝跨项目父项", async () => {
    const child = await createItem("cross-project child");
    const foreign = await items.createWorkItem(actor, other.id, { type: "TASK", title: "foreign" });
    await assert.rejects(items.updateWorkItem(actor, child!.id, { version: child!.version, parentId: foreign!.id }), validation);
  });
  await check("工作项更新拒绝祖孙循环", async () => {
    const root = await createItem("item root");
    const leaf = await createItem("item child", root!.id);
    await assert.rejects(items.updateWorkItem(actor, root!.id, { version: root!.version, parentId: leaf!.id }), validation);
  });
  await check("工作项拒绝解除子任务父项", async () => {
    const root = await createItem("subtask parent");
    const child = await items.createWorkItem(actor, project.id, { type: "SUBTASK", title: "subtask", parentId: root!.id });
    await assert.rejects(items.updateWorkItem(actor, child!.id, { version: child!.version, parentId: null }), validation);
  });
  await check("删除父工作项不能留下活动孤儿", async () => {
    const root = await createItem("delete parent");
    await createItem("retained child", root!.id);
    await assert.rejects(items.deleteWorkItem(actor, root!.id), (error: unknown) => (error as { code?: string }).code === "BLOCKED_BY_PREREQUISITE");
    assert.ok(await items.getWorkItem(actor, root!.id));
  });
  await check("Wiki更新拒绝跨项目、无效和删除父页", async () => {
    const child = await wiki.createPage(actor, project.id, { title: "wiki child" });
    const foreign = await wiki.createPage(actor, other.id, { title: "foreign parent" });
    const deleted = await wiki.createPage(actor, project.id, { title: "deleted parent" });
    await wiki.deletePage(actor, deleted.id);
    for (const parentId of [foreign.id, randomUUID(), deleted.id]) {
      await assert.rejects(wiki.updatePage(actor, child.id, { parentId }), validation);
    }
  });
  await check("Wiki拒绝超过50层的祖孙循环", async () => {
    const root = await wiki.createPage(actor, project.id, { title: "deep wiki root" });
    let parentId = root.id;
    for (let i = 0; i < 55; i++) {
      const [child] = await db.insert(page).values({ projectId: project.id, title: `deep-${i}`, slug: `deep-${i}`, parentId }).returning();
      parentId = child!.id;
    }
    await assert.rejects(wiki.updatePage(actor, root.id, { parentId }), validation);
  });
  await check("Wiki同一版本并发保存返回明确版本冲突", async () => {
    const current = await wiki.createPage(actor, project.id, { title: "concurrent wiki" });
    const results = await Promise.allSettled([
      wiki.updatePage(actor, current.id, { content: "first", expectedRevisionId: current.currentRevisionId }),
      wiki.updatePage(actor, current.id, { content: "second", expectedRevisionId: current.currentRevisionId }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected" && r.reason?.code === "VERSION_CONFLICT").length, 1);
    assert.equal((await wiki.listRevisions(actor, current.id)).length, 2);
  });
  async function batch(text: string) {
    const { batch } = await imports.createBatch(actor, project.id, { filename: "domain.csv", buffer: Buffer.from(text) });
    await imports.setMapping(actor, batch.id, { fieldMap: { title: "title" }, externalIdColumn: "id" });
    return batch;
  }
  await check("导入映射失败时回滚工作项", async () => {
    const value = await batch("id,title\nmap-failure,mapping must rollback");
    await sql.unsafe("create function reject_domain_mapping() returns trigger language plpgsql as $$ begin if NEW.external_id = 'map-failure' then raise exception 'mapping failure injected'; end if; return NEW; end $$");
    await sql.unsafe("create trigger domain_mapping_failure before insert on import_mapping for each row execute function reject_domain_mapping()");
    try {
      assert.equal((await imports.confirm(actor, value.id)).failed, 1);
      const found = await sql`select id from work_item where title = 'mapping must rollback' and deleted_at is null`;
      assert.equal(found.length, 0);
    } finally {
      await sql.unsafe("drop trigger domain_mapping_failure on import_mapping");
      await sql.unsafe("drop function reject_domain_mapping()");
    }
  });
  await check("导入回滚后同文件重复外部ID只复活一次", async () => {
    const first = await batch("id,title\nrevive,revived original");
    assert.equal((await imports.confirm(actor, first.id)).created, 1);
    await imports.rollback(actor, first.id);
    const next = await batch("id,title\nrevive,revived once\nrevive,revived twice");
    const result = await imports.confirm(actor, next.id);
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 1);
    assert.equal((await sql`select id from work_item where title in ('revived once','revived twice') and deleted_at is null`).length, 1);
  });
  await check("导入试运行同批重复ID计为跳过", async () => {
    const value = await batch("id,title\npreview-dup,first\npreview-dup,second");
    const result = await imports.dryRun(actor, value.id);
    assert.equal(result.willCreate, 1);
    assert.equal(result.willSkip, 1);
  });
  await check("外部提交并发转换只创建一个想法", async () => {
    const form = await intake.createForm(actor, project.id, { name: "concurrent intake", schema: [{ key: "title", label: "标题", required: true }] });
    const submission = await intake.publicSubmit(form.submitToken, { title: "unique intake conversion" });
    const results = await Promise.all([intake.convertSubmission(actor, submission.id), intake.convertSubmission(actor, submission.id)]);
    assert.equal(new Set(results.map((r) => r.idea?.id)).size, 1);
    assert.equal(results.filter((r) => r.alreadyConverted).length, 1);
    const [saved] = await db.select().from(intakeSubmission).where(eq(intakeSubmission.id, submission.id));
    assert.equal(saved!.convertedIdeaId, results[0]!.idea!.id);
  });
  await check("受限Wiki的提及不向无读权限成员泄露正文", async () => {
    const [reader] = await db.insert(member).values({ username: "domain-reader", name: "无ACL读者", email: "reader@example.invalid", passwordHash: "isolated-no-login", status: "ACTIVE" }).returning();
    assert.ok(reader);
    const restricted = await wiki.createPage(actor, project.id, { title: "secret page", visibility: "RESTRICTED" });
    await comments.createComment(actor, { targetType: "PAGE", targetId: restricted.id, body: "@domain-reader secret comment body" });
    assert.equal((await db.select().from(notification).where(eq(notification.recipientId, reader.id))).length, 0);
    assert.equal((await db.select().from(mention).where(eq(mention.memberId, reader.id))).length, 0);
  });
  await check("项目集汇总包含全局项目第二页中的成员", async () => {
    await db.insert(projectTable).values(Array.from({ length: 101 }, (_, index) => ({
      key: `BULK${index}`, name: `bulk ${index}`, createdBy: actor.memberId,
    })));
    const portfolio = await portfolios.createPortfolio(actor, { name: "old project portfolio" });
    await portfolios.addProject(actor, portfolio.id, project.id);
    const result = await portfolios.getSummary(actor, portfolio.id);
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0]!.id, project.id);
    assert.equal(result.totals.projectCount, 1);
  });
  await check("受限Wiki链接和附件沿用页面ACL", async () => {
    const [reader] = await db.insert(member).values({ username: "domain-link-reader", name: "无ACL项目成员", email: "link-reader@example.invalid", passwordHash: "isolated-no-login", status: "ACTIVE" }).returning();
    assert.ok(reader);
    await db.insert(roleAssignment).values({ memberId: reader.id, roleId: adminRole.id, scopeType: "PROJECT", scopeId: project.id });
    const readerActor = await loadActor(reader.id);
    assert.ok(readerActor);
    const restricted = await wiki.createPage(actor, project.id, { title: "secret linked page", visibility: "RESTRICTED" });
    const item = await createItem("public linked item");
    await itemLinks.createLink(actor, item!.id, { targetType: "PAGE", targetId: restricted.id });
    const upload = await attachments.upload(actor, { targetType: "PAGE", targetId: restricted.id, originalName: "secret.txt", mimeType: "text/plain", data: Buffer.from("secret"), sizeBytes: 6 });
    const forbidden = (error: unknown) => (error as { code?: string }).code === "FORBIDDEN";
    await assert.rejects(attachments.download(readerActor, upload!.id), forbidden);
    await assert.rejects(attachments.listAttachments(readerActor, "PAGE", restricted.id), forbidden);
    assert.deepEqual(await itemLinks.listLinks(readerActor, item!.id), []);
    const otherItem = await createItem("second public linked item");
    await assert.rejects(itemLinks.createLink(readerActor, otherItem!.id, { targetType: "PAGE", targetId: restricted.id }), forbidden);
  });
  assert.deepEqual(failures, [], "领域完整性回归失败");
  console.log("domain integrity contracts passed");
} finally { await sql.end({ timeout: 5 }); }
