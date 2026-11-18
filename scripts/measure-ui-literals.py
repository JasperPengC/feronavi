#!/usr/bin/env python3
"""
测量「UI 字面量」剩余量 —— 前端收尾阶段的**唯一可信口径**。

为什么需要它：收尾过程中我至少三次用不同口径数过剩余量，结论相差几十倍：
  · 含注释粗计 → 522 处（把注释也算进去了）
  · 换一个 grep 管道 → 每文件 1–9 处（把大量 UI 文案漏掉了）
  · 本脚本（剥离注释 + 只数 JSX 文本节点与引号字面量）→ 499 处 / 23 文件

**结论：口径不统一时，任何"还剩多少"的数字都不可信，据此排期必然失真。**
本脚本是这条纪律的工具化：先统一口径，再谈进度。

用法：python3 scripts/measure-ui-literals.py
"""
import re, glob, os


def strip_comments(src: str) -> str:
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)          # 块注释
    src = re.sub(r'^\s*//.*$', '', src, flags=re.M)   # 整行注释
    src = re.sub(r'\s//[^\n"\'`]*$', '', src, flags=re.M)  # 行尾注释（保守）
    return src
rows = []
for path in glob.glob("src/client/routes/*.tsx") + glob.glob("src/client/components/*.tsx"):
    if os.path.basename(path) == "index.ts": continue
    src = strip_comments(open(path, encoding="utf-8").read())
    # 只数「UI 字面量」：JSX 文本节点 与 引号字面量（值里含中文）
    hits = re.findall(r'>[^<>{}]*[\u4e00-\u9fa5][^<>{}]*<', src)
    hits += re.findall(r'"[^"\n]*[\u4e00-\u9fa5][^"\n]*"', src)
    hits = [h for h in hits if not re.search(r'var\(--|className|style=|from "', h)]
    if hits: rows.append((len(hits), os.path.basename(path), hits[:3]))
rows.sort(reverse=True)
print(f"  ── 真实剩余 UI 字面量（已剥离注释）: 共 {sum(r[0] for r in rows)} 处、{len(rows)} 个文件")
for n, f, sample in rows[:8]:
    print(f"   {n:3d}  {f}  例: {str(sample)[:78]}")
