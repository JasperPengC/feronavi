/**
 * i18n 覆盖率自检（第十二期）
 *
 * 两件事：
 *   1 **框架自检**：中英字典的键必须一一对应（漏翻或多余的键都要报出来）
 *   2 **覆盖率**：统计客户端里已接 i18n 的文件数 vs 仍写死中文的文件数 ——
 *      把"还差多少"变成可度量的数字，而不是含糊地说"部分完成"
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CJK = /[\u4e00-\u9fa5]/;
const i18nSrc = readFileSync("src/client/i18n/index.ts", "utf8");

// 极简字典键提取：分别取 zh / en 两个对象字面量里的键
function keysOf(block) {
  return [...block.matchAll(/"([a-z][a-zA-Z0-9.]*)":/g)].map((m) => m[1]).sort();
}
const zhBlock = i18nSrc.slice(i18nSrc.indexOf("const zh: Dict = {"), i18nSrc.indexOf("const en: Dict = {"));
const enBlock = i18nSrc.slice(i18nSrc.indexOf("const en: Dict = {"), i18nSrc.indexOf("const DICTS:"));
const zhKeys = keysOf(zhBlock), enKeys = keysOf(enBlock);

let fail = 0;
const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
const extraInEn = enKeys.filter((k) => !zhKeys.includes(k));
if (missingInEn.length) { console.log(`  FAIL 英文包缺少 ${missingInEn.length} 个键：${missingInEn.slice(0, 8).join(", ")}`); fail++; }
if (extraInEn.length) { console.log(`  FAIL 英文包多出 ${extraInEn.length} 个键：${extraInEn.slice(0, 8).join(", ")}`); fail++; }
if (!missingInEn.length && !extraInEn.length) console.log(`  OK   中英字典键一一对应（${zhKeys.length} 个键）`);

/**
 * **使用侧自检**：源码里 `t("字面量")` 用到的键必须在字典中存在。
 * 为什么需要：键一一对应只能发现"两本字典不一致"；当某个键**两边都缺**时，
 * 界面会直接渲染 key 本身（实测 InvitePanel 的 common.close 就在截图里露出过 raw key）。
 */
function walkClient(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkClient(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const zhKeySet = new Set(zhKeys);
const usedMissing = new Map();
for (const f of walkClient("src/client")) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*["']([a-z][a-zA-Z0-9.]*)["']/g)) {
    if (!zhKeySet.has(m[1])) {
      const set = usedMissing.get(m[1]) ?? new Set();
      set.add(f.replace("src/client/", ""));
      usedMissing.set(m[1], set);
    }
  }
}
if (usedMissing.size) {
  console.log(`  FAIL 源码使用了 ${usedMissing.size} 个字典中不存在的键（界面会渲染 raw key）：`);
  for (const [k, fs] of [...usedMissing].slice(0, 8)) console.log(`       ${k} ← ${[...fs].join(", ")}`);
  fail += usedMissing.size;
} else {
  console.log("  OK   源码使用的字面量键全部存在");
}

// 覆盖率：逐文件判断"是否已接 i18n"
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const files = walk("src/client/routes");
let localized = 0;
const pending = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const hasCjk = CJK.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
  const wires = /from "\.\.\/i18n\/index\.ts"/.test(src);
  if (wires) localized++;
  else if (hasCjk) pending.push(f.replace("src/client/", ""));
}
/**
 * 自检：英文词典的值里不应混入中文。
 * 为什么需要：漏翻时最省事的做法就是把 zh 的值复制到 en —— 那样界面上仍是中文，
 * 而所有既有检查（键一一对应、覆盖率）都会通过。**这是唯一能拦住它的门。**
 * 例外：语言切换器的标签本就该双语书写（Language / 语言），用白名单显式放行。
 */
const EN_CJK_ALLOW = new Set(["locale.group"]);
const enPairs = [...enBlock.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => [m[1], m[2]]);
const enCjk = enPairs.filter(([k, v]) => /[\u4e00-\u9fa5]/.test(v) && !EN_CJK_ALLOW.has(k));
if (enCjk.length) {
  console.log(`  FAIL 英文词典里有 ${enCjk.length} 个键的值含中文（应翻译；白名单：${[...EN_CJK_ALLOW].join(", ")}）`);
  for (const [k, v] of enCjk.slice(0, 5)) console.log(`       ${k} = ${String(v).slice(0, 40)}`);
  fail += enCjk.length;
} else {
  console.log(`  OK   英文词典无中文混入（白名单 ${EN_CJK_ALLOW.size} 项：双语标签）`);
}

const total = files.length;
const pct = ((localized / total) * 100).toFixed(0);
console.log(`  ${fail ? "FAIL" : "OK  "} 覆盖率：外壳级 ${localized}/${total} 个界面文件已接 i18n（${pct}%）`);
console.log(`       仍写死中文：${pending.length} 个文件（前 6 个：${pending.slice(0, 6).join(", ")}）`);
console.log(`\n结果: ${fail === 0 ? "字典一致" : "字典不一致"}（覆盖率数字供文档记录，不作为失败条件）`);
process.exit(fail === 0 ? 0 : 1);
