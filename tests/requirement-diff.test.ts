import { expect, it } from "vitest";
import { compareText } from "../src/shared/requirement-diff.ts";

it("行比较保留新增、删除、未改行和末尾换行，可还原两端原文", () => {
  for (const [before, after] of [["第一行\n旧内容\n末尾", "第一行\n新内容\n末尾"], ["", "新增\n"], ["删除", ""], ["同一行\n", "同一行"], ["a\nb\na\n", "a\na\nb\n"]]) {
    const result = compareText(before!, after!);
    expect(result.chunks.filter(c => c.kind !== "add").map(c => c.text).join("")).toBe(before);
    expect(result.chunks.filter(c => c.kind !== "remove").map(c => c.text).join("")).toBe(after);
    expect(result.coarse).toBe(false);
  }
  expect(compareText("a\nb\n", "a\nc\n").chunks).toEqual([
    { kind: "equal", text: "a\n" }, { kind: "remove", text: "b\n" }, { kind: "add", text: "c\n" },
  ]);
});

it("大量全改行使用有界比较，仍完整保留两边而不阻塞页面", () => {
  const before = Array.from({ length: 3000 }, (_, i) => `旧${i}\n`).join("");
  const after = Array.from({ length: 3000 }, (_, i) => `新${i}\n`).join("");
  const result = compareText(before, after);
  expect(result.coarse).toBe(true);
  expect(result.chunks).toEqual([{ kind: "remove", text: before }, { kind: "add", text: after }]);
});

it("相同文本不产生伪变更", () => {
  expect(compareText("一致\n", "一致\n").chunks).toEqual([{ kind: "equal", text: "一致\n" }]);
  expect(compareText("", "").chunks).toEqual([]);
});
