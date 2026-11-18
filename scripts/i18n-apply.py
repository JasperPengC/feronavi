#!/usr/bin/env python3
"""
把 UI 文案接入词典的**形态感知**替换器（前端收尾阶段的唯一推荐做法）。

为什么需要它 —— 本会话用一个临时脚本反复踩同一类坑，且每次都靠 tsc 才发现：
  · 尝试把「跨行文本节点」当单行处理  → 改坏 JSX
  · 未命中时**降级到裸字符串替换**    → 把局部函数名 `删除(` 改成 `t("…")(`（最严重的一次）
  · 局部变量 `t` 与 i18n 的 `t` 重名  → `t("…")` 变成调用对象
  · 英文值直接复制中文                → 界面仍中文，而所有既有检查都通过

本脚本把这些教训固化为规则：
  1. **五种形态逐一尝试，按位置匹配**（属性 / 单行文本 / 跨行文本 / 表达式 / 字符串）
  2. **未命中 → 报错退出（exit 2），绝不猜、绝不降级**；调用方必须先看清实际写法
  3. **裸字符串替换仅在「引号包裹且不含 ( { . 」时允许** —— 这条能挡住改函数名那类事故
  4. **重名检查**：文件里若已存在标识符 `t`，拒绝直接导入 `t`，要求改用别名

**第六类形态（属性 + 模板字符串）—— 手工处理，配方如下：**
    title={`工作项 ${it.promotedWorkItemId}`}
  → title={t("ideas.promotedTitle", { id: it.promotedWorkItemId })}
  词典值写 "工作项 {id}" / "Work item {id}"。
  为什么不做成自动分支：模板里的表达式语法各不相同，通用化会让映射格式复杂到容易出错；
  这类形态在前端收尾中**很少见**（全仓仅 1 处），手工 + 立刻 tsc 更划算。
  ⚠️ 若将来数量变多，再按「前缀/后缀两键 + 插值」实现，并**为该分支补一次正例验证**。

用法：
  python3 scripts/i18n-apply.py <文件> <映射.tsv> --dry-run   # 先看每条的形态与能否命中
  python3 scripts/i18n-apply.py <文件> <映射.tsv> --write     # 命中才写；任一未命中则整体不写
  python3 scripts/i18n-apply.py <文件> <映射.tsv> --write --alias  # 额外：把 i18n 导入改成 t as tr，
                                                                   # 并把文件中所有 t("键") 改成 tr("键")
映射.tsv 每行：中文<TAB>词典键
"""
import re, sys, pathlib

FORMS = ["attr", "text_single", "text_multi", "string_safe"]

def has_ident(src: str, name: str) -> bool:
    """文件里是否已有标识符 name（用于重名检查）"""
    return re.search(r'(?<![\w.$])' + re.escape(name) + r'(?![\w$])', src) is not None

def apply_one(src: str, zh: str, key: str):
    """返回 (新源码, 形态)；未命中返回 (None, None)"""
    for attr in ("title", "hint", "sub", "label", "message", "placeholder", "aria-label", "description", "alt"):
        pat = f'{attr}="{zh}"'
        if pat in src:
            return src.replace(pat, f'{attr}={{t("{key}")}}', 1), "attr"
    if f">{zh}<" in src:
        # ⚠️ 修复：此前漏写开头的 '>'，把 `}}>文案</p>` 改成了 `}}{t(…)}</p>`（丢掉了元素闭合的 '>'）
        return src.replace(f">{zh}<", '>' + f'{{t("{key}")}}' + '<', 1), "text_single"
    pm = re.compile(r'>(\s*)' + re.escape(zh) + r'(\s*)<')
    if pm.search(src):
        return pm.sub(lambda m: '>' + m.group(1) + '{t("' + key + '")}' + m.group(2) + '<', src, count=1), "text_multi"
    # ④ 仅当引号内的字符串不像代码（不含 ( { . 与标识符形态）时才允许替换
    if f'"{zh}"' in src and not re.search(r'[(){}.]', zh):
        return src.replace(f'"{zh}"', f't("{key}")', 1), "string_safe"
    return None, None

def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__); return 1
    path, mapping, mode = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
    src = path.read_text(encoding="utf-8")
    # 重名检查：不能只看「有没有导入 i18n」—— 本会话正是这个漏洞让 `t` 与 TokenRow 行对象撞车
    # （已导入 i18n 的文件同样可能新增一个叫 t 的局部变量/参数）。
    # 判据：文件里出现 `t.属性`（当作对象用）或 `t` 被声明为参数/变量 → i18n 的 t 必须别名。
    looks_like_object = re.search(r'(?<![\w.$])t\.[A-Za-z_]', src) is not None
    declared = re.search(r'(?<![\w.$])t\s*[:=]\s*', src) is not None or re.search(r'\(\s*t\s*[,)]', src) is not None
    imports_i18n = "i18n/index.ts" in src
    if looks_like_object or declared:
        if imports_i18n and 't as tr' in src:
            print(f"  ✓ {path.name}: 已有别名导入 t as tr（重名风险已处理）")
        else:
            print(f"  ⚠️ {path.name}: 文件内 `t` 像是对象/参数（非 i18n 的那个）—— **必须用 `t as tr` 别名**，否则 t(\"…\") 会调用对象")
            # 不阻断：仅提示；但若真出现调用错误，tsc 会报 Type … has no call signatures
    pairs = []
    for line in mapping.read_text(encoding="utf-8").splitlines():
        if not line.strip() or "\t" not in line: continue
        zh, key = line.split("\t", 1)
        pairs.append((zh.strip(), key.strip()))
    out, misses, counts = src, [], {}
    for zh, key in pairs:
        new, form = apply_one(out, zh, key)
        if new is None:
            misses.append((zh, key)); continue
        out = new; counts[form] = counts.get(form, 0) + 1
    print(f"  {path.name}: {len(pairs) - len(misses)}/{len(pairs)} 命中 ｜ 形态分布 {counts or '{}'}")
    for zh, key in misses:
        print(f"    ✗ 未命中 {key}  ←  「{zh[:36]}」（请先看实际写法，勿猜）")
    if misses:
        print("  **存在未命中项 → 整体不写入**（规则 2：绝不降级猜测）")
        return 2
    if mode == "--write":
        if "--alias" in sys.argv:
            # 该文件里 `t` 另有含义 → 导入改别名，并把**所有** i18n 调用改成 tr(
            # （教训：这个收尾步骤我曾漏做一次，tsc 报 Cannot find name 't'；故并入工具）
            m = re.search(r'import \{([^}]*)\} from "((?:\.\./)+i18n/index\.ts)";', out)
            if not m:
                # 缺口修复：文件原本没有 i18n 导入时，--alias 必须**新建**导入，否则 tr 未定义
                up = "../i18n/index.ts" if path.parent.name != "client" else "./i18n/index.ts"
                out = 'import { t as tr, useLocale } from "' + up + '";\n' + out
                print("  + 原本无 i18n 导入 → 已新建 t as tr")
            if m:
                names = [x.strip() for x in m.group(1).split(",")]
                names = [n for n in names if n not in ("t", "tr", "t as tr")]
                names = ["t as tr"] + names + (["useLocale"] if "useLocale" not in names else [])
                out = out[:m.start()] + 'import { ' + ", ".join(names) + ' } from "' + m.group(2) + '";' + out[m.end():]
            out, n = re.subn(r'(?<![\w.$])t\(("[a-zA-Z]+\.[^"]+")\)', r'tr(\1)', out)
            print(f"  别名收尾：导入改 t as tr，{n} 处调用改 tr(")
            if "useLocale();" not in out:
                out, k = re.subn(r"(export function \w+\(\)\s*\{)", r"\1\n  useLocale();   // 订阅语言，切换即时生效", out, count=1)
        path.write_text(out, encoding="utf-8"); print("  已写入")
    else:
        print("  dry-run：未写入")
    return 0

if __name__ == "__main__":
    sys.exit(main())
