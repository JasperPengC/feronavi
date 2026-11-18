/**
 * 测试全局设置（Round 25 第 20 项）：把 Testing Library 的异步等待上限提到 3s。
 *
 * 背景：全量套件在并行负载下偶发 find* 超时（默认 1000ms）→ 同一提交跑两次一次红一次绿，
 * 这不是产品缺陷而是**判据过紧**；放宽等待只影响"等多久"，不影响"最终断言什么"。
 */
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 8000 });

// jsdom 不计算布局；尺寸与滚动定位由真实浏览器验收。
globalThis.ResizeObserver ??= class implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
