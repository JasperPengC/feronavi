import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** 跟随真实 CSS 入口读取所有权文件，测试不固定历史补丁文件名。 */
export function readClientStyles(file = "src/client/styles/index.css"): string {
  return readFileSync(file, "utf8").replace(/@import\s+["']([^"']+)["'];/g,
    (_match, relative: string) => readClientStyles(resolve(dirname(file), relative)));
}
