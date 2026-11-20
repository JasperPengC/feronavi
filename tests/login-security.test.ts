// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ outcome: true, hashCalls: 0, member: null as null | { id: string; status: string; passwordHash: string }, calls: [] as string[], pending: [] as Array<() => void>, hold: false }));
vi.mock("../src/server/repos/member.repo.ts", () => ({ findByUsernameForAuth: async () => state.member }));
vi.mock("../src/server/auth/session.ts", () => ({ SESSION_TTL_DAYS: 7, SESSION_TTL_DAYS_REMEMBER: 30, createSession: async () => ({ token: "session", expiresAt: new Date() }), revokeSession: async () => {} }));
vi.mock("../src/server/services/audit.service.ts", () => ({ writeSecurityAudit: async () => {} }));
vi.mock("../src/server/services/two-factor.service.ts", () => ({ verifyForLogin: async () => ({ required: false }) }));
vi.mock("@node-rs/argon2", () => ({
  hash: async () => {
    state.hashCalls++;
    if (state.hold) await new Promise<void>((resolve) => state.pending.push(resolve));
    return "$argon2id$real";
  },
  verify: async (stored: string) => {
    state.calls.push(stored);
    if (stored.endsWith("$YQ$Yg")) throw new Error("invalid hash length");
    if (state.hold) await new Promise<void>((resolve) => state.pending.push(resolve));
    return state.outcome;
  },
}));
beforeEach(() => { vi.resetModules(); delete process.env.REDIS_URL; state.calls = []; state.pending = []; state.hold = false; state.member = null; state.outcome = true; state.hashCalls = 0; });
it("未知或注销密码执行真实Argon2校验，结果始终拒绝", async () => {
  const { verifyPassword } = await import("../src/server/auth/password.ts");
  expect(await verifyPassword("!", "anything")).toBe(false);
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0]).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  await verifyPassword("invalid", "anything");
  expect(state.calls[1]).toBe(state.calls[0]);
});
it("密码哈希任务并发有界，无排队累积", async () => {
  const { verifyPassword } = await import("../src/server/auth/password.ts");
  state.hold = true;
  const jobs = Array.from({ length: 4 }, () => verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA", "wrong"));
  await expect(verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA", "wrong")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(state.calls).toHaveLength(4);
  state.pending.forEach((done) => done());
  await Promise.all(jobs);
  state.hold = false;
  expect(await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA", "right")).toBe(true);
});
it("格式正确但损坏的凭据被拒绝，并在底层报错后执行真实dummy校验", async () => {
  const { verifyPassword } = await import("../src/server/auth/password.ts");
  expect(await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$YQ$Yg", "anything")).toBe(false);
  expect(state.calls).toHaveLength(2);
  expect(state.calls[1]).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  expect(state.calls[1]).not.toBe(state.calls[0]);
});
it("未配Redis仍独立限制账户和IP，正确登录不清除IP失败防线", async () => {
  const guard = await import("../src/server/auth/login-guard.ts");
  for (let n = 0; n < 10; n++) await guard.recordLoginFailure("victim", `192.0.2.${n}`);
  expect(await guard.isLockedOut("victim", "198.51.100.1")).toBe(true);
  for (let n = 0; n < 10; n++) await guard.recordLoginFailure(`user-${n}`, "203.0.113.1");
  await guard.clearLoginFailures("some-success", "203.0.113.1");
  expect(await guard.isLockedOut("other-user", "203.0.113.1")).toBe(true);
});
it("未配Redis仍按账户预留尝试额度，挡住并行撞库", async () => {
  const guard = await import("../src/server/auth/login-guard.ts");
  expect(typeof guard.consumeLoginAttempt).toBe("function");
  for (let n = 0; n < 10; n++) expect(await guard.consumeLoginAttempt("parallel", `192.0.2.${n}`)).toBe(true);
  expect(await guard.consumeLoginAttempt("parallel", "198.51.100.1")).toBe(false);
});

it("登录服务的已知错误、未知、注销账号均进入一次底层Argon2验证", async () => {
  const { login } = await import("../src/server/services/auth.service.ts");
  const context = { ip: "192.0.2.200", userAgent: null };
  await expect(login({ username: "missing", password: "anything", remember: false }, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  state.member = { id: "deleted", status: "ANONYMIZED", passwordHash: "!" };
  await expect(login({ username: "deleted", password: "anything", remember: false }, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  state.outcome = false;
  state.member = { id: "known", status: "ACTIVE", passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA" };
  await expect(login({ username: "known", password: "anything", remember: false }, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(state.calls).toHaveLength(3);
  expect(state.calls[0]).toBe(state.calls[1]);
  expect(state.calls[2]).toBe(state.member.passwordHash);
});
it("本地高基数攻击不能驱逐现有额度，窗口结束能恢复", async () => {
  vi.useFakeTimers();
  try {
    const guard = await import("../src/server/auth/login-guard.ts");
    for (let n = 0; n < 10; n++) await guard.consumeLoginAttempt("reserved", "192.0.2.1");
    for (let n = 0; n < 5100; n++) await guard.consumeLoginAttempt(`random-${n}`, `ip-${n}`);
    expect(await guard.consumeLoginAttempt("reserved", "192.0.2.1")).toBe(false);
    expect(await guard.consumeLoginAttempt("new", "new-ip")).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(await guard.consumeLoginAttempt("new", "new-ip")).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("生成与验证密码共用并发预算，繁忙不排队且结束后释放", async () => {
  const { hashPassword, verifyPassword } = await import("../src/server/auth/password.ts");
  state.hold = true;
  const jobs = [hashPassword("first"), hashPassword("second"), verifyPassword("!", "third"), verifyPassword("!", "fourth")];
  await expect(hashPassword("fifth")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(state.hashCalls).toBe(2);
  expect(state.calls).toHaveLength(2);
  state.pending.forEach((done) => done());
  await Promise.all(jobs);
  state.hold = false;
  await expect(hashPassword("next")).resolves.toBe("$argon2id$real");
});
