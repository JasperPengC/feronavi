// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused/unused");
  return { writes: [] as string[] };
});
// 仅替换外部连接；实际 ALS、Drizzle adapter 和完成队列均执行生产实现。
vi.mock("postgres", () => ({ default: () => Object.assign(() => {}, { options: { parsers: {}, serializers: {} } }) }));
import { onReservedConnection, sql } from "../src/db/index.ts";
import { currentDatabaseContext, deferAfterCommit } from "../src/db/context.ts";
const connection = Object.assign(async (strings: TemplateStringsArray) => { fake.writes.push(strings.join("?")); return []; }, { unsafe: async () => [] });
afterEach(() => { fake.writes.length = 0; vi.restoreAllMocks(); });

it("保留连接等待后续操作及其新增链完成，期间上下文仍可使用", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let finished = false;
  const running = onReservedConnection(connection, async () => {
    expect(deferAfterCommit(async () => {
      entered(); await gate;
      await sql`first`;
      expect(currentDatabaseContext()?.active).toBe(true);
      expect(deferAfterCommit(async () => { await sql`nested`; })).toBe(true);
    })).toBe(true);
  }).then(() => { finished = true; });
  await Promise.race([started, running]);
  expect(finished).toBe(false);
  release(); await running;
  expect(fake.writes).toEqual(["first", "nested"]);
});

it("非事务主任务失败也完成已提交写入的后续操作", async () => {
  await expect(onReservedConnection(connection, async () => {
    deferAfterCommit(async () => { await sql`persisted-effect`; });
    throw new Error("later failure");
  })).rejects.toThrow("later failure");
  expect(fake.writes).toEqual(["persisted-effect"]);
});

it("单个后续操作失败不会跳过剩余队列", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await onReservedConnection(connection, async () => {
    deferAfterCommit(async () => { throw new Error("effect failure"); });
    deferAfterCommit(async () => { await sql`surviving-effect`; });
  });
  expect(fake.writes).toEqual(["surviving-effect"]);
});
