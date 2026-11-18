/** tsc 不会复制 readFileSync 加载的 JSON；运行镜像必须同时包含内置种子。 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--outDir")) {
  throw new Error("用法：node scripts/build-server.mjs [--outDir <directory>]");
}
const outDir = resolve(root, args[1] ?? "dist-server");
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.server.json", "--outDir", outDir], {
  cwd: root, stdio: "inherit",
});
const seedTarget = join(outDir, "db/seed-data.json");
await mkdir(dirname(seedTarget), { recursive: true });
await copyFile(join(root, "src/db/seed-data.json"), seedTarget);
