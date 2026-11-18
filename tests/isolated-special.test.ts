// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn() }));
vi.mock("postgres", () => ({ default: (url: string) => { fake.connect(url); return { unsafe: fake.query, end: fake.end }; } }));
import { createSiblingTestDatabase, startIsolatedMultiInstance } from "./support/isolated-special.ts";
const name = `feronavi_test_${"a".repeat(32)}`;
const env = { FERONAVI_TEST_DATABASE: name, DATABASE_URL: `postgres://fixture@127.0.0.1:15432/${name}` };
beforeEach(() => { vi.resetAllMocks(); fake.query.mockResolvedValue([]); fake.end.mockResolvedValue(undefined); });
it.each([{}, { DATABASE_URL: "postgres://localhost/development" }, { ...env, BASE: "http://localhost:3000" }])("未声明有效隔离库时，任何连接或容器启动前就拒绝", async (input) => {
  await expect(createSiblingTestDatabase(input)).rejects.toThrow("隔离");
  await expect(startIsolatedMultiInstance(input)).rejects.toThrow("隔离");
  expect(fake.connect).not.toHaveBeenCalled();
});
it("随机兄弟库只使用已验证源连接，清理仅删除自己创建的名称", async () => {
  const database = await createSiblingTestDatabase(env);
  expect(database.name).toMatch(/^feronavi_test_[a-f0-9]{32}$/u);
  expect(database.name).not.toBe(name);
  expect(fake.connect).toHaveBeenCalledWith(env.DATABASE_URL);
  expect(fake.query.mock.calls.map(([query]) => query)).toEqual([`CREATE DATABASE "${database.name}" TEMPLATE template0`]);
  await database.cleanup();
  expect(fake.query.mock.calls.map(([query]) => query)).toEqual([`CREATE DATABASE "${database.name}" TEMPLATE template0`, `DROP DATABASE "${database.name}" WITH (FORCE)`]);
});
it("建库失败时不得预删或清理碰撞名称，只关闭自己打开的连接", async () => {
  fake.query.mockRejectedValueOnce(new Error("already exists"));
  await expect(createSiblingTestDatabase(env)).rejects.toThrow("already exists");
  expect(fake.query).toHaveBeenCalledTimes(1);
  expect(fake.end).toHaveBeenCalledOnce();
});
