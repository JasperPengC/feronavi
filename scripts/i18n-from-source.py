#!/usr/bin/env python3
"""
从**源码**提取字面并替换（机器生成映射，杜绝手抄）—— i18n 收尾的推荐做法。

为什么需要它：本会话至少 4 次因「手抄/猜测」失手 —— 截断长句、猜 JSX 形态、猜属性位置、猜路由路径。
当文案**含特殊字符（反引号/HTML 实体）、跨行、或在表达式里**时，人眼复述几乎必错；
而"从源码读出精确字面、再用同一字符串替换"是机械且安全的。

用法：
  python3 scripts/i18n-from-source.py <文件> <锚点子串> <词典键> [<锚点2> <键2> ...]
行为：
  · 锚点必须**唯一**（出现多次即报错退出，避免改错位置）；
  · 自动识别两种位置：JSX 文本节点（`>…<`）与字符串字面量（`"…"`）；
  · 提取出的字面**原样**用于替换，不经过人的手；
  · 只报告、不写文件；确认无误后由调用方带 --write 再跑一次。
"""
import re
import sys


def find_unique(src: str, anchor: str) -> int:
    n = src.count(anchor)
    if n == 0:
        raise SystemExit(f"  ✗ 锚点未找到：{anchor[:30]}")
    if n > 1:
        raise SystemExit(f"  ✗ 锚点出现 {n} 次（不唯一，拒绝改）：{anchor[:30]}")
    return src.index(anchor)


def extract(src: str, idx: int):
    """返回 (literal, kind, start, end)；先试字符串字面量，再试 JSX 文本节点"""
    ls = src.rfind("\n", 0, idx) + 1
    le = src.find("\n", idx)
    line = src[ls:le if le > 0 else len(src)]
    # ① 字符串字面量：锚点两侧最近的引号
    q1 = line.rfind('"', 0, idx - ls)
    q2 = line.find('"', idx - ls)
    if q1 >= 0 and q2 > q1:
        lit = line[q1 + 1:q2]
        # 守卫：提取结果若含 JSX/表达式标记，说明这对引号**夹着的是代码而非一句文案** ——
        # 宁可拒绝也不能错改（本会话最严重的事故就是"改到了不该改的位置"）。
        if re.search(r"[\u4e00-\u9fa5]", lit) and not re.search(r"[{}()<>]", lit):
            return lit, "string", ls + q1 + 1, ls + q2
        if re.search(r"[{}()<>]", lit):
            raise SystemExit(f"  ✗ 引号内夹着代码（拒绝改）：{lit[:60]}")
    # ② JSX 文本节点：锚点所在行内，最近的 '>' 与 '<'
    g = line.find(">", 0, idx - ls)
    l = line.find("<", idx - ls)
    if g >= 0 and l > g:
        lit = line[g + 1:l].strip()
        if re.search(r"[\u4e00-\u9fa5]", lit):
            return lit, "text", ls + g + 1 + line[g + 1:l].index(lit[0]), ls + g + 1 + line[g + 1:l].index(lit[0]) + len(lit)
    return None, None, None, None


def main() -> int:
    args = sys.argv[1:]
    write = "--write" in args
    args = [a for a in args if a != "--write"]
    if len(args) < 3:
        print(__doc__); return 1
    path, rest = args[0], args[1:]
    src = open(path, encoding="utf-8").read()
    out, n = src, 0
    for i in range(0, len(rest), 2):
        anchor, key = rest[i], rest[i + 1]
        idx = find_unique(out, anchor)
        lit, kind, s, e = extract(out, idx)
        if lit is None:
            raise SystemExit(f"  ✗ 无法定界（锚点不在文本节点/字符串里）：{anchor[:30]}")
        # ⚠️ 曾经这里留了一行有缺陷的旧赋值：它先做了一次"不带 out[e:]"的替换，
        # 随后第二次替换又用了已失效的偏移量 → 产物出现重复尾巴（{t("k")}ique")}）。
        # 现已合并为唯一一次替换：
        repl = f'{{t("{key}")}}' if kind == "text" else f't("{key}")'
        out = out[:s] + repl + out[e:]
        print(f'  ✓ {key} ← [{kind}] 「{lit[:44]}…」')
        n += 1
    if write:
        open(path, "w", encoding="utf-8").write(out); print(f"  已写入 {n} 处")
    else:
        print(f"  dry-run：{n} 处（未写入）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
