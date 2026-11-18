import "./_env.ts";
/** 登录页布局验收；只读取未登录页面，不向业务接口写入。 */
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.goto(`${base}/login`);
  await page.locator("#username").waitFor();
  for (const [width, height] of [[2560, 1440], [1920, 1312], [1440, 900], [1158, 1181], [768, 1024], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.locator(".login-main").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        fits: document.documentElement.scrollWidth <= innerWidth,
        centered: Math.abs(box.left - (innerWidth - box.right)) < 2,
        adaptive: innerWidth <= 900 || box.width > innerWidth * .85,
        readableForm: element.querySelector(".login-panel").getBoundingClientRect().width <= 480,
        verticallyCentered: document.documentElement.scrollHeight > innerHeight + 1 || Math.abs((box.top + box.bottom) / 2 - innerHeight / 2) < 2,
        controls: [...element.querySelectorAll("input, button[type=submit]")].every((control) => control.getBoundingClientRect().height >= 44),
      };
    });
    if (Object.values(layout).some((value) => !value)) throw new Error(`${width}×${height}: ${JSON.stringify(layout)}`);
    console.log(`通过：${width}×${height} 登录布局`);
  }
} finally {
  await browser.close();
}
