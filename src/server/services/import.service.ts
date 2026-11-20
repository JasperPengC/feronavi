/**
 * 导入（第九期，规范 5.12）
 *
 * 规范把导入列为 P2 并明确「四项必须有的能力，缺一项这个功能就废」：
 *   ① 试运行（dry-run）② 整批回滚 ③ 幂等（外部 ID ↔ 内部 ID 映射表）④ 编码识别（禅道导出常为 GBK）
 * 本文件是这四项的实现载体；**首版不含附件与评论**（规范明示，界面与文档都要写清）。
 */
import { createHash } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { importBatch, importMapping, project, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { importCollabEvent } from "./collab-event-payload.ts";
import { publishProjectEvent } from "./collab-events.service.ts";
import { businessEffects } from "./business-effects.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import * as wiService from "../services/work-item.service.ts";
import * as projectService from "../services/project.service.ts";
import { sniffDelimiter, suggestMapping } from "./import-sources.ts";
import { isXlsx, parseXlsx, sheetToCsv } from "../lib/xlsx.ts";
import { lockProjectTree } from "./project-tree.ts";

// ── ① 编码识别 ────────────────────────────────────────────────

export interface DecodeResult { text: string; encoding: string; hadBom: boolean }

/**
 * 编码识别：BOM → UTF-8 → **GBK 兜底**（禅道导出常为 GBK）。
 * 判据是"能否严格解码"：UTF-8 用 fatal 模式，失败即说明不是 UTF-8，再试 GBK。
 * 显式传入 encoding 时**跳过识别**（用户覆盖优先）。
 */
export function decodeBuffer(buf: Buffer, override?: string | null): DecodeResult {
  if (override) {
    const enc = override.toLowerCase();
    if (enc === "utf-8" || enc === "utf8") {
      const hadBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      return { text: new TextDecoder("utf-8").decode(buf), encoding: "utf-8", hadBom };
    }
    return { text: new TextDecoder(enc).decode(buf), encoding: enc, hadBom: false };
  }

  const hadBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (hadBom) return { text: new TextDecoder("utf-8").decode(buf), encoding: "utf-8", hadBom: true };

  try {
    // fatal 模式：有任何非法 UTF-8 字节序列就抛错 —— 这正是"是不是 UTF-8"的判据
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8", hadBom: false };
  } catch {
    try {
      return { text: new TextDecoder("gbk").decode(buf), encoding: "gbk", hadBom: false };
    } catch {
      // 两个都不行：退到宽松 UTF-8（会用替换字符），但**明确标注**给用户看
      return { text: new TextDecoder("utf-8").decode(buf), encoding: "utf-8(lossy)", hadBom: false };
    }
  }
}

// ── ② CSV 解析（RFC 4180）────────────────────────────────────

/** 解析 CSV：支持引号包裹、引号内逗号与换行、`""` 转义、CRLF/LF 混用 */
export function parseCsv(text: string, delimiter: string = ","): { header: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // "" → 一个引号
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { record.push(field); field = ""; continue; }
    if (c === "\r") { if (text[i + 1] === "\n") i++; /* CRLF 视为一个换行 */ }
    if (c === "\r" || c === "\n") { record.push(field); records.push(record); record = []; field = ""; continue; }
    field += c;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }

  // 去掉尾部的全空行（Excel 导出常见）
  while (records.length > 0 && records[records.length - 1]!.every((v) => v.trim() === "")) records.pop();
  const header = (records.shift() ?? []).map((h) => h.trim());
  const rows = records.map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, idx) => { if (h) o[h] = (r[idx] ?? "").trim(); });
    return o;
  });
  return { header, rows };
}

// ── 批次生命周期 ──────────────────────────────────────────────

async function assertProjectVisible(actor: Actor, projectId: string) {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}
function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
function assertImportAllowed(actor: Actor, projectId: string) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  // dry-run 与 confirm 权限相同（规范：避免"能预览、不能导入"的落差）
  if (!can(actor, "work_item:create", { projectId, teamId: null }, ctx)) throw forbidden();
}

export async function createBatch(actor: Actor, projectId: string, input: {
  filename: string | null; buffer: Buffer; source?: string; encoding?: string | null;
}) {
  await assertProjectVisible(actor, projectId);
  assertImportAllowed(actor, projectId);

  const dec = decodeBuffer(input.buffer, input.encoding);
  /**
   * `.xlsx` 是 ZIP（魔数 `PK\x03\x04`）→ 用**自研解析器**转成 CSV 文本，复用下面同一条管线。
   * 不引依赖：npm 上的 `xlsx` 停留在已知含 CVE 的旧线（SheetJS 已站外分发），
   * 而我们只需要读单元格值，`node:zlib` + 最小 XML 提取足够。
   */
  const workbook = isXlsx(input.buffer) ? parseXlsx(input.buffer) : null;
  const sourceText = workbook ? sheetToCsv(workbook[0]!.rows) : dec.text;
  // 分隔符嗅探：禅道/欧洲导出常见分号或制表符，写死逗号会解析成一整列
  const delimiter = workbook ? "," : sniffDelimiter(sourceText);
  const { header, rows } = parseCsv(sourceText, delimiter);
  if (header.length === 0) throw new DomainError("VALIDATION", "文件没有表头行", null);
  if (rows.length === 0) throw new DomainError("VALIDATION", "文件没有数据行", null);

  const [row] = await db.insert(importBatch).values({
    projectId,
    source: input.source ?? "CSV",
    filename: input.filename,
    status: "DRY_RUN",
    mappingConfig: { encoding: dec.encoding, hadBom: dec.hadBom, delimiter, header, fieldMap: {}, valueMaps: {}, userMap: {} } as object,
    totalRows: rows.length,
    rows: rows as object,
    createdBy: actor.memberId,
  }).returning();
  await recordBusinessEvent({
    actor, action: "import.batch_created", targetType: "IMPORT_BATCH", targetId: row!.id, projectId,
    summary: `${actor.name} 创建了导入批次${input.filename ? `「${input.filename}」` : ""}（${rows.length} 行待确认）`,
  });
  return { batch: row!, encoding: dec.encoding, delimiter, header, sampleRows: rows.slice(0, 5) };
}

async function loadBatch(actor: Actor, id: string) {
  const rows = await db.select().from(importBatch).where(eq(importBatch.id, id)).limit(1);
  const b = rows[0];
  if (!b) throw forbidden();
  await assertProjectVisible(actor, b.projectId);
  return b;
}

export async function getBatch(actor: Actor, id: string) {
  const b = await loadBatch(actor, id);
  const cfg = (b.mappingConfig ?? {}) as Record<string, unknown>;
  return {
    ...b,
    // 报告可能很长：详情里带上，列表里不带
    header: (cfg.header ?? []) as string[],
    fieldMap: (cfg.fieldMap ?? {}) as Record<string, string>,
    encoding: cfg.encoding ?? null,
    preview: cfg.preview ?? null,
  };
}

export async function listBatches(actor: Actor, projectId: string) {
  await assertProjectVisible(actor, projectId);
  const rows = await db.select().from(importBatch).where(eq(importBatch.projectId, projectId))
    .orderBy(desc(importBatch.createdAt)).limit(50);
  // 列表不带原始行数据（可能很大）
  return rows.map(({ rows: _rows, ...rest }) => rest);
}

void project; void workItem; void wiService; void importMapping; void and;

// ── ③ 字段映射与用户映射（人工确认）──────────────────────────

/** 可映射的目标字段（工作项）。首版**不含附件与评论**（规范明示） */
export const TARGET_FIELDS = [
  "title", "description", "type", "priority", "severity",
  "assignee", "start_date", "due_date", "estimate_points",
] as const;
const REQUIRED_TARGETS = ["title"];
const ENUMS: Record<string, readonly string[]> = {
  type: ["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"],
  priority: ["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"],
  severity: ["S1", "S2", "S3", "S4"],
};

export interface MappingInput {
  fieldMap: Record<string, string>;                        // 源列 → 目标字段
  valueMaps?: Record<string, Record<string, string>>;      // 目标字段 → { 源值: 平台值 }
  userMap?: Record<string, string>;                        // 源用户名 → memberId（人工确认）
  externalIdColumn?: string | null;                        // 哪一列是外部 ID（幂等键）
  defaultType?: string;
}

/** 预演只绑定会影响导入的输入，服务端执行元数据不参与指纹。 */
function importInputFingerprint(rows: unknown, cfg: Record<string, unknown>): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]),
    );
    return value;
  }
  return createHash("sha256").update(JSON.stringify(canonical({
    rows, fieldMap: cfg.fieldMap ?? {}, valueMaps: cfg.valueMaps ?? {},
    userMap: cfg.userMap ?? {}, externalIdColumn: cfg.externalIdColumn ?? null,
    defaultType: cfg.defaultType ?? "TASK",
  }))).digest("hex");
}

export async function setMapping(actor: Actor, id: string, input: MappingInput) {
  const b = await loadBatch(actor, id);
  assertImportAllowed(actor, b.projectId);
  if (["ROLLED_BACK", "SUCCEEDED", "RUNNING"].includes(b.status)) {
    throw new DomainError("CONFLICT", "该批次已完成或已回滚，不能再改映射", null);
  }
  const cfg = (b.mappingConfig ?? {}) as Record<string, unknown>;
  const header = (cfg.header ?? []) as string[];

  const targets = Object.values(input.fieldMap ?? {});
  for (const t of targets) {
    if (!(TARGET_FIELDS as readonly string[]).includes(t)) {
      throw new DomainError("VALIDATION", `不支持的目标字段「${t}」`, { target: t });
    }
  }
  // 同一个目标字段被两列映射 → 后写的覆盖前值，属于用户笔误，直接拒
  const dup = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (dup.length) throw new DomainError("VALIDATION", `目标字段被重复映射：${[...new Set(dup)].join(", ")}`, null);
  const missing = REQUIRED_TARGETS.filter((t) => !targets.includes(t));
  if (missing.length) throw new DomainError("VALIDATION", `缺少必填字段映射：${missing.join(", ")}`, null);
  for (const col of Object.keys(input.fieldMap ?? {})) {
    if (!header.includes(col)) throw new DomainError("VALIDATION", `源列「${col}」不在文件表头中`, { column: col });
  }
  if (input.externalIdColumn && !header.includes(input.externalIdColumn)) {
    throw new DomainError("VALIDATION", `外部 ID 列「${input.externalIdColumn}」不在文件表头中`, null);
  }
  if (input.defaultType && !ENUMS.type!.includes(input.defaultType)) {
    throw new DomainError("VALIDATION", `默认类型「${input.defaultType}」非法`, null);
  }
  // 用户映射里的 memberId 必须真实存在且是项目成员（规范：人名 → ID 不许猜）
  const userMap = input.userMap ?? {};
  if (Object.keys(userMap).length) {
    // 复用既有的项目成员查询（人名 → ID 的唯一途径，规范护栏）
    const members = await projectService.membersOf(actor, b.projectId);
    const ids = new Set(members.map((m) => m.id));
    const bad = Object.entries(userMap).filter(([, v]) => !ids.has(v));
    if (bad.length) {
      throw new DomainError("VALIDATION", `用户映射里有 ${bad.length} 个成员 ID 不属于该项目成员`, { bad: bad.slice(0, 5) });
    }
  }

  const { _dryRun: _oldPreview, ...savedConfig } = cfg;
  const next = {
    ...savedConfig,
    fieldMap: input.fieldMap ?? {},
    valueMaps: input.valueMaps ?? (cfg.valueMaps as object) ?? {},
    userMap,
    externalIdColumn: input.externalIdColumn ?? null,
    defaultType: input.defaultType ?? "TASK",
    preview: null,
  };
  const changed = await db.update(importBatch).set({ mappingConfig: next as object, status: "PENDING_CONFIRM" })
    .where(and(eq(importBatch.id, id), eq(importBatch.status, b.status), eq(importBatch.mappingConfig, b.mappingConfig))).returning({ id: importBatch.id });
  if (!changed.length) throw new DomainError("CONFLICT", "批次状态已变化，请刷新后重试", null);
  await recordBusinessEvent({ actor, action: "import.mapping_updated", targetType: "IMPORT_BATCH", targetId: id, projectId: b.projectId });
  return { ok: true, mapping: next };
}

// ── 行 → 工作项载荷（dry-run 与 confirm 共用，避免两套口径）──

interface RowResult { index: number; externalId: string; ok: boolean; reason?: string; code?: string; payload?: Record<string, unknown> }

function stableExternalId(row: Record<string, string>, col: string | null): string {
  if (col && row[col]) return String(row[col]);
  // 没有外部 ID 列时：用整行内容的指纹 —— 仍然满足"同一文件导两次不产生两份"
  return `sha1:${createHash("sha1").update(JSON.stringify(row)).digest("hex").slice(0, 16)}`;
}

function buildRow(row: Record<string, string>, cfg: Record<string, unknown>): RowResult {
  const fieldMap = (cfg.fieldMap ?? {}) as Record<string, string>;
  const valueMaps = (cfg.valueMaps ?? {}) as Record<string, Record<string, string>>;
  const userMap = (cfg.userMap ?? {}) as Record<string, string>;
  const defaultType = (cfg.defaultType as string) ?? "TASK";
  const get = (target: string): string | undefined => {
    const col = Object.entries(fieldMap).find(([, t]) => t === target)?.[0];
    if (!col) return undefined;
    const raw = row[col];
    if (raw === undefined || raw === "") return undefined;
    // 枚举映射先过人工确认的映射表，再校验
    return valueMaps[target]?.[raw] ?? raw;
  };

  const title = get("title");
  if (!title) return { index: -1, externalId: "", ok: false, code: "VALIDATION", reason: "缺少标题" };
  const type = get("type") ?? defaultType;
  if (!ENUMS.type!.includes(type)) {
    return { index: -1, externalId: "", ok: false, code: "VALIDATION", reason: `类型「${type}」不在允许值内（需要值映射）` };
  }
  const priority = get("priority");
  if (priority && !ENUMS.priority!.includes(priority)) {
    return { index: -1, externalId: "", ok: false, code: "VALIDATION", reason: `优先级「${priority}」不在允许值内（需要值映射）` };
  }
  const severity = get("severity");
  if (severity && !ENUMS.severity!.includes(severity)) {
    return { index: -1, externalId: "", ok: false, code: "VALIDATION", reason: `严重度「${severity}」不在允许值内（需要值映射）` };
  }
  const estimate = get("estimate_points");
  if (estimate !== undefined && Number.isNaN(Number(estimate))) {
    return { index: -1, externalId: "", ok: false, code: "VALIDATION", reason: `故事点「${estimate}」不是数字` };
  }
  const assigneeName = get("assignee");
  let assigneeId: string | null = null;
  if (assigneeName) {
    assigneeId = userMap[assigneeName] ?? null;
    // 规范：用户映射必须人工确认，**不许自动猜**（重名/离职/外部人员）
    if (!assigneeId) {
      return { index: -1, externalId: "", ok: false, code: "VALIDATION", reason: `指派人「${assigneeName}」尚未在用户映射中确认` };
    }
  }
  return {
    index: -1, externalId: "", ok: true,
    payload: {
      type, title,
      description: get("description") ?? undefined,
      priority: priority ?? undefined,
      severity: type === "DEFECT" ? (severity ?? undefined) : undefined,
      assigneeId: assigneeId ?? undefined,
      startDate: get("start_date") ?? undefined,
      dueDate: get("due_date") ?? undefined,
      estimatePoints: estimate !== undefined ? Number(estimate) : undefined,
    },
  };
}

// ── ④ 试运行（**不写任何业务表**）─────────────────────────────

export async function dryRun(actor: Actor, id: string) {
  const b = await loadBatch(actor, id);
  assertImportAllowed(actor, b.projectId);
  if (["RUNNING", "SUCCEEDED", "ROLLED_BACK"].includes(b.status)) throw new DomainError("CONFLICT", "该批次不能再次试运行", null);
  const cfg = (b.mappingConfig ?? {}) as Record<string, unknown>;
  const rows = (b.rows ?? []) as Record<string, string>[];
  const extCol = (cfg.externalIdColumn as string | null) ?? null;

  const existing = await db.select().from(importMapping)
    .where(and(eq(importMapping.projectId, b.projectId), eq(importMapping.entity, "WORK_ITEM"), eq(importMapping.isActive, true)));
  const known = new Map(existing.map((m) => [m.externalId, m.internalId]));

  const report: RowResult[] = [];
  let willCreate = 0, willSkip = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = buildRow(rows[i]!, cfg);
    const externalId = stableExternalId(rows[i]!, extCol);
    if (!r.ok) { failed++; report.push({ ...r, index: i + 2, externalId }); continue; }
    if (known.has(externalId)) { willSkip++; continue; }
    known.set(externalId, "pending");
    willCreate++;
  }

  const preview = { totalRows: rows.length, willCreate, willSkip, failed, errorReport: report.slice(0, 200) };
  // 预览错误与上次实际执行失败不是同一集合；修正映射后仍须记得重试哪些原始行。
  const failedRowIndices = cfg._failedRowIndices ?? (b.finishedAt
    ? ((b.errorReport ?? []) as RowResult[]).filter(row => !row.ok).map(row => row.index) : undefined);
  const changed = await db.update(importBatch).set({
    status: "PENDING_CONFIRM",
    errorReport: report as object,
    mappingConfig: { ...cfg, ...(failedRowIndices === undefined ? {} : { _failedRowIndices: failedRowIndices }), preview, _dryRun: { fingerprint: importInputFingerprint(rows, cfg), totalRows: rows.length, willCreate, willSkip, failed } },
  }).where(and(eq(importBatch.id, id), eq(importBatch.status, b.status), eq(importBatch.mappingConfig, b.mappingConfig), eq(importBatch.rows, b.rows))).returning({ id: importBatch.id });
  if (!changed.length) throw new DomainError("CONFLICT", "批次状态已变化，请刷新后重试", null);
  await recordBusinessEvent({ actor, action: "import.previewed", targetType: "IMPORT_BATCH", targetId: id, projectId: b.projectId });

  // 明确的统计口径：将创建 / 将跳过（已导入过）/ 失败
  return preview;
}

// ── ⑤ 确认写入（幂等 + 分批 + 部分成功）──────────────────────

export async function confirm(actor: Actor, id: string, opts: { retryFailedOnly?: boolean } = {}) {
  const b = await loadBatch(actor, id);
  assertImportAllowed(actor, b.projectId);
  if (b.status === "ROLLED_BACK") throw new DomainError("CONFLICT", "该批次已回滚，请重新导入", null);

  const running = await db.transaction(async () => {
    await lockProjectTree(b.projectId);
    const [current] = await db.select().from(importBatch).where(eq(importBatch.id, id)).for("update");
    if (!current || ["RUNNING", "ROLLED_BACK"].includes(current.status)) {
      throw new DomainError("CONFLICT", "该批次正在运行或已回滚", null);
    }
    const config = (current.mappingConfig ?? {}) as Record<string, unknown>;
    const preview = config._dryRun as { fingerprint?: unknown } | undefined;
    if (!preview || preview.fingerprint !== importInputFingerprint(current.rows, config)) {
      throw new DomainError("CONFLICT", "请先对当前映射和数据完成试运行，再确认导入", null);
    }
    const [claimed] = await db.update(importBatch).set({ status: "RUNNING", startedAt: new Date() })
      .where(and(eq(importBatch.id, id), ne(importBatch.status, "RUNNING"), ne(importBatch.status, "ROLLED_BACK")))
      .returning();
    if (!claimed) throw new DomainError("CONFLICT", "该批次正在运行或已回滚", null);
    return claimed;
  });
  const cfg = (running.mappingConfig ?? {}) as Record<string, unknown>;
  const rows = (running.rows ?? []) as Record<string, string>[];
  const extCol = (cfg.externalIdColumn as string | null) ?? null;
  const previous = (running.errorReport ?? []) as RowResult[];
  const failedRowIndices = (cfg._failedRowIndices ?? previous.filter((p) => !p.ok).map((p) => p.index)) as number[];
  const retrySet = opts.retryFailedOnly ? new Set(failedRowIndices) : null;

  let created = 0, skipped = 0;
  const failures: RowResult[] = [];
  const BATCH = 200;

  for (let i = 0; i < rows.length; i++) {
    const lineNo = i + 2;                       // 表头占第 1 行
    if (retrySet && !retrySet.has(lineNo)) continue;
    const row = rows[i]!;
    const externalId = stableExternalId(row, extCol);
    const built = buildRow(row, cfg);
    if (!built.ok) { failures.push({ ...built, index: lineNo, externalId }); continue; }

    try {
      // 每行工作项与映射同事务；项目锁同时阻止不同批次导入同一个外部 ID。
      const inserted = await db.transaction(async () => {
        await lockProjectTree(b.projectId);
        const [hit] = await db.select().from(importMapping).where(and(
          eq(importMapping.projectId, b.projectId), eq(importMapping.entity, "WORK_ITEM"), eq(importMapping.externalId, externalId),
        )).limit(1);
        if (hit?.isActive) return false;
        const wi = await wiService.createWorkItem(actor, b.projectId, built.payload as never);
        if (!wi) throw new DomainError("INTERNAL", "工作项创建未返回结果", null);
        if (hit) {
          await db.update(importMapping).set({ internalId: wi.id, isActive: true, batchId: b.id }).where(eq(importMapping.id, hit.id));
        } else {
          await db.insert(importMapping).values({
            batchId: b.id, projectId: b.projectId, entity: "WORK_ITEM", externalId, internalId: wi.id,
          });
        }
        // 与工作项和幂等映射同事务记录基线；回滚不能猜测旧批次的初始版本。
        cfg._importedVersions = { ...((cfg._importedVersions ?? {}) as Record<string, number>), [wi.id]: wi.version };
        await db.update(importBatch).set({ mappingConfig: cfg as object }).where(eq(importBatch.id, b.id));
        return true;
      });
      if (inserted) created++; else skipped++;
    } catch (e) {
      failures.push({
        index: lineNo, externalId, ok: false,
        code: (e as { code?: string }).code ?? "INTERNAL",
        reason: (e as Error).message,
      });
    }
    // 分批提交：每 200 行让出一次，避免单事务过长（规范第 5.12 节事务边界）
    if (created > 0 && created % BATCH === 0) await new Promise((r) => setImmediate(r));
  }

  const failed = failures.length;
  const status = created === 0 && failed > 0 && skipped === 0 ? "FAILED"
    : failed > 0 ? "PARTIAL" : "SUCCEEDED";
  await db.update(importBatch).set({
    status,
    createdCount: running.createdCount + created,
    failedCount: failed,
    errorReport: failures as object,
    mappingConfig: { ...cfg, _failedRowIndices: failures.map(row => row.index) },
    finishedAt: new Date(),
  }).where(eq(importBatch.id, id));
  await recordBusinessEvent({
    actor, action: "import.confirmed", targetType: "IMPORT_BATCH", targetId: id, projectId: b.projectId,
    summary: `${actor.name} 确认导入了 ${created} 行工作项（跳过 ${skipped}、失败 ${failed}）`,
  });
  const event = importCollabEvent("import.completed", {
    batchId: id, projectId: b.projectId, status, created, skipped, failed,
  });
  await publishProjectEvent(b.projectId, event.event, event.data);

  return { created, skipped, failed, status, errorReport: failures.slice(0, 200) };
}

// ── ⑥ 整批回滚 ────────────────────────────────────────────────

export async function rollback(actor: Actor, id: string) {
  const b = await loadBatch(actor, id);
  assertImportAllowed(actor, b.projectId);
  return db.transaction(async () => {
    await lockProjectTree(b.projectId);
    return rollbackLocked(actor, id);
  });
}

async function rollbackLocked(actor: Actor, id: string) {
  const b = await loadBatch(actor, id);
  const ctx: PermissionContext = { memberId: actor.memberId, memberProjectIds: new Set(), memberTeamIds: new Set() };
  // 批次回滚是删除操作；创建权限不包含删除，也不能管理他人的批次。
  if (!can(actor, "work_item:delete", { projectId: b.projectId }, ctx)
    || (b.createdBy !== actor.memberId && !can(actor, "project:update", { projectId: b.projectId }, ctx))) throw forbidden();
  if (b.status === "RUNNING") throw new DomainError("CONFLICT", "批次正在运行，请完成后回滚", null);
  if (b.status === "ROLLED_BACK") return { ok: true, alreadyRolledBack: true, removed: 0, retainedModified: 0, retainedUnknown: 0, skippedDeleted: 0 };

  const maps = await db.select().from(importMapping)
    .where(and(eq(importMapping.batchId, b.id), eq(importMapping.isActive, true)));

  const versions = ((b.mappingConfig as Record<string, unknown>)?._importedVersions ?? {}) as Record<string, number>;
  let removed = 0, retainedModified = 0, retainedUnknown = 0, skippedDeleted = 0;
  for (const m of maps) {
    if (m.entity === "WORK_ITEM") {
      const [current] = await db.select({ version: workItem.version, deletedAt: workItem.deletedAt }).from(workItem)
        .where(and(eq(workItem.id, m.internalId), eq(workItem.projectId, b.projectId))).for("update");
      if (!current || current.deletedAt) {
        skippedDeleted++;
        await db.update(importMapping).set({ isActive: false }).where(eq(importMapping.id, m.id));
        continue;
      }
      if (!Number.isInteger(versions[m.internalId])) { retainedUnknown++; continue; }
      if (current.version !== versions[m.internalId]) { retainedModified++; continue; }
      // 只有与导入基线一致的项才软删；保留项的活动映射继续防止重复导入。
      const res = await db.update(workItem).set({ deletedAt: new Date() })
        .where(and(eq(workItem.id, m.internalId), eq(workItem.projectId, b.projectId)))
        .returning({ id: workItem.id, key: workItem.key, version: workItem.version });
      if (res.length) {
        removed++;
        await businessEffects().deliverWebhook("work_item.deleted", {
          id: res[0]!.id, key: res[0]!.key, projectId: b.projectId, version: res[0]!.version,
          actorId: actor.memberId,
        }, b.projectId);
      }
      await db.update(importMapping).set({ isActive: false }).where(eq(importMapping.id, m.id));
    }
  }
  await db.update(importBatch).set({ status: "ROLLED_BACK", finishedAt: new Date() }).where(eq(importBatch.id, b.id));
  await recordBusinessEvent({
    actor, action: "import.rolled_back", targetType: "IMPORT_BATCH", targetId: id, projectId: b.projectId,
    summary: `${actor.name} 回滚了导入批次，软删 ${removed} 个工作项，保留 ${retainedModified} 个已修改项、${retainedUnknown} 个无基线项，跳过 ${skippedDeleted} 个已删除项`,
    severity: "SECURITY",
  });
  const event = importCollabEvent("import.rolled_back", {
    batchId: id, projectId: b.projectId, status: "ROLLED_BACK", removed,
  });
  await publishProjectEvent(b.projectId, event.event, event.data);
  return { ok: true, alreadyRolledBack: false, removed, retainedModified, retainedUnknown, skippedDeleted };
}


/** 映射建议（第十二期）：按来源预设给出**建议**，最终仍由用户确认（规范要求人工确认） */
export async function suggestForBatch(actor: Actor, id: string) {
  const b = await loadBatch(actor, id);
  const cfg = (b.mappingConfig ?? {}) as Record<string, unknown>;
  const header = (cfg.header ?? []) as string[];
  const source = b.source === "ZENTAO_API" ? "ZENTAO" : b.source === "JIRA_API" ? "JIRA" : "CSV";
  return { delimiter: (cfg.delimiter as string) ?? ",", ...suggestMapping(header, source) };
}
