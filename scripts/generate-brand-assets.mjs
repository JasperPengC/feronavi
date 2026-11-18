/** 从 SVG 母版生成 PNG 和多尺寸 ICO；无需额外图像处理依赖。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const brand = new URL("public/brand/", root);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function raster(svg, size, output, height = size) {
    await page.setViewportSize({ width: size, height });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
    const bytes = await page.screenshot({ omitBackground: true });
    if (output) await writeFile(output, bytes);
    return bytes;
  }
  const icon = await readFile(new URL("feronavi-icon.svg", brand), "utf8");
  const favicon = await readFile(new URL("public/favicon.svg", root), "utf8");
  for (const size of [192, 512, 1024]) {
    await raster(icon, size, new URL(`icon-${size}.png`, brand));
  }
  await raster(await readFile(new URL("feronavi-icon-dark.svg", brand), "utf8"), 1024, new URL("icon-dark-1024.png", brand));
  for (const variant of ["logo", "logo-light", "logo-mono"]) {
    const svg = await readFile(new URL(`feronavi-${variant}.svg`, brand), "utf8");
    const width = Number(svg.match(/viewBox="0 0 (\d+) 64"/)[1]);
    await raster(svg, 1280, new URL(`feronavi-${variant}.png`, brand), Math.round(1280 * 64 / width));
  }
  await raster(await readFile(new URL("feronavi-mark.svg", brand), "utf8"), 1024, new URL("mark-1024.png", brand));
  await raster(icon.replace('rx="16"', 'rx="0"'), 180, new URL("public/apple-touch-icon.png", root));
  const glyph = icon.slice(icon.indexOf("  <path"), icon.indexOf("</svg>"));
  const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#4968e8"/><g transform="translate(8 8) scale(.75)">${glyph}</g></svg>`;
  await raster(maskable, 512, new URL("icon-maskable-512.png", brand));

  // ICO 目录中的每个条目都是独立的 PNG 帧，256px 按格式约定记为 0。
  const sizes = [16, 32, 48, 64, 128, 256];
  const frames = [];
  for (const size of sizes) {
    frames.push(await raster(favicon, size, size === 16 || size === 32 ? new URL(`favicon-${size}.png`, brand) : undefined));
  }
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  frames.forEach((frame, i) => {
    const entry = 6 + i * 16;
    header[entry] = sizes[i] % 256;
    header[entry + 1] = sizes[i] % 256;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(new URL("public/favicon.ico", root), Buffer.concat([header, ...frames]));
  console.log(`品牌 PNG 与 ICO 已生成：${fileURLToPath(brand)}`);
} finally {
  await browser.close();
}
