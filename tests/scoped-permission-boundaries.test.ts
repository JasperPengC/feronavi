// @vitest-environment node
import { expect, it } from "vitest";
import { can } from "../src/server/permission/engine.ts";
import type { Actor } from "../src/server/permission/actor.ts";
const action = "work_item:update_any";
const actor: Actor = { memberId: "m", username: "m", name: "m", permissions: new Set([action]), grants: [], rolePermissions: new Map([["manager", new Set([action])]]), mustChangePassword: false, locale: "zh-CN", timezone: null, theme: null };
const ctx = { memberId: "m", memberProjectIds: new Set<string>(), memberTeamIds: new Set(["team-a", "team-b"]) };
it("空权限组织角色不能借用另一项目角色的权限", () => {
  const subject = { ...actor, grants: [{ roleKey: "empty", scopeType: "ORG" as const, scopeId: null }, { roleKey: "manager", scopeType: "PROJECT" as const, scopeId: "project-a" }] };
  expect(can(subject, action, { projectId: "project-b" }, ctx)).toBe(false);
  expect(can(subject, action, { projectId: "project-a" }, ctx)).toBe(true);
});
it("团队 A 的管理角色不能通过成员团队并集作用到团队 B", () => {
  const subject = { ...actor, rolePermissions: new Map([["manager", new Set([action])], ["reader", new Set<string>()]]), grants: [{ roleKey: "manager", scopeType: "TEAM" as const, scopeId: "team-a" }, { roleKey: "reader", scopeType: "TEAM" as const, scopeId: "team-b" }] };
  expect(can(subject, action, { projectId: null, teamId: "team-b" }, ctx)).toBe(false);
  expect(can(subject, action, { projectId: null, teamId: "team-a" }, ctx)).toBe(true);
});
it("项目成员关系不能借用另一个项目的管理角色", () => {
  const subject = { ...actor, grants: [{ roleKey: "manager", scopeType: "PROJECT" as const, scopeId: "project-a" }] };
  expect(can(subject, action, { projectId: "project-b" }, { ...ctx, memberProjectIds: new Set(["project-b"]) })).toBe(false);
});
