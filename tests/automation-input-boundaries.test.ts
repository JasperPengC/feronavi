// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "../src/server/permission/actor.ts";
const fake = vi.hoisted(() => ({ rules: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[], comments: [] as string[], actor: undefined as unknown, recurse: false, itemPage: 0 }));
vi.mock("../src/db/index.ts", () => ({ db: {
  transaction: async (run: () => Promise<unknown>) => run(),
  select: () => ({ from: (table: object) => ({ where: () => {
    const rows = "trigger" in table ? fake.rules : [{ id: "w1", projectId: "p1", workflowId: "wf1", title: "work", priority: "HIGH" }];
    return { for: async () => fake.rules.filter((row) => row.scheduleState), then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve), limit: async () => rows,
      orderBy: () => ({ limit: async () => fake.itemPage++ === 0 ? rows : [] }) };
  } }) }),
  insert: () => ({ values: (value: Record<string, unknown>) => { fake.writes.push(value); return { returning: async () => [{ id: "new-rule", ...value }] }; } }),
  update: () => ({ set: (value: Record<string, unknown>) => { fake.writes.push(value);
    if ("scheduleState" in value) {
      const selected = fake.rules.find((row) => row.id === "good");
      if (selected) selected.scheduleState = value.scheduleState;
    }
    return { where: () => ({ returning: async () => [{ id: "rule", ...value }] }) }; } }),
}, sql: {} }));
vi.mock("../src/server/repos/project.repo.ts", () => ({ isVisibleTo: async () => true }));
vi.mock("../src/server/repos/work-item.repo.ts", () => ({ findById: async () => ({ id: "w1", projectId: "p1", workflowId: "wf1", version: 1 }) }));
vi.mock("../src/server/repos/workflow.repo.ts", () => ({ listStates: async () => [] }));
vi.mock("../src/server/auth/actor-loader.ts", () => ({ loadActor: async () => fake.actor }));
vi.mock("../src/server/services/comment.service.ts", () => ({ createComment: async (_actor: Actor, input: { body: string }) => {
  fake.comments.push(input.body);
  if (fake.comments.length > 5) throw new Error("递归防护未生效");
  if (fake.recurse) await (await import("../src/server/services/automation.service.ts")).runAutomation("COMMENT_ADDED", "w1");
  return { id: "comment" };
} }));
import { createRule, updateRule, runScheduledAutomations, triggerAutomation, runAutomation } from "../src/server/services/automation.service.ts";
import { databaseContext, type DatabaseContext } from "../src/db/context.ts";
const actor: Actor = { memberId: "m1", username: "audit", name: "audit", permissions: new Set(["project:update"]), grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }], rolePermissions: new Map([["ADMIN", new Set(["project:update"])]]), mustChangePassword: false, locale: "zh-CN", timezone: null, theme: null };
beforeEach(() => { fake.rules = []; fake.writes = []; fake.comments = []; fake.actor = actor; fake.recurse = false; fake.itemPage = 0; });

it.each([
  { conditions: { all: 123 } }, { actions: [{}] }, { actions: [{ type: "UNKNOWN" }] },
  { actions: [{ type: "ASSIGN", memberId: "not-a-uuid" }] }, { conditions: { all: [{ field: "priority", op: "made_up" }] } },
])("服务创建和更新拒绝非法规则且不写入 %j", async (bad) => {
  await expect(createRule(actor, "p1", { name: "bad", trigger: "WORK_ITEM_CREATED", actions: [{ type: "ADD_COMMENT", body: "ok" }], ...bad } as never)).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(updateRule(actor, "p1", "rule", bad as never)).rejects.toMatchObject({ code: "VALIDATION" });
  expect(fake.writes).toEqual([]);
});

it.each(["SCHEDULE", "WORK_ITEM_UPDATED"] as const)("旧坏规则记录失败并继续下一规则：%s", async (trigger) => {
  const base = { projectId: "p1", createdBy: "m1", trigger, enabled: true, scheduleCron: "* * * * *", scheduleTimezone: "UTC", lastScheduledAt: null };
  fake.rules = [
    { ...base, id: "bad", name: "bad", conditions: { all: 123 }, actions: [{}] },
    { ...base, id: "good", name: "good", conditions: {}, actions: [{ type: "ADD_COMMENT", body: "survived" }] },
  ];
  if (trigger === "SCHEDULE") await runScheduledAutomations(new Date("2026-11-08T00:00:00Z"));
  else await triggerAutomation(trigger, "w1");
  expect(fake.comments).toEqual(["survived"]);
  expect(fake.writes).toContainEqual(expect.objectContaining({ ruleId: "bad", status: "FAILED" }));
});

it("保留连接队列中的自动化联动仍受三层递归上限保护", async () => {
  fake.recurse = true;
  fake.rules = [{ id: "recursive", name: "recursive", projectId: "p1", createdBy: "m1", trigger: "COMMENT_ADDED", conditions: {}, actions: [{ type: "ADD_COMMENT", body: "bounded" }] }];
  const context: DatabaseContext = { database: {}, connection: {}, active: true, transaction: false, afterCommit: [], afterCompletion: [] };
  await databaseContext.run(context, async () => {
    await runAutomation("COMMENT_ADDED", "w1");
    for (const callback of context.afterCompletion) await callback();
  });
  expect(fake.comments).toEqual(["bounded", "bounded", "bounded"]);
});
