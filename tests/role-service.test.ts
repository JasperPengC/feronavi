// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/server/permission/actor.ts";

const mocks = vi.hoisted(() => {
  const state = {
    selects: [] as unknown[][],
    returns: [] as unknown[][],
    transaction: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    cacheDel: vi.fn(async () => 1),
  };
  type Thenable = {
    from: () => Thenable;
    where: () => Thenable;
    orderBy: () => Thenable;
    limit: () => Thenable;
    for: () => Thenable;
    set: () => Thenable;
    values: () => Thenable;
    returning: () => Promise<unknown[]>;
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise<unknown>;
  };
  const thenable = (result: unknown[] = []): Thenable => {
    const builder: Thenable = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      for: () => builder,
      set: () => builder,
      values: () => builder,
      returning: () => Promise.resolve(state.returns.shift() ?? result),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };
  const tx = {
    select: vi.fn(() => thenable(state.selects.shift() ?? [])),
    update: vi.fn(() => thenable()),
    delete: vi.fn(() => thenable()),
    insert: vi.fn(() => thenable()),
  };
  state.select.mockImplementation(() => thenable(state.selects.shift() ?? []));
  state.update.mockImplementation(() => thenable());
  state.delete.mockImplementation(() => thenable());
  state.insert.mockImplementation(() => thenable());
  state.transaction.mockImplementation(async (callback: (tx: typeof tx) => unknown) => callback(tx));
  return { state, tx };
});

vi.mock("../src/db/index.ts", () => ({ db: mocks.state }));
vi.mock("../src/server/auth/cache.ts", () => ({
  getRedisClient: () => ({ del: mocks.state.cacheDel }),
}));

import { createRole, deleteRole, listRoles, updateRole } from "../src/server/services/role.service.ts";

const MANAGER: Actor = {
  memberId: "11111111-1111-4111-8111-111111111111",
  username: "manager",
  name: "Manager",
  permissions: new Set(["role:manage"]),
  grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }],
  mustChangePassword: false,
  locale: "zh-CN",
  timezone: null,
};

const TEAM_MANAGER: Actor = {
  ...MANAGER,
  grants: [{ roleKey: "CUSTOM", scopeType: "TEAM", scopeId: "22222222-2222-4222-8222-222222222222" }],
};

beforeEach(() => {
  mocks.state.selects.length = 0;
  mocks.state.returns.length = 0;
  mocks.state.select.mockClear();
  mocks.state.update.mockClear();
  mocks.state.delete.mockClear();
  mocks.state.insert.mockClear();
  mocks.state.transaction.mockClear();
  mocks.state.cacheDel.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("role.service", () => {
  it("拒绝缺少 role:manage 或 ORG 范围的服务调用，且不访问数据库", async () => {
    const noPermission = { ...MANAGER, permissions: new Set<string>() };
    await expect(listRoles(noPermission)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createRole(TEAM_MANAGER, { slug: "reviewer", name: "Reviewer", permissionKeys: [] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.state.select).not.toHaveBeenCalled();
    expect(mocks.state.transaction).not.toHaveBeenCalled();
  });

  it("拒绝管理员或系统角色变更，事务在写入前终止", async () => {
    mocks.state.selects.push([{ id: "role-admin", key: "ADMIN", name: "Admin", isBuiltin: true, isSystem: true }]);
    await expect(updateRole(MANAGER, "role-admin", { name: "Changed", permissionKeys: [] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.tx.update).not.toHaveBeenCalled();
    expect(mocks.tx.delete).not.toHaveBeenCalled();

    mocks.state.selects.push([{ id: "role-admin", isBuiltin: true, isSystem: true }]);
    await expect(deleteRole(MANAGER, "role-admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.tx.delete).not.toHaveBeenCalled();
  });

  it("拒绝未知或格式不合法的权限/角色标识后再执行任何数据库操作", async () => {
    await expect(createRole(MANAGER, { slug: "ADMIN", name: "Review", permissionKeys: [] }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.state.select).not.toHaveBeenCalled();
    expect(mocks.state.transaction).not.toHaveBeenCalled();
  });

  it("修改角色权限后清理每个受影响成员的权限上下文缓存", async () => {
    vi.stubEnv("REDIS_URL", "redis://isolated-cache.invalid:6379");
    mocks.state.selects.push(
      [{ id: "role-custom", key: "custom:reviewer", name: "Reviewer", isBuiltin: false, isSystem: false }],
      [{ memberId: "member-2" }, { memberId: "member-3" }],
    );
    mocks.state.returns.push([{ id: "role-custom", key: "custom:reviewer", name: "Reviewer Updated", isBuiltin: false, isSystem: false }]);

    const updated = await updateRole(MANAGER, "role-custom", { name: "Reviewer Updated", permissionKeys: [] });

    expect(updated.name).toBe("Reviewer Updated");
    expect(updated.permissionKeys).toEqual([]);
    expect(mocks.state.cacheDel).toHaveBeenCalledWith("perm-ctx:member-2", "perm-ctx:member-3");
  });
});
