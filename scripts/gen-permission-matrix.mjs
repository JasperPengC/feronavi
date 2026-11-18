/**
 * 从基线第 5.2 节的「内置角色矩阵」**程序化生成**权限判定的期望值。
 *
 * 为什么必须程序化：47 动作 × 4 角色 = 188 个断言，手抄一定会抄错，
 * 而且矩阵改了之后测试不会跟着变 —— 那就成了一份假的回归测试。
 *
 * 输出：tests/permission-matrix.generated.json
 *   { permissions: [key...], roles: { ADMIN: [允许的 key...], ... } }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const internalSource = fileURLToPath(new URL("../docs/reference/permissions.md", import.meta.url));
const SRC = args[0] === "--out" ? internalSource : (args[0] ?? internalSource);
const OUT = args[0] === "--out" ? args[1] : (args[1] ?? fileURLToPath(new URL("../tests/permission-matrix.generated.json", import.meta.url)));
if (!OUT) throw new Error("--out 需要指定输出文件");

const lines = readFileSync(SRC, "utf8").split("\n");

// ① 47 个权限键（从「内置角色矩阵」里出现的所有 `x:y` 键收集）
const start = lines.findIndex((l) => l.startsWith("| 动作组 |"));
if (start < 0) throw new Error("找不到「内置角色矩阵」表头");

/**
 * 展开简写：矩阵里 `project:update` / `archive` / `manage_member` 这种写法，
 * 裸 token 继承同一个单元格里前一个完整键的前缀。
 */
function expand(cell) {
  const out = [];
  let prefix = null;
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    const tok = m[1];
    if (tok.includes(":")) {
      prefix = tok.split(":")[0];
      out.push(tok);
    } else if (prefix) {
      out.push(`${prefix}:${tok}`);
    }
  }
  return out;
}

const COL = { ADMIN: 1, PM: 2, MEMBER: 3, GUEST: 4 };
const roles = { ADMIN: [], PM: [], MEMBER: [], GUEST: [] };
const all = new Set();

for (const line of lines.slice(start)) {
  if (!line.startsWith("|")) break;
  const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  if (cells.length !== 5) continue;
  if (/^[-: ]+$/.test(cells[1])) continue;      // 分隔行
  if (cells[0] === "动作组") continue;           // 表头
  const keys = expand(cells[0]);
  keys.forEach((k) => all.add(k));
  for (const [role, i] of Object.entries(COL)) {
    if (cells[i] === "✅") roles[role].push(...keys);
  }
}

const permissions = [...all].sort();
for (const r of Object.keys(roles)) roles[r] = [...new Set(roles[r])].sort();

// 自检：与规格声明对得上
const expect = { ADMIN: 47, PM: 33, MEMBER: 15, GUEST: 5 };
for (const [r, n] of Object.entries(expect)) {
  if (roles[r].length !== n) {
    throw new Error(`角色 ${r} 权限数 ${roles[r].length} ≠ 期望 ${n}`);
  }
}
if (permissions.length !== 47) {
  throw new Error(`权限总数 ${permissions.length} ≠ 47`);
}

writeFileSync(OUT, JSON.stringify({ permissions, roles }, null, 2) + "\n");
const total = Object.values(roles).reduce((a, b) => a + b.length, 0);
console.log(`权限 ${permissions.length} 个 · 断言 ${permissions.length}×4 = ${permissions.length * 4} 个 · 允许 ${total} / 拒绝 ${permissions.length * 4 - total}`);
console.log(`→ ${OUT}`);
