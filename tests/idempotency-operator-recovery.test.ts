// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ row: null as null | Record<string, unknown>, audits: [] as Record<string, unknown>[], locked: true }));
vi.mock("../src/db/schema.ts", () => ({ idempotencyKey: { name: "claim", key: "key", actorId: "actorId", scope: "scope" }, auditEntry: { name: "audit" } }));
vi.mock("../src/db/index.ts", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => fake.row ? [fake.row] : [] }) }) }),
    insert: () => ({ values: async (row: Record<string, unknown>) => { fake.audits.push(row); } }),
    update: () => ({ set: (patch: object) => ({ where: async () => { Object.assign(fake.row!, patch); } }) }),
    delete: () => ({ where: async () => { fake.row = null; } }),
    execute: async () => [{ ok: fake.locked }],
  },
  inTransaction: async (fn: () => Promise<unknown>) => fn(),
}));
import { inspectIdempotency, recoverIdempotency } from "../src/server/services/idempotency-recovery.service.ts";
const identity = { actorId: "00000000-0000-4000-8000-000000000001", scope: "work_item.create", key: "private-key" };
const recovery = { ...identity, expectedRequestHash: "a".repeat(64), operatorId: "00000000-0000-4000-8000-000000000002", evidence: "DB rollback verified, incident-42" };
beforeEach(() => {
  fake.audits = []; fake.locked = true;
  fake.row = { ...identity, state: "IN_PROGRESS", requestHash: recovery.expectedRequestHash, responseBody: { private: true }, createdAt: new Date(0), expiresAt: new Date(0) };
});
it("检查只返回恢复元数据，不显示幂等键或响应正文，不修改记录", async () => {
  const result = await inspectIdempotency(identity);
  expect(result).toMatchObject({ state: "IN_PROGRESS", requestHash: recovery.expectedRequestHash });
  expect(result).not.toHaveProperty("key"); expect(result).not.toHaveProperty("responseBody");
  expect(fake.audits).toHaveLength(0);
});
it("确认已回滚后才释放旧 claim，同时留下不可逆关联和操作人审计", async () => {
  await recoverIdempotency({ ...recovery, resolution: "ROLLED_BACK" });
  expect(fake.row).toBeNull();
  expect(fake.audits).toHaveLength(1);
  expect(fake.audits[0]).toMatchObject({ actorId: recovery.operatorId, severity: "SECURITY", action: "idempotency.recover.rolled_back" });
  expect(JSON.stringify(fake.audits)).not.toContain(identity.key);
  expect(JSON.stringify(fake.audits)).not.toContain(recovery.evidence);
});
it("确认已提交后写入确定响应，之后可正常重放", async () => {
  await recoverIdempotency({ ...recovery, resolution: "COMMITTED", response: { id: "existing-result" } });
  expect(fake.row).toMatchObject({ state: "DONE", responseBody: { id: "existing-result" } });
  expect((fake.row!.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  expect(fake.audits).toHaveLength(1);
});
it.each(["hash", "running", "done"])("%s 状态不符时不能恢复或写审计", async (mode) => {
  if (mode === "running") fake.locked = false;
  if (mode === "done") fake.row!.state = "DONE";
  await expect(recoverIdempotency({ ...recovery, expectedRequestHash: mode === "hash" ? "b".repeat(64) : recovery.expectedRequestHash, resolution: "ROLLED_BACK" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fake.row).not.toBeNull(); expect(fake.audits).toHaveLength(0);
});
