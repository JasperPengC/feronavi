import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("启动时优先使用保存的语言，即使浏览器语言不同", async () => {
  vi.resetModules();
  vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
  localStorage.setItem("feronavi_locale", "en-US");
  const { getLocale } = await import("../src/client/i18n/index.ts");
  expect(getLocale()).toBe("en-US");
});
