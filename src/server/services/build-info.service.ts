/**
 * 构建标识（在线用户刷新提示的真相源）
 *
 * 为什么不用 package.json 版本号：升级后版本未必变；真正可靠的是**服务端当前托管的静态资源**——
 * dist/index.html 的内容哈希。升级替换 dist 并重启后哈希必然变化，
 * 前端轮询 /system/status 比对即可发现"服务端已经是新构建"并提示用户刷新。
 * 进程内按 mtime 缓存，避免每次轮询都读文件。
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distIndex = join(dirname(fileURLToPath(import.meta.url)), "../../../dist/index.html");

interface Cache { mtimeMs: number; id: string }
let cache: Cache | null = null;

export function getBuildId(): string {
  try {
    const st = statSync(distIndex);
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.id;
    const content = readFileSync(distIndex);
    const id = createHash("sha256").update(content).digest("hex").slice(0, 12);
    cache = { mtimeMs: st.mtimeMs, id };
    return id;
  } catch {
    return "dev";
  }
}
