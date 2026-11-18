// @vitest-environment node
/**
 * 权限引擎测试 —— 188 个断言全部由基线第 5.2 节矩阵程序化生成
 *
 * ⚠️ 本文件**不含**任何手写的「角色 → 权限」期望值。期望值来自
 * `tests/permission-matrix.generated.json`（由 scripts/gen-permission-matrix.mjs 产出）。
 * 矩阵改了 → 重跑生成脚本 → 断言自动跟着变。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { can, hasPermission, isOwnScoped, scopeCovers } from "../src/server/permission/engine.ts";
import type { Actor, ScopeGrant } from "../src/server/permission/actor.ts";

const matrix: { permissions: string[]; roles: Record<string, string[]> } =
  JSON.parse(readFileSync(new URL("./permission-matrix.generated.json", import.meta.url), "utf8"));

function actorFor(role: string): Actor {
  return {
    memberId: "m-1",
    username: "tester",
    name: "测试",
    permissions: new Set(matrix.roles[role]),
    grants: [{ roleKey: role, scopeType: "ORG", scopeId: null }],
    mustChangePassword: false,
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
  };
}

// 组织级资源：ORG 档覆盖一切，用于纯粹测「角色 × 动作」
const ORG_RES = { projectId: null, teamId: null, createdBy: "someone-else" };
const CTX = { memberProjectIds: new Set<string>(), memberTeamIds: new Set<string>(), memberId: "m-1" };

describe("权限矩阵（47 动作 × 4 角色 = 188 个断言）", () => {
  for (const role of ["ADMIN", "PM", "MEMBER", "GUEST"]) {
    const allowed = new Set(matrix.roles[role]);
    describe(role, () => {
      for (const action of matrix.permissions) {
        const want = allowed.has(action);
        it(`${action} → ${want ? "允许" : "拒绝"}`, () => {
          const actor = actorFor(role);
          // `_own` 动作在组织级资源上会额外受 createdBy 约束，这里只测权限集合
          const got = isOwnScoped(action)
            ? hasPermission(actor, action)
            : can(actor, action, ORG_RES, CTX);
          expect(got).toBe(want);
        });
      }
    });
  }
});

describe("权限集合本身的完整性", () => {
  it("47 个动作", () => expect(matrix.permissions).toHaveLength(47));
  it("ADMIN 持有全部 47 个", () => expect(matrix.roles.ADMIN).toHaveLength(47));
  it("GUEST 只有 5 个", () => expect(matrix.roles.GUEST).toHaveLength(5));
  it("层级：ADMIN ⊇ PM ⊇ MEMBER ⊇ GUEST", () => {
    const s = (r: string) => new Set(matrix.roles[r]);
    const [a, p, m, g] = [s("ADMIN"), s("PM"), s("MEMBER"), s("GUEST")];
    for (const k of p) expect(a.has(k)).toBe(true);
    for (const k of m) expect(p.has(k)).toBe(true);
    for (const k of g) expect(m.has(k)).toBe(true);
  });
});

describe("数据范围（三档 + _own 后缀）", () => {
  const base: Actor = {
    memberId: "m-1", username: "u", name: "n",
    permissions: new Set(["work_item:update_any", "work_item:update_own"]),
    grants: [], mustChangePassword: false, locale: "zh-CN", timezone: null,
  };
  const grant = (scopeType: ScopeGrant["scopeType"], scopeId: string | null): ScopeGrant =>
    ({ roleKey: "R", scopeType, scopeId });

  it("ORG 档覆盖组织级资源", () => {
    expect(scopeCovers({ ...base, grants: [grant("ORG", null)] }, ORG_RES, CTX)).toBe(true);
  });

  it("TEAM 档：命中本团队通过", () => {
    const ctx = { ...CTX, memberTeamIds: new Set(["t-1"]) };
    expect(scopeCovers({ ...base, grants: [grant("TEAM", "t-1")] }, { projectId: null, teamId: "t-1" }, ctx)).toBe(true);
  });

  it("TEAM 档：loader 按来源角色展开的子团队授权可用", () => {
    const ctx = { ...CTX, memberTeamIds: new Set(["t-1", "t-2"]) };
    expect(scopeCovers({ ...base, grants: [grant("TEAM", "t-1"), { ...grant("TEAM", "t-2"), synthetic: true }] }, { projectId: null, teamId: "t-2" }, ctx)).toBe(true);
  });

  it("TEAM 档：范围外的团队拒绝", () => {
    const ctx = { ...CTX, memberTeamIds: new Set(["t-1"]) };
    expect(scopeCovers({ ...base, grants: [grant("TEAM", "t-1")] }, { projectId: null, teamId: "t-9" }, ctx)).toBe(false);
  });

  it("PROJECT 档：显式指派的项目通过", () => {
    const actor = { ...base, grants: [grant("PROJECT", "p-1")] };
    expect(scopeCovers(actor, { projectId: "p-1" }, CTX)).toBe(true);
  });

  it("PROJECT 档：无显式指派时回落到「我是项目成员」", () => {
    const ctx = { ...CTX, memberProjectIds: new Set(["p-2"]) };
    expect(scopeCovers(base, { projectId: "p-2" }, ctx)).toBe(true);
  });

  it("PROJECT 档：既无指派也非成员则拒绝", () => {
    expect(scopeCovers(base, { projectId: "p-3" }, CTX)).toBe(false);
  });

  it("_own：非自己创建的资源拒绝「有权限但非本人」的操作", () => {
    const actor = { ...base, grants: [grant("ORG", null)] };
    expect(can(actor, "work_item:update_own", { projectId: null, createdBy: "other" }, CTX)).toBe(false);
    expect(can(actor, "work_item:update_own", { projectId: null, createdBy: "m-1" }, CTX)).toBe(true);
  });

  it("_any：不受 createdBy 约束", () => {
    const actor = { ...base, grants: [grant("ORG", null)] };
    expect(can(actor, "work_item:update_any", { projectId: null, createdBy: "other" }, CTX)).toBe(true);
  });

  it("无该动作权限 → 拒绝（即便范围覆盖）", () => {
    const actor = { ...base, permissions: new Set<string>(), grants: [grant("ORG", null)] };
    expect(can(actor, "work_item:update_any", ORG_RES, CTX)).toBe(false);
  });

  it("有权限但超范围 → 拒绝", () => {
    const actor = { ...base, grants: [grant("PROJECT", "p-9")] };
    expect(can(actor, "work_item:update_any", { projectId: "p-1" }, CTX)).toBe(false);
  });
});

describe("按角色绑定作用域（Round 75，行业标准 scoped RBAC）", () => {
  const A = "project-a";
  const B = "project-b";
  const rolePermissions = new Map<string, ReadonlySet<string>>([
    ["MEMBER", new Set(["work_item:update_own", "work_item:read_any"])],
    ["ADMIN", new Set(["work_item:update_any", "work_item:read_any"])],
  ]);
  const actor: Actor = {
    memberId: "m-1", username: "u", name: "n",
    permissions: new Set(["work_item:update_own", "work_item:update_any", "work_item:read_any"]), // UI 并集
    grants: [
      { roleKey: "MEMBER", scopeType: "ORG", scopeId: null },
      { roleKey: "ADMIN", scopeType: "PROJECT", scopeId: A },
    ],
    rolePermissions,
    mustChangePassword: false, locale: "zh-CN", timezone: null,
  };
  const ctx = { memberProjectIds: new Set<string>(), memberTeamIds: new Set<string>(), memberId: "m-1" };

  it("项目 A 由 ADMIN 授权覆盖：可 update_any", () => {
    expect(can(actor, "work_item:update_any", { projectId: A, teamId: null, createdBy: "other" }, ctx)).toBe(true);
  });
  it("项目 B 只有 ORG MEMBER 授权：**不能**借 ADMIN 的权限（并集放大被禁止）", () => {
    expect(can(actor, "work_item:update_any", { projectId: B, teamId: null, createdBy: "other" }, ctx)).toBe(false);
  });
  it("项目 B 的 MEMBER 自身权限（read_any）仍可用", () => {
    expect(can(actor, "work_item:read_any", { projectId: B, teamId: null }, ctx)).toBe(true);
  });
  it("部门 ADMIN 展开为 synthetic PROJECT 授权后，只覆盖被展开项目", () => {
    const deptActor: Actor = {
      ...actor,
      grants: [
        { roleKey: "MEMBER", scopeType: "ORG", scopeId: null },
        { roleKey: "ADMIN", scopeType: "PROJECT", scopeId: A, synthetic: true },
      ],
    };
    expect(can(deptActor, "work_item:update_any", { projectId: A, teamId: null, createdBy: "other" }, ctx)).toBe(true);
    expect(can(deptActor, "work_item:update_any", { projectId: B, teamId: null, createdBy: "other" }, ctx)).toBe(false);
  });
  it("ORG ADMIN 授权覆盖所有项目", () => {
    const orgAdmin: Actor = {
      ...actor,
      grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }],
    };
    expect(can(orgAdmin, "work_item:update_any", { projectId: B, teamId: null, createdBy: "other" }, ctx)).toBe(true);
  });
});
