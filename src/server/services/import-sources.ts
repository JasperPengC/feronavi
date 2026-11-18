/**
 * 导入源适配（第十二期）
 *
 * 规范把「禅道 / Jira 导入」前移到 P2（理由：目标用户的转化入口，不是锦上添花）。
 * 这两家的导出 CSV 与我们的字段名完全不同，且**枚举取值是本地化的中文/英文别名**
 * （禅道"需求/任务/Bug"、Jira"Story/Task/Bug"）。规范要求"日期格式与优先级/严重度枚举
 * 需映射表 + 人工确认，不能硬编码猜测" —— 因此本文件只提供**建议**，最终由用户确认。
 *
 * ⚠️ **Excel（.xlsx）本期不实现，理由登记在文档**：npm 上的 `xlsx` 停留在 0.18.5 这条
 *    已知存在 CVE 的旧线（SheetJS 已改为站外分发），为一个导入格式引入带洞依赖不划算；
 *    自研 ZIP+XML 解析在剩余预算内做不扎实。改用「让用户另存为 CSV」这条无依赖路径。
 */

export type ImportSource = "CSV" | "ZENTAO_API" | "JIRA_API" | "EXCEL";

export interface SourcePreset {
  key: string;
  label: string;
  /** 源列名（含常见别名）→ 平台目标字段 */
  aliases: Record<string, string>;
  /** 枚举取值 → 平台取值（仅**建议**，用户可改） */
  values: Record<string, Record<string, string>>;
  /** 该源里最可能作为幂等键的列 */
  externalIdCandidates: string[];
}

const TYPE_ZH: Record<string, string> = { "需求": "REQUIREMENT", "任务": "TASK", "bug": "DEFECT", "Bug": "DEFECT", "缺陷": "DEFECT", "子任务": "SUBTASK" };
const PRIORITY_ZH: Record<string, string> = { "1": "URGENT", "2": "HIGH", "3": "MEDIUM", "4": "LOW", "紧急": "URGENT", "高": "HIGH", "中": "MEDIUM", "低": "LOW", "最低": "LOWEST" };
const SEVERITY_ZH: Record<string, string> = { "1": "S1", "2": "S2", "3": "S3", "4": "S4" };

export const PRESETS: Record<string, SourcePreset> = {
  ZENTAO: {
    key: "ZENTAO",
    label: "禅道（CSV 导出）",
    aliases: {
      "标题": "title", "名称": "title", "Bug标题": "title",
      "描述": "description", "详情": "description", "重现步骤": "description",
      "类型": "type", "需求类型": "type",
      "优先级": "priority", "严重程度": "severity", "严重度": "severity",
      "指派给": "assignee", "指派给谁": "assignee", "负责人": "assignee",
      "开始日期": "start_date", "截止日期": "due_date", "预计结束": "due_date",
      "预计工时": "estimate_points", "故事点": "estimate_points", "预计": "estimate_points",
      "编号": "__externalId", "Bug编号": "__externalId", "需求编号": "__externalId", "ID": "__externalId",
    },
    values: { type: TYPE_ZH, priority: PRIORITY_ZH, severity: SEVERITY_ZH },
    externalIdCandidates: ["__externalId"],
  },
  JIRA: {
    key: "JIRA",
    label: "Jira（CSV 导出）",
    aliases: {
      "Summary": "title", "Issue key": "__externalId", "Issue Key": "__externalId", "Key": "__externalId",
      "Description": "description",
      "Issue Type": "type", "Issue type": "type", "Type": "type",
      "Priority": "priority", "Severity": "severity",
      "Assignee": "assignee", "Start date": "start_date", "Due Date": "due_date", "Due date": "due_date",
      "Story Points": "estimate_points", "Story point estimate": "estimate_points",
    },
    values: {
      type: { "Story": "REQUIREMENT", "Task": "TASK", "Bug": "DEFECT", "Sub-task": "SUBTASK", "Subtask": "SUBTASK" },
      priority: { "Highest": "URGENT", "High": "HIGH", "Medium": "MEDIUM", "Low": "LOW", "Lowest": "LOWEST" },
    },
    externalIdCandidates: ["__externalId"],
  },
};

/** 分隔符嗅探：逗号 / 分号 / 制表符（欧洲导出常用分号，禅道导出可能带制表符） */
export function sniffDelimiter(text: string): "," | ";" | "\t" {
  const firstLines = text.split(/\r?\n/).slice(0, 5).filter((l) => l.trim().length > 0);
  const score = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>;
  for (const line of firstLines) {
    // 只看引号外的分隔符（引号内的逗号不算）
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch in score) score[ch]!++;
    }
  }
  const best = (Object.entries(score).sort((a, b) => b[1] - a[1])[0] ?? [","])[0];
  return (score[best] ?? 0) > 0 ? (best as "," | ";" | "\t") : ",";
}

export interface MappingSuggestion {
  source: string;
  fieldMap: Record<string, string>;        // 源列 → 目标字段（不含 __externalId）
  valueMaps: Record<string, Record<string, string>>;
  externalIdColumn: string | null;
  unmatchedColumns: string[];
  notes: string[];
}

/**
 * 按预设给出**映射建议**（规范要求人工确认，故这里只建议、不自动套用）。
 * 目标字段只保留 `import.service` 支持的那些；`__externalId` 单独返回为幂等键。
 */
export function suggestMapping(header: string[], source: string): MappingSuggestion {
  const preset = PRESETS[source];
  const notes: string[] = [];
  if (!preset) {
    return { source, fieldMap: {}, valueMaps: {}, externalIdColumn: null, unmatchedColumns: [...header], notes: ["未知来源，请手动映射"] };
  }
  const fieldMap: Record<string, string> = {};
  const unmatched: string[] = [];
  let externalIdColumn: string | null = null;
  for (const col of header) {
    const target = preset.aliases[col];
    if (target === "__externalId") { externalIdColumn ??= col; continue; }
    if (target) fieldMap[col] = target;
    else unmatched.push(col);
  }
  if (!Object.values(fieldMap).includes("title")) notes.push("未识别到标题列，请手动指定（title 必填）");
  if (!externalIdColumn) notes.push("未识别到编号列；将用整行指纹做幂等键");
  const valueMaps: Record<string, Record<string, string>> = {};
  for (const [field, map] of Object.entries(preset.values)) {
    if (fieldMap && Object.values(fieldMap).includes(field)) valueMaps[field] = map;
  }
  return { source, fieldMap, valueMaps, externalIdColumn, unmatchedColumns: unmatched, notes };
}
