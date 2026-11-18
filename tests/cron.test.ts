import { describe, it, expect } from "vitest";
import { cronDue } from "../src/server/lib/cron.ts";

describe("cron 定时", () => {
  it("每分钟规则在窗口内命中", () => {
    expect(cronDue("* * * * *", "Asia/Shanghai", new Date("2026-11-05T09:00:30+08:00"))).toBe(true);
  });
  it("每天 9 点命中，9:02 不命中", () => {
    expect(cronDue("0 9 * * *", "Asia/Shanghai", new Date("2026-11-05T09:00:20+08:00"))).toBe(true);
    expect(cronDue("0 9 * * *", "Asia/Shanghai", new Date("2026-11-05T09:02:20+08:00"))).toBe(false);
  });
  it("非法表达式返回 false", () => {
    expect(cronDue("not a cron", "Asia/Shanghai")).toBe(false);
  });
});
