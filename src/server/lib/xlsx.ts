/**
 * 极简 .xlsx 读取器（第十四期，Excel 导入）
 *
 * **不引依赖**：`.xlsx` 就是 ZIP + XML，用 `node:zlib` 的 `inflateRawSync` 解压中央目录里的条目，
 * 再用最小 XML 提取读 `workbook.xml` / `sharedStrings.xml` / `sheetN.xml` 即可。
 * 这与本项目一贯原则一致：**拒绝为单一功能引入未审计依赖**（`xlsx` 在 npm 上停留在已知含 CVE 的旧线）。
 *
 * 覆盖范围（刻意保守，且**不支持就明确报错**，不静默给错数据）：
 *   ✅ 共享字符串（t="s"）、内联字符串（t="inlineStr"）、数字 / 布尔、公式的**缓存值**（`<v>`）
 *   ✅ 多工作表、稀疏单元格（按 r 属性定位）
 *   ❌ 日期序列号不做时区/格式推断（按原始数字给出，由导入映射决定怎么解释）
 *   ❌ 不读样式、批注、图片；加密工作簿直接拒绝
 */
import { inflateRawSync } from "node:zlib";

interface Entry { name: string; method: number; data: Buffer }

/** 读取 ZIP 中央目录（EOCD → CD → 本地头） */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("不是有效的 ZIP/xlsx（缺少中央目录结尾）");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    const entry: Entry = { name, method, data: Buffer.alloc(0) };
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("ZIP 本地头损坏");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    entry.data = method === 8 ? inflateRawSync(raw) : raw;
    if (method !== 0 && method !== 8) throw new Error(`不支持的压缩方法：${method}`);
    out.set(name, entry.data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");

/** 列号：A→1、AA→27（稀疏单元格靠它定位） */
function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface Sheet { name: string; rows: string[][] }

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  // <si>…</si>，其中可能有多个 <t>（富文本分片）→ 拼接
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...si[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1]!));
    out.push(parts.join(""));
  }
  return out;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowM of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cM of rowM[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cM[1]!;
      const body = cM[2]!;
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1]!)).join("");
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) value = type === "s" ? (shared[Number(v)] ?? "") : unesc(v);
        else if (type === "b") value = /<v\b[^>]*>1<\/v>/.test(body) ? "true" : "false";
      }
      const idx = ref ? colIndex(ref) : cells.length;
      while (cells.length < idx) cells.push("");   // 稀疏单元格补空，保住列对齐
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** 读取全部工作表（默认按 workbook.xml 的声明顺序） */
export function parseXlsx(buf: Buffer): Sheet[] {
  const zip = readZip(buf);
  const wb = zip.get("xl/workbook.xml")?.toString("utf8");
  if (!wb) throw new Error("不是有效的 xlsx（缺少 xl/workbook.xml）");
  const rels = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const shared = parseSharedStrings(zip.get("xl/sharedStrings.xml")?.toString("utf8"));

  // r:id → 目标路径（工作表文件名不一定是 sheet1.xml）
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1]!)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1]!)?.[1];
    if (id && target) relMap.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unesc(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? `Sheet${sheets.length + 1}`);
    const rid = /\br:id="([^"]+)"/.exec(m[1]!)?.[1];
    const target = rid ? relMap.get(rid) : undefined;
    const xml = target ? zip.get(`xl/${target}`)?.toString("utf8") : undefined;
    if (!xml) continue;                     // 找不到就跳过（不假装有数据）
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  if (sheets.length === 0) throw new Error("xlsx 中没有可读的工作表");
  return sheets;
}

/** 供导入管线复用：把某张表转成 CSV 文本（与 CSV 导入同一入口） */
export function sheetToCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

/** 是否为 xlsx（ZIP 魔数）。用它而不是看文件后缀 —— 后缀是客户端说了算的 */
export function isXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}
