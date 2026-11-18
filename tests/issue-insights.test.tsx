import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { IssueInsights } from "../src/client/components/IssueInsights.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const quietDays = Array.from({ length: 14 }, (_, index) => ({ date: `11-${String(index + 1).padStart(2, "0")}`, created: 0, resolved: 0 }));
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); setLocale("zh-CN"); });

describe("问题概览", () => {
  it("近期无变化时收起空坐标轴，但仍呈现全部缺陷的分布", () => {
    render(<IssueInsights trend={quietDays} severity={{ S2: 1 }} isGlobal />);
    expect(screen.getByText("近 14 天没有新增或关闭缺陷")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "每日缺陷数量" })).toBeNull();
    expect(screen.queryByText("11-01")).toBeNull();
    expect(screen.getByText("全部缺陷，含已关闭")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "严重度分布" })).getByText("1")).toBeTruthy();
  });

  it("日期刻度精简后仍能逐日访问完整数据，保留首末日期", () => {
    render(<IssueInsights trend={quietDays.map((day, i) => ({ ...day, created: i === 13 ? 5 : 0, resolved: i === 2 ? 3 : 0 }))} severity={{ S1: 2, S2: 3 }} isGlobal={false} />);
    const chart = screen.getByRole("group", { name: "每日缺陷数量" });
    expect(within(chart).getByLabelText("11-14，新增 5，关闭 0")).toBeTruthy();
    expect(within(chart).getByLabelText("11-03，新增 0，关闭 3")).toBeTruthy();
    expect(chart.querySelectorAll("[tabindex='0']").length).toBe(14);
    expect(screen.getByText("11-01")).toBeTruthy();
    expect(screen.getByText("11-14")).toBeTruthy();
    expect(screen.queryByText("11-02")).toBeNull();
  });

  it("空数据和未设置严重度有明确标签；英文日期说明不混入中文", () => {
    setLocale("en-US");
    render(<IssueInsights trend={[{ date: "11-01", created: 1, resolved: 0 }]} severity={{ none: 2, Legacy: 1 }} isGlobal />);
    expect(screen.getByLabelText("11-01, created 1, resolved 0")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("Legacy")).toBeTruthy();
    expect(screen.getByText("All defects, including closed")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
    cleanup();
    render(<IssueInsights trend={[]} severity={{}} isGlobal />);
    expect(screen.getByText("No defects created or resolved in the past 14 days")).toBeTruthy();
    expect(screen.queryByText("NaN%")).toBeNull();
  });
});
