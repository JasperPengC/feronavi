// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ reads: [] as unknown[][], expanded: [] as unknown[] }));
vi.mock("../src/db/index.ts", () => ({ db: {
  select: () => {
    const rows = fake.reads.shift() ?? [];
    const query = { from: () => query, where: () => query, innerJoin: () => query, limit: async () => rows, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  },
  execute: async () => fake.expanded,
} }));
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { can } from "../src/server/permission/engine.ts";
const action = "work_item:update_any";
beforeEach(() => {
  fake.reads = [[{ id: "m", username: "m", name: "m", status: "ACTIVE", locale: "zh-CN", timezone: null, isInitialAdmin: false, anonymizedAt: null }], []];
  fake.expanded = [];
});
it("加载空角色时保留空权限集合", async () => {
  fake.reads.push([{ roleKey: "empty", scopeType: "ORG", scopeId: null }], [{ id: "empty-id", key: "empty" }], []);
  const actor = await loadActor("m");
  expect(actor?.rolePermissions?.get("empty")).toEqual(new Set());
});
it("每个部门角色只展开该部门闭包，不共享其他部门项目", async () => {
  fake.reads.push([{ roleKey: "manager", scopeType: "DEPARTMENT", scopeId: "dept-a" }, { roleKey: "reader", scopeType: "DEPARTMENT", scopeId: "dept-b" }], [{ id: "manager-id", key: "manager" }, { id: "reader-id", key: "reader" }], [{ roleId: "manager-id", key: action }]);
  fake.expanded = [{ role_key: "manager", root_id: "dept-a", id: "project-a", department_id: "dept-a" }, { role_key: "reader", root_id: "dept-b", id: "project-b", department_id: "dept-b" }];
  const actor = (await loadActor("m"))!;
  const ctx = { memberId: "m", memberProjectIds: new Set<string>(), memberTeamIds: new Set<string>() };
  expect(can(actor, action, { projectId: "project-b" }, ctx)).toBe(false);
  expect(can(actor, action, { projectId: "project-a" }, ctx)).toBe(true);
});
