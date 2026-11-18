// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const command = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: command }));
vi.mock("node:fs", () => ({ openSync: () => 9, closeSync: vi.fn(), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() }));
import { pgDumpCustom, pgRestoreCustom } from "../scripts/lib/backup-tools.ts";
afterEach(() => { vi.unstubAllEnvs(); command.mockReset(); });
it.each([undefined, "test-postgres"])("备份恢复不把数据库密码写入命令参数（容器=%s）", (container) => {
  vi.stubEnv("PG_CONTAINER", container);
  const url = "postgres://tester:secret%40password@127.0.0.1:54329/testdb";
  pgDumpCustom(url, "/tmp/test.dump");
  pgRestoreCustom(url, "/tmp/test.dump");
  const calls = command.mock.calls.filter(([binary, args]) => binary !== "docker" || args.includes("pg_dump") || args.includes("pg_restore"));
  expect(calls).toHaveLength(2);
  for (const [, args, options] of calls) {
    expect(JSON.stringify(args)).not.toContain("secret");
    expect(options.env.PGPASSWORD).toBe("secret@password");
    if (container) expect(args).toContain("PGPASSWORD");
  }
});
