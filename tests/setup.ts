import { installBusinessEffects } from "../src/server/services/business-effects.ts";
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
if (typeof window !== "undefined" && /jsdom/u.test(window.navigator.userAgent)) {
  // jsdom没有视口滚动实现；真实滚动与位置由浏览器验收，不屏蔽console错误。
  window.scrollTo = () => {};
}

// Unit suites substitute domain implementations with hoisted mocks. Real entry points await bootstrap.
installBusinessEffects({
  runAutomation: async (...args) => (await import("../src/server/services/automation.service.ts")).runAutomation(...args),
  ensureSla: async (...args) => (await import("../src/server/services/sla.service.ts")).ensureSla(...args),
  markFirstResponse: async (...args) => (await import("../src/server/services/sla.service.ts")).markFirstResponse(...args),
  markTransition: async (...args) => (await import("../src/server/services/sla.service.ts")).markTransition(...args),
  requestApproval: async (...args) => (await import("../src/server/services/approval.service.ts")).requestApproval(...args),
  synchronizePublishedPage: async (...args) => (await import("../src/server/services/collab-document.service.ts")).synchronizePublishedPage(...args),
  finishPagePublication: async (...args) => (await import("../src/server/services/collab-document.service.ts")).finishPagePublication(...args),
  // 单测不外发；真实事务与HTTP验收通过bootstrap安装实际端口。
  deliverWebhook: async () => {},
});
