// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const invokeGuard = (extra: NodeJS.ProcessEnv = {}) => {
  const env = { ...process.env, ...extra };
  delete env.DATABASE_URL;
  delete env.FERONAVI_TEST_DATABASE;
  Object.assign(env, extra);
  return spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./scripts/_env.ts'); console.log('accepted')"], { env, encoding: "utf8" });
};

describe("旧测试脚本的数据隔离边界", () => {
  it("缺少隔离夹具时失败，不能自动连接开发数据库", () => {
    const result = invokeGuard();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("隔离");
    expect(result.stdout).not.toContain("accepted");
  });

  it("即使设置 DATABASE_URL 也拒绝开发库", () => {
    const result = invokeGuard({ DATABASE_URL: "postgres://example:unused@127.0.0.1:1/feronavi" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("accepted");
  });

  it("只接受夹具名称与连接目标一致的随机测试库", () => {
    const name = `feronavi_test_${"a".repeat(32)}`;
    const result = invokeGuard({ DATABASE_URL: `postgres://example:unused@127.0.0.1:1/${name}`, FERONAVI_TEST_DATABASE: name });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("accepted");
  });

  it("目标库与夹具声明不一致时拒绝执行", () => {
    const result = invokeGuard({ DATABASE_URL: `postgres://example:unused@127.0.0.1:1/feronavi_test_${"b".repeat(32)}`, FERONAVI_TEST_DATABASE: `feronavi_test_${"a".repeat(32)}` });
    expect(result.status).not.toBe(0);
  });

  it("拒绝把隔离执行器用于仓库外脚本", () => {
    const result = spawnSync(process.execPath, ["scripts/run-isolated-test.ts", "../outside.ts"], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("测试脚本");
  });
});
