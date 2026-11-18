#!/usr/bin/env python3
"""
把"还剩多少中文"分类成**可做 / 保留**两类 —— i18n 收尾的收官口径。

起因：测量脚本给出的总数（如 34 处）**不等于待翻译量**。本会话已识别出四类"看着像漏译、
实际不该翻"的中文；若不分类，后续每一轮都会把它们当漏译反复追查（我已因此空转过多次）。

四类**保留**（非缺陷）：
  · 搜索别名 —— 命令面板 keywords，中英双语是功能（用户中英都能搜到）
  · 数据字段名/键 —— payload["标题"] 之类，翻译即破坏（取值落空）
  · 控制台日志 —— console.error 前缀，面向开发者而非界面
  · 双语标签 —— locale.group = "Language / 语言"（词典白名单）

其余按形态分：模板字符串（第 6 类）与普通文本（可直接做）。

用法：python3 scripts/classify-i18n-remaining.py
"""
import re, glob, os

def strip_comments(s: str) -> str:
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    return re.sub(r'^\s*//.*$', '', s, flags=re.M)

CLASSES = ["别名(保留)", "数据字段名/键(保留)", "控制台日志(保留)",
           "模板字符串(第6类)", "表达式混合(第5类)", "普通文本(可做)"]

def main() -> None:
    counts = {k: 0 for k in CLASSES}
    todo = []
    for p in sorted(glob.glob('src/client/**/*.tsx', recursive=True)):
        src = strip_comments(open(p, encoding="utf-8").read())
        for line in src.split("\n"):
            for m in re.finditer(r'>[^<>{}]*[\u4e00-\u9fa5][^<>{}]*<|"[^"\n]*[\u4e00-\u9fa5][^"\n]*"', line):
                lit = m.group(0).strip('><"').strip()
                if re.search(r'var\(--|className=|style=|from "', lit):
                    continue
                name = os.path.basename(p)
                if name == "CommandPalette.tsx":
                    counts["别名(保留)"] += 1
                elif re.search(r'payload\[|\["[^"]*[\u4e00-\u9fa5]', line):
                    counts["数据字段名/键(保留)"] += 1
                elif re.search(r'console\.(error|warn|log)', line):
                    counts["控制台日志(保留)"] += 1
                elif "`" in line and "${" in line:
                    counts["模板字符串(第6类)"] += 1
                elif re.search(r'\$\{[^}]*\}', line):
                    counts["表达式混合(第5类)"] += 1
                else:
                    counts["普通文本(可做)"] += 1
                    todo.append((name, lit[:40]))
    total = sum(counts.values())
    keep = sum(v for k, v in counts.items() if "保留" in k)
    print(f"  ── 剩余中文 {total} 处 ──")
    for k in CLASSES:
        if counts[k]:
            print(f"   {k}: {counts[k]}")
    print(f"  ★ 保留（非缺陷）: {keep} ｜ 可做: {total - keep}")
    if todo:
        print("  ── 仍可做的普通文本 ──")
        for n, l in todo:
            print(f"   {n}: {l}")

if __name__ == "__main__":
    main()
