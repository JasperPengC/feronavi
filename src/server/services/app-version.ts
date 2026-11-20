import { readFileSync } from "node:fs";

// 源码位于src/server/services；构建位于<outDir>/server/services，元数据随产物发布。
const metadataPath = import.meta.url.endsWith(".ts")
  ? "../../../package.json"
  : "../../package.json";
export const currentAppVersion: string = JSON.parse(
  readFileSync(new URL(metadataPath, import.meta.url), "utf8"),
).version;
