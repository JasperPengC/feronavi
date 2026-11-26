import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// 布局依赖真实浏览器，使用浏览器套件管理的 Chromium、超时和失败 trace。
// 恢复业务逻辑仍由 setup-restore-flow.test.tsx 验证。
for (const width of [1440, 390]) {
  test(`恢复容器不继承创建向导侧栏列，${width}px 保留可用内容宽度`, async ({ page }, testInfo) => {
    await test.step("加载恢复容器与实际页面样式", async () => {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(
        '<div class="setup-page"><main class="setup-main"><div class="setup-frame setup-restore-frame"><div class="setup-restore"><div class="setup-restore-body">恢复内容</div></div></div></main></div>',
      );
      await page.addStyleTag({
        content: await readFile("src/client/styles/pages.css", "utf8"),
      });
    });

    await test.step("核验内容宽度、容器上限与视口边界", async () => {
      const frameLocator = page.locator(".setup-restore-frame");
      const contentLocator = page.locator(".setup-restore-body");
      await expect(frameLocator).toBeVisible();
      await expect(contentLocator).toBeVisible();
      const frame = await frameLocator.boundingBox();
      const content = await contentLocator.boundingBox();
      await testInfo.attach("恢复布局尺寸", {
        body: JSON.stringify({ viewportWidth: width, frame, content }),
        contentType: "application/json",
      });
      expect(content!.width).toBeGreaterThan(width === 1440 ? 600 : 280);
      expect(frame!.width).toBeLessThanOrEqual(760);
      expect(content!.x + content!.width).toBeLessThanOrEqual(width);
    });
  });
}
