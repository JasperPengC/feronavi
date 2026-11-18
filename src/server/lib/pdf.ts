/**
 * 极简 PDF 写入器（第十四期，PDF 报告）
 *
 * **不引依赖**：PDF 是文本格式，报告型文档（标题 + 段落 + 表格行）用几十行就能生成。
 * **中文用非内嵌 CID 字体**：Type0 + `STSong-Light` / `Adobe-GB1` + `UniGB-UCS2-H`。
 *   优点：无需 TrueType 解析与字体子集化，产物只有几十 KB（内嵌 CJK 字体会让每份报告涨到几十 MB）。
 *   代价：依赖阅读器自带的 CJK 字体（Adobe 亚洲字体包 / 系统字体替换）。
 *   ⚠️ 这是**明确的取舍**，写在文档里：若某阅读器不显示中文，需改为内嵌字体（工作量在字体子集化，不在 PDF 生成）。
 * 文本一律以 **UTF-16BE 十六进制串**写入（CID 编码要求），ASCII 与中文走同一条路径。
 */
const PAGE_W = 595.28;   // A4
const PAGE_H = 841.89;
const MARGIN = 48;

export interface TextBlock {
  text: string;
  size?: number;          // 字号
  bold?: boolean;         // 伪粗体：多描一遍（Helvetica-Bold 无中文，故标题也用同一 CID 字体）
  gapBefore?: number;     // 段前额外间距
}

/** UTF-16BE 十六进制（CID 文本串的表示法） */
function hexText(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      // 基本平面外的字符：转成代理对，避免生成非法 CID
      const h = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
      const l = ((cp - 0x10000) % 0x400) + 0xdc00;
      out += h.toString(16).padStart(4, "0") + l.toString(16).padStart(4, "0");
    } else {
      out += cp.toString(16).padStart(4, "0");
    }
  }
  return out.toUpperCase();
}

/** 估算宽度：中文按 1em、ASCII 按 0.5em（够用于换行判断） */
function widthOf(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0)! > 0x2e80 ? 1 : 0.5) * size;
  return w;
}

/** 按可用宽度折行（中文无空格，按字符折） */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (widthOf(cur + ch, size) > maxWidth && cur !== "") { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur !== "") lines.push(cur);
  return lines.length ? lines : [""];
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** 组装 PDF 字节 */
export function buildPdf(blocks: TextBlock[], opts: { title?: string } = {}): Buffer {
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = PAGE_H - MARGIN;

  const newPage = () => { pages.push(ops); ops = []; y = PAGE_H - MARGIN; };

  for (const b of blocks) {
    const size = b.size ?? 11;
    const lineH = size * 1.6;
    y -= b.gapBefore ?? 0;
    for (const line of wrap(b.text, size, PAGE_W - MARGIN * 2)) {
      if (y - lineH < MARGIN) newPage();
      y -= lineH;
      const draw = (dx: number) => `BT /F1 ${size} Tf 1 0 0 1 ${(MARGIN + dx).toFixed(2)} ${y.toFixed(2)} Tm <${hexText(line)}> Tj ET`;
      ops.push(draw(0));
      if (b.bold) ops.push(draw(0.35));   // 伪粗体
    }
  }
  pages.push(ops);
  if (pages.length > 1 && pages[pages.length - 1]!.length === 0) pages.pop();
  if (pages.length === 0) pages.push([]);

  // ── 对象表（1 Catalog / 2 Pages / 3 Type0 字体 / 4 后代字体 / 5 描述符 / 之后 页面与内容流）
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>`;
  objs[4] = `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 5 0 R /DW 1000 >>`;
  objs[5] = `<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 93 >>`;

  const contents: string[] = [];
  pages.forEach((pageOps, i) => {
    const pid = pageIds[i]!;
    const cid = pid + 1;
    const stream = pageOps.join("\n");
    contents[cid] = stream;
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${cid} 0 R >>`;
    if (opts.title && i === 0) {
      // 文档信息由 trailer 承担；此处不做书签，保持实现最小
    }
  });

  // ── 序列化（含 xref 偏移，PDF 结构必须精确）
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  /**
   * ⚠️ 对象号必须取**两个数组的最大值**：内容流存在 `contents[]` 而非 `objs[]`，
   * 只数 `objs[]` 会漏掉所有内容流对象 —— 生成的 PDF 里页面引用一个不存在的对象，
   * 阅读器打开是**空白页**，而"以 %PDF 开头"这类浅层断言照样通过。
   * 实测被 pypdf 报出 `Object 7 0 not defined`。
   */
  const maxId = Math.max(objs.length - 1, contents.length - 1);
  for (let id = 1; id <= maxId; id++) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    if (contents[id] !== undefined) {
      const body = contents[id]!;
      pdf += `${id} 0 obj\n<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream\nendobj\n`;
    } else {
      pdf += `${id} 0 obj\n${objs[id] ?? "<< >>"}\nendobj\n`;
    }
  }
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R${opts.title ? ` /Info << /Title (${esc(opts.title)}) /Producer (Feronavi) >>` : ""} >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
