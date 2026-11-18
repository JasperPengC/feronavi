// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ row: null as null | Record<string, unknown>, businessWrites: 0 }));
vi.mock("../src/db/schema.ts", () => ({ idempotencyKey: { key: "key", actorId: "actorId", scope: "scope", expiresAt: "expiresAt", state: "state" } }));
vi.mock("../src/db/index.ts", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => fake.row ? [fake.row] : [] }) }) }),
    insert: () => ({ values: async (row: Record<string, unknown>) => { fake.row = row; } }),
    update: () => ({ set: (patch: object) => ({ where: async () => { Object.assign(fake.row!, patch); } }) }),
    delete: () => ({ where: async () => { fake.row = null; } }),
    execute: async () => [{ ok: true }],
  },
  inTransaction: async (fn: () => Promise<unknown>) => {
    const previous = fake.row ? { ...fake.row } : null;
    const writes = fake.businessWrites;
    try { return await fn(); } catch (error) { fake.row = previous; fake.businessWrites = writes; throw error; }
  },
}));
import { hashRequest, withIdempotency } from "../src/server/services/idempotency.service.ts";
const input = { actorId: "actor", scope: "operation", key: "retry", body: { title: "x" } };
beforeEach(() => { fake.row = null; fake.businessWrites = 0; });
it("业务中途失败时，业务写入与幂等占位一起回滚，同键可重试", async () => {
  await expect(withIdempotency(input, async () => { fake.businessWrites++; throw new Error("temporary failure"); })).rejects.toThrow("temporary failure");
  expect(fake.businessWrites).toBe(0);
  expect(fake.row).toBeNull();
  expect(await withIdempotency(input, async () => { fake.businessWrites++; return { ok: true }; })).toEqual({ replayed: false, value: { ok: true } });
  expect(fake.businessWrites).toBe(1);
});
it("成功结果重放，不重新执行业务", async () => {
  await withIdempotency(input, async () => { fake.businessWrites++; return { id: "created" }; });
  expect(await withIdempotency(input, async () => { fake.businessWrites++; return { id: "duplicate" }; })).toEqual({ replayed: true, value: { id: "created" } });
  expect(fake.businessWrites).toBe(1);
});
it("已过期 DONE 可作为新请求复用，即使请求体不同", async () => {
  fake.row = { ...input, requestHash: hashRequest({ old: true }), state: "DONE", responseBody: { old: true }, expiresAt: new Date(0) };
  const result = await withIdempotency(input, async () => { fake.businessWrites++; return { fresh: true }; });
  expect(result).toEqual({ replayed: false, value: { fresh: true } });
  expect(fake.businessWrites).toBe(1);
});
it("旧版本遗留的不明 IN_PROGRESS 即使过期也不能自动重执行业务", async () => {
  fake.row = { ...input, requestHash: hashRequest(input.body), state: "IN_PROGRESS", expiresAt: new Date(0) };
  await expect(withIdempotency(input, async () => { fake.businessWrites++; })).rejects.toMatchObject({ code: "CONFLICT", details: { recoveryRequired: true } });
  expect(fake.businessWrites).toBe(0);
});
