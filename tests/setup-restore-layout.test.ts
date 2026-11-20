// @vitest-environment node
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("恢复容器不继承创建向导侧栏列，桌面与390px保留可用内容宽度", async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div class="setup-page"><main class="setup-main"><div class="setup-frame setup-restore-frame"><div class="setup-restore"><div class="setup-restore-body">恢复内容</div></div></div></main></div>',
    );
    await page.addStyleTag({
      content: await readFile("src/client/styles/pages.css", "utf8"),
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const frame = await page.locator(".setup-restore-frame").boundingBox();
      const content = await page.locator(".setup-restore-body").boundingBox();
      expect(content!.width).toBeGreaterThan(width === 1440 ? 600 : 280);
      expect(frame!.width).toBeLessThanOrEqual(760);
      expect(content!.x + content!.width).toBeLessThanOrEqual(width);
    }
  } finally {
    await browser.close();
  }
});
