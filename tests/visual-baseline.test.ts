import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript 辅助模块由 Vitest 直接加载
import { baselineAction, baselineFileName } from "../scripts/lib/visual-baseline.mjs";

describe("视觉基线命名", () => {
  it("使用稳定 key，不接受 URL 或 UUID 路径", () => {
    expect(baselineFileName("project-board", "dark-mobile")).toBe("project-board-dark-mobile.png");
    expect(() => baselineFileName("projects/123", "dark-mobile")).toThrow("稳定路由 key");
  });

  it("非更新模式缺少基线时失败而不是写文件", () => {
    expect(baselineAction(false, false)).toBe("missing");
    expect(baselineAction(true, false)).toBe("write");
    expect(baselineAction(false, true)).toBe("compare");
  });
});
