import "./_env.ts";
/** 随机隔离库 + 真正本地HTTP：验证所有宣称事件、提交边界和签名。 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { useLocalOutboundMock } from "../tests/support/local-outbound.ts";
import { ensureInitialized } from "./_test-helpers.ts";

assert.match(
  new URL(process.env.DATABASE_URL!).pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
await ensureInitialized();
await (
  await import("../src/server/application/bootstrap-business-effects.ts")
).bootstrapBusinessEffects();
const { db, sql, inTransaction } = await import("../src/db/index.ts");
const {
  member,
  role,
  roleAssignment,
  webhookDelivery,
  workItem,
  workflowTransition,
} = await import("../src/db/schema.ts");
const { loadActor } = await import("../src/server/auth/actor-loader.ts");
const projects = await import("../src/server/services/project.service.ts");
const items = await import("../src/server/services/work-item.service.ts");
const ideas = await import("../src/server/services/idea.service.ts");
const planning = await import("../src/server/services/planning.service.ts");
const comments = await import("../src/server/services/comment.service.ts");
const intake = await import("../src/server/services/intake.service.ts");
const webhooks = await import("../src/server/services/webhook.service.ts");
const { withIdempotency } =
  await import("../src/server/services/idempotency.service.ts");
const external = postgres(process.env.DATABASE_URL!, { max: 1 });
const received: {
  event: string;
  data: Record<string, unknown>;
  deliveryId: string;
  committed: boolean;
}[] = [];
let signingSecret = "";
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const signature = createHmac("sha256", signingSecret)
      .update(`${req.headers["x-feronavi-timestamp"]}.${body}`)
      .digest("hex");
    assert.ok(
      Object.values(req.headers).some(
        (value) => typeof value === "string" && value.includes(signature),
      ),
      "接收端验证真实请求字节签名",
    );
    const event = JSON.parse(body);
    const [delivery] =
      await external`select id from webhook_delivery where id = ${event.deliveryId}`;
    received.push({ ...event, committed: !!delivery });
    res.writeHead(200);
    res.end("ok");
  } catch {
    res.writeHead(500);
    res.end("fixture assertion failed");
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const restore = useLocalOutboundMock(
  "https://1.1.1.1",
  `http://127.0.0.1:${(server.address() as { port: number }).port}`,
);
let checks = 0;
const assertions: string[] = [];
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks++;
  assertions.push(message);
};
async function rollbackProbe(name: string, mutate: () => Promise<unknown>) {
  const deliveries = (await db.select().from(webhookDelivery)).length;
  const requests = received.length;
  await assert.rejects(
    inTransaction(async () => {
      await mutate();
      check(received.length === requests, `${name}未提交不外发`);
      throw new Error("rollback-probe");
    }),
    /rollback-probe/,
  );
  check(received.length === requests, `${name}回滚无HTTP外发`);
  check(
    (await db.select().from(webhookDelivery)).length === deliveries,
    `${name}回滚无持久化假投递`,
  );
}

try {
  const [admin] = await db
    .insert(member)
    .values({
      username: "webhook-commit-admin",
      name: "Webhook 验收",
      passwordHash: "fixture-no-login",
      status: "ACTIVE",
    })
    .returning();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  await db
    .insert(roleAssignment)
    .values({
      memberId: admin!.id,
      roleId: adminRole!.id,
      scopeType: "ORG",
      scopeId: null,
    });
  const actor = (await loadActor(admin!.id))!;
  const project = await projects.createProject(actor, {
    key: "WHCOMMIT",
    name: "Webhook 提交边界",
  });
  const endpoint = await webhooks.createEndpoint(actor, {
    projectId: project.id,
    name: "本地事件验收",
    url: "https://1.1.1.1/hook",
    events: [...webhooks.WEBHOOK_EVENTS],
  });
  signingSecret = endpoint.secret;
  let rolledId = "";
  await assert.rejects(
    inTransaction(async () => {
      rolledId = (await items.createWorkItem(actor, project.id, {
        type: "TASK",
        title: "将回滚",
      }))!.id;
      check(received.length === 0, "未提交事务不能先外发");
      check(
        (await db.select().from(webhookDelivery)).length === 1,
        "事务内持久化待投递记录",
      );
      throw new Error("rollback fixture");
    }),
    /rollback fixture/,
  );
  check(received.length === 0, "业务回滚无HTTP外发");
  check(
    (await db.select().from(webhookDelivery)).length === 0,
    "业务回滚清除待投递记录",
  );
  check(
    (await db.select().from(workItem).where(eq(workItem.id, rolledId)))
      .length === 0,
    "业务工作项确已回滚",
  );

  let item = (await inTransaction(() =>
    items.createWorkItem(actor, project.id, { type: "TASK", title: "已提交" }),
  ))!;
  check(
    received.length === 1 && received[0]!.event === "work_item.created",
    "创建提交后真实投递一次",
  );
  check(received[0]!.data.id === item.id, "事件关联本次工作项");
  check(
    received.every((e) => e.committed),
    "接收端独立连接只能读到已提交投递行",
  );
  const baseline = received.length;
  await assert.rejects(
    inTransaction(async () => {
      await items.updateWorkItem(actor, item.id, {
        version: item.version,
        title: "回滚更新",
      });
      check(received.length === baseline, "更新未提交不能外发");
      throw new Error("rollback update");
    }),
    /rollback update/,
  );
  check(received.length === baseline, "回滚更新没有假事件");
  item = (
    await withIdempotency(
      {
        actorId: actor.memberId,
        key: "webhook-update",
        scope: "fixture.webhook",
        body: { itemId: item.id },
      },
      () =>
        items.updateWorkItem(actor, item.id, {
          version: item.version,
          title: "真实更新",
        }),
    )
  ).value!;
  check(received.at(-1)!.event === "work_item.updated", "更新提交真实投递");
  const afterUpdate = received.length;
  await withIdempotency(
    {
      actorId: actor.memberId,
      key: "webhook-update",
      scope: "fixture.webhook",
      body: { itemId: item.id },
    },
    () => {
      throw new Error("replay must not run");
    },
  );
  check(received.length === afterUpdate, "幂等回放不重复投递");
  await assert.rejects(
    items.updateWorkItem(actor, item.id, {
      version: item.version - 1,
      title: "版本冲突",
    }),
    (e) => (e as { code: string }).code === "VERSION_CONFLICT",
  );
  check(received.length === afterUpdate, "版本冲突没有假事件");

  const current = await items.getWorkItem(actor, item.id);
  const allowed = await items.allowedTransitions(actor, current);
  check(allowed.length > 0, "真实项目有允许迁移");
  const [target] =
    await sql`select id from workflow_state where workflow_id=${current.workflowId} and key=${allowed[0]!.toStateKey}`;
  await db
    .update(workflowTransition)
    .set({ requiresApproval: true, approverRoleKeys: ["ADMIN"] })
    .where(
      and(
        eq(workflowTransition.workflowId, current.workflowId),
        eq(workflowTransition.fromStateId, current.statusId),
        eq(workflowTransition.toStateId, target!.id),
      ),
    );
  await assert.rejects(
    items.transitionWorkItem(actor, item.id, {
      toStateKey: allowed[0]!.toStateKey,
      version: current.version,
    }),
    (e) => (e as { code: string }).code === "BLOCKED_BY_PREREQUISITE",
  );
  check(received.length === afterUpdate, "等待审批不投递虚假流转事件");
  await rollbackProbe("流转", () =>
    items.transitionWorkItem(
      actor,
      item.id,
      { toStateKey: allowed[0]!.toStateKey, version: current.version },
      { skipApproval: true },
    ),
  );
  await inTransaction(() =>
    items.transitionWorkItem(
      actor,
      item.id,
      { toStateKey: allowed[0]!.toStateKey, version: current.version },
      { skipApproval: true },
    ),
  );
  check(
    received.at(-1)!.event === "work_item.transitioned",
    "真实流转提交后投递",
  );

  await rollbackProbe("评论创建", () =>
    comments.createComment(actor, {
      targetType: "WORK_ITEM",
      targetId: item.id,
      body: "将回滚评论",
    }),
  );
  await inTransaction(() =>
    comments.createComment(actor, {
      targetType: "WORK_ITEM",
      targetId: item.id,
      body: "私密正文不出事件",
    }),
  );
  check(received.at(-1)!.event === "comment.created", "评论创建事件接线");
  await rollbackProbe("想法创建", () =>
    ideas.createIdea(actor, project.id, { title: "将回滚想法" }),
  );
  const idea = (await inTransaction(() =>
    ideas.createIdea(actor, project.id, {
      title: "私密想法标题",
      description: "私密想法正文",
    }),
  ))!;
  check(received.at(-1)!.event === "idea.created", "想法创建事件接线");
  await rollbackProbe("想法转化", () =>
    ideas.promote(actor, idea.id, { type: "TASK" }),
  );
  check(
    !(await ideas.getIdea(actor, idea.id)).promotedWorkItemId,
    "回滚的想法转化没有回填工作项",
  );
  await inTransaction(() => ideas.promote(actor, idea.id, { type: "TASK" }));
  check(received.at(-1)!.event === "idea.promoted", "想法转化事件接线");
  const afterPromote = received.length;
  await ideas.promote(actor, idea.id, { type: "TASK" });
  check(received.length === afterPromote, "想法转化幂等不重复投递");
  await rollbackProbe("里程碑创建", () =>
    planning.createPlan(actor, project.id, "milestone", {
      name: "将回滚里程碑",
    }),
  );
  await inTransaction(() =>
    planning.createPlan(actor, project.id, "milestone", { name: "里程碑" }),
  );
  check(received.at(-1)!.event === "milestone.created", "里程碑创建事件接线");
  const form = await intake.createForm(actor, project.id, {
    name: "外部需求",
    schema: [{ key: "title", label: "标题", type: "TEXT", required: true }],
  });
  await rollbackProbe("外部提交", () =>
    intake.publicSubmit(form.submitToken, { title: "将回滚提交" }),
  );
  await inTransaction(() =>
    intake.publicSubmit(form.submitToken, { title: "私密提交正文" }),
  );
  check(received.at(-1)!.event === "intake.submitted", "匿名需求提交事件接线");

  const fields = await import("../src/server/services/custom-field.service.ts");
  const definition = (await fields.createDef(actor, project.id, { key: "webhook_text", name: "事件字段", type: "TEXT" }))!;
  const fieldItem = await items.getWorkItem(actor, item.id);
  const fieldCount = received.length;
  await rollbackProbe("自定义字段赋值", () => fields.setValues(actor, item.id, { [definition.id]: "将回滚字段" }, fieldItem.version));
  await fields.setValues(actor, item.id, { [definition.id]: "私密字段值" }, fieldItem.version);
  check(received.length === fieldCount + 1 && received.at(-1)!.event === "work_item.updated", "自定义字段赋值发出真实工作项更新事件");
  check(Array.isArray(received.at(-1)!.data.changedFields) && (received.at(-1)!.data.changedFields as string[]).includes("customFields"), "字段事件只带字段类别不泄漏值");

  const lifecycle = await import("../src/server/services/plan-lifecycle.service.ts");
  const source = (await planning.createPlan(actor, project.id, "iteration", { name: "原迭代", startDate: "2026-11-01", endDate: "2026-11-15" }))!;
  const carryItem = (await inTransaction(() => items.createWorkItem(actor, project.id, { type: "TASK", title: "待结转", iterationId: source.id })))!;
  const carryCount = received.length;
  await rollbackProbe("迭代结转", () => lifecycle.completeIteration(actor, source.id, { targetIterationId: null }));
  await lifecycle.completeIteration(actor, source.id, { targetIterationId: null });
  check(received.length === carryCount + 1 && received.at(-1)!.data.id === carryItem.id && received.at(-1)!.event === "work_item.updated", "迭代结转对实际移动工作项发出更新事件");
  const completedCount = received.length;
  await lifecycle.completeIteration(actor, source.id, { targetIterationId: null });
  check(received.length === completedCount, "结束迭代重放不重复发更新事件");

  const imports = await import("../src/server/services/import.service.ts");
  const batch = await imports.createBatch(actor, project.id, { filename: "webhook.csv", buffer: Buffer.from("标题\n导入删除验收\n") });
  await imports.setMapping(actor, batch.batch.id, { fieldMap: { 标题: "title" }, defaultType: "TASK" });
  await imports.dryRun(actor, batch.batch.id);
  await inTransaction(() => imports.confirm(actor, batch.batch.id));
  const importCount = received.length;
  await rollbackProbe("导入回滚删除", () => imports.rollback(actor, batch.batch.id));
  const removed = await imports.rollback(actor, batch.batch.id);
  check(removed.removed === 1 && received.length === importCount + 1 && received.at(-1)!.event === "work_item.deleted", "导入回滚对实际移除工作项发出删除事件");
  const removedCount = received.length;
  await imports.rollback(actor, batch.batch.id);
  check(received.length === removedCount, "导入回滚重放不重复发删除事件");

  await rollbackProbe("工作项删除", () => items.deleteWorkItem(actor, item.id));
  check(
    (await items.getWorkItem(actor, item.id)).id === item.id,
    "回滚删除保留工作项",
  );
  await inTransaction(() => items.deleteWorkItem(actor, item.id));
  check(received.at(-1)!.event === "work_item.deleted", "工作项删除提交后投递");
  check(
    new Set(received.map((e) => e.event)).size ===
      webhooks.WEBHOOK_EVENTS.length,
    "所有宣称事件均经真实HTTP验收",
  );
  check(
    received.every((e) => e.committed),
    "所有外发均等待事务提交",
  );
  check(
    !JSON.stringify(received).includes("私密"),
    "事件不泄漏正文或表单提交内容",
  );
  const deliveries = await db.select().from(webhookDelivery);
  check(
    deliveries.length === received.length &&
      deliveries.every((d) => d.status === "SUCCEEDED"),
    "投递状态真实复读全部成功",
  );
  await mkdir("docs/evidence/full-business-closure-2026-11-16", {
    recursive: true,
  });
  await writeFile(
    "docs/evidence/full-business-closure-2026-11-16/webhook-commit.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        fixture: "random-isolated-database-and-local-http",
        events: [...new Set(received.map((e) => e.event))],
        httpDeliveries: received.length,
        assertions,
        deliveryStatuses: deliveries.map((d) => d.status),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `domain webhook commit contracts passed: ${webhooks.WEBHOOK_EVENTS.length} events, ${received.length} HTTP deliveries, ${checks} assertions`,
  );
} finally {
  restore();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await external.end();
  await (await import("../src/server/auth/cache.ts")).closeCache();
  await sql.end();
}
