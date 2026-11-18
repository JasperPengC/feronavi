import { describe, expect, it } from "vitest";
import { tooltipPosition } from "../src/client/lib/tooltip-position.ts";

describe("悬浮提示定位", () => {
  const viewport = { width: 390, height: 844 };
  const size = { width: 240, height: 64 };
  it("跟随指针且与指针留出距离", () => {
    expect(tooltipPosition({ left: 40, right: 40, top: 300, bottom: 300 }, size, viewport, true))
      .toEqual({ left: 52, top: 312 });
  });
  it("右下角自动向左上翻转，不超出视口", () => {
    expect(tooltipPosition({ left: 380, right: 380, top: 830, bottom: 830 }, size, viewport, true))
      .toEqual({ left: 128, top: 754 });
  });
  it("焦点提示居中于触发元素，顶部空间不足则放在下方", () => {
    expect(tooltipPosition({ left: 8, right: 28, top: 8, bottom: 28 }, size, viewport, false))
      .toEqual({ left: 8, top: 36 });
  });
  it("使用实际气泡尺寸避让，不依赖宽度百分比", () => {
    expect(tooltipPosition({ left: 350, right: 370, top: 300, bottom: 320 }, { width: 160, height: 100 }, viewport, false))
      .toEqual({ left: 222, top: 192 });
  });
});
