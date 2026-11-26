export interface TextChange { kind: "equal" | "add" | "remove"; text: string }

/** 行级LCS；限制矩阵大小，大段重写退化为完整替换，保持内容可还原。 */
export function compareText(before: string, after: string): { chunks: TextChange[]; coarse: boolean } {
  const chunks: TextChange[] = [];
  const emit = (kind: TextChange["kind"], text: string) => {
    if (!text) return;
    const last = chunks.at(-1);
    if (last?.kind === kind) last.text += text;
    else chunks.push({ kind, text });
  };
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const a = lines(before), b = lines(after);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  emit("equal", a.slice(0, start).join(""));
  const n = endA - start, m = endB - start;
  const coarse = (n + 1) * (m + 1) > 250_000;
  if (coarse || !n || !m) {
    emit("remove", a.slice(start, endA).join(""));
    emit("add", b.slice(start, endB).join(""));
  } else {
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[start + i] === b[start + j]
        ? lcs[(i + 1) * width + j + 1]! + 1
        : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) { emit("equal", a[start + i++]!); j++; }
      else if (i < n && (j === m || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) emit("remove", a[start + i++]!);
      else emit("add", b[start + j++]!);
    }
  }
  emit("equal", a.slice(endA).join(""));
  return { chunks, coarse };
}
