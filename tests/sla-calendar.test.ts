import { describe, it, expect } from "vitest";
import { addSlaMinutes } from "../src/server/lib/sla-calendar.ts";

const CAL = { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const local = (s: string) => new Date(s);

describe("SLA 工作时间日历", () => {
  it("工作时间内顺延分钟", () => {
    expect(addSlaMinutes(local("2026-11-02T10:00:00"), 60, CAL).getHours()).toBe(11);
  });
  it("跨午休/下班后进入下一个工作日", () => {
    const r = addSlaMinutes(local("2026-11-06T17:30:00"), 60, CAL); // 周五 17:30 + 60
    expect(r.getDay()).toBe(1); // 周一
    expect(r.getHours()).toBe(9);
    expect(r.getMinutes()).toBe(30);
  });
  it("法定节假日跳过，调休周末补班", () => {
    const holiday = { ...CAL, holidays: ["2026-11-06"] }; // 周五放假
    const skipped = addSlaMinutes(local("2026-11-06T17:30:00"), 60, holiday);
    expect(skipped.getDay()).toBe(1); // 周一
    const extra = { ...CAL, extraWorkdays: ["2026-11-07"] }; // 周六补班
    const worked = addSlaMinutes(local("2026-11-07T09:00:00"), 60, extra);
    expect(worked.getDay()).toBe(6);
    expect(worked.getHours()).toBe(10);
  });
  it("关闭日历时保持 24×7", () => {
    const r = addSlaMinutes(local("2026-11-06T17:30:00"), 60, { enabled: false });
    expect(r.getHours()).toBe(18);
    expect(r.getMinutes()).toBe(30);
  });
});
