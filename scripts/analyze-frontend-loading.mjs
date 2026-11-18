/** 用真实生产模块图统计路由的静态依赖；构建只写显式指定的隔离目录。 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const output = option("--out-dir");
const reportPath = option("--report");
assert(output && reportPath, "需要 --out-dir 和 --report，禁止覆盖默认 dist");
const outDir = resolve(output);
const localOutput = relative(resolve(".cache"), outDir);
assert(localOutput && !localOutput.startsWith("..") && !localOutput.startsWith("/"), "构建目录必须位于 .cache 内");
let graph = [];
await build({ logLevel: "warn", build: { outDir, manifest: true }, plugins: [{
  name: "frontend-loading-evidence",
  generateBundle(_, bundle) {
    graph = Object.values(bundle).filter(item => item.type === "chunk").map(chunk => ({
      file: chunk.fileName, facade: chunk.facadeModuleId && relative(process.cwd(), chunk.facadeModuleId),
      entry: chunk.isEntry, imports: chunk.imports, dynamicImports: chunk.dynamicImports,
      modules: Object.entries(chunk.modules).map(([id, item]) => ({ id: relative(process.cwd(), id), renderedLength: item.renderedLength }))
        .sort((a, b) => b.renderedLength - a.renderedLength),
    }));
  },
}] });
const manifest = JSON.parse(await readFile(resolve(outDir, ".vite/manifest.json"), "utf8"));
const byFile = new Map(graph.map(chunk => [chunk.file, chunk]));
const sizes = new Map();
async function size(file) {
  if (!sizes.has(file)) {
    const bytes = await readFile(resolve(outDir, file));
    sizes.set(file, { bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
  }
  return sizes.get(file);
}
function closure(keys) {
  const files = new Set(["index.html"]);
  const visit = key => {
    const item = manifest[key];
    assert(item, `缺失构建入口 ${key}`);
    if (files.has(item.file)) return;
    files.add(item.file);
    for (const css of item.css ?? []) files.add(css);
    for (const dependency of item.imports ?? []) visit(dependency);
  };
  keys.forEach(visit);
  return [...files].sort();
}
const scenarios = {};
for (const [name, routes] of Object.entries({
  login: ["LoginPage"], projects: ["AppShell", "ProjectListPage"],
  workbench: ["AppShell", "WorkbenchPage"], issues: ["AppShell", "IssuesPage"],
  notifications: ["AppShell", "NotificationsPage"],
})) {
  const files = closure(["index.html", ...routes.map(name => `src/client/routes/${name}.tsx`)]);
  const details = await Promise.all(files.map(async file => ({ file, ...await size(file) })));
  const modules = files.flatMap(file => byFile.get(file)?.modules.map(item => item.id) ?? []);
  scenarios[name] = {
    requests: details.length, bytes: details.reduce((total, item) => total + item.bytes, 0),
    gzipBytes: details.reduce((total, item) => total + item.gzipBytes, 0),
    drawerEager: modules.includes("src/client/components/work-item/WorkItemDrawer.tsx"),
    markdownEager: modules.some(id => /\/(?:react-markdown|micromark)\//u.test(id)), files: details,
  };
}
const entry = graph.find(chunk => chunk.entry);
const report = { measuredAt: new Date().toISOString(), outDir, node: process.version,
  note: "静态依赖闭包包含 HTML/JS/CSS，gzip 为文件压缩估算，实际传输与缓存由浏览器专项测量。模块 renderedLength 是 Rollup 压缩前长度，仅用于归因。",
  entry: { file: entry.file, ...await size(entry.file), largestModules: entry.modules.slice(0, 20) }, scenarios, graph };
await mkdir(dirname(resolve(reportPath)), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ entry: report.entry.file, entryBytes: report.entry.bytes, entryGzipBytes: report.entry.gzipBytes,
  scenarios: Object.fromEntries(Object.entries(scenarios).map(([name, { files: _files, ...summary }]) => [name, summary])), reportPath }, null, 2));
if (args.includes("--assert-deferred")) {
  for (const name of ["projects", "workbench", "notifications"]) {
    assert.equal(scenarios[name].drawerEager, false, `${name} 首屏不应加载尚未打开的工作项详情`);
    assert.equal(scenarios[name].markdownEager, false, `${name} 首屏不应加载 Markdown 解析器`);
  }
}
