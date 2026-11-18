/**
 * 全量数据导出（第十四期，REST 10 节 `GET /system/exports/:id` 的落地）
 *
 * 与本项目的其它导出同一套纪律，另加两条只属于"全量"的：
 *   1 **绝不导出密钥材料**：密码哈希、令牌哈希、双因素密钥、SMTP/AI 的密文原样不外泄
 *      （`setting` 里的敏感键按掩码导出，与 GET /settings 同一口径）
 *   2 **同步导出、不落盘**：规范给的 `:id` 形态需要附件存储 L2 来承载导出包文件（尚未落地），
 *      因此本期提供**同步 JSON 导出**并在响应头标注 `schemaVersion` 与 `x-export-mode: inline`。
 *      **不假装已有异步打包任务** —— 前端与文档都按"同步"说明。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { listSettings } from "./setting.service.ts";

export const FULL_EXPORT_SCHEMA_VERSION = "1";

/** 逐表导出（表名 → 行数 + 数据）；敏感表单独处理 */
const TABLES: { name: string; sensitive?: boolean }[] = [
  { name: "organization" }, { name: "team" }, { name: "role" }, { name: "permission" },
  { name: "role_assignment" }, { name: "project" }, { name: "project_status_def" },
  { name: "project_membership" }, { name: "workflow" }, { name: "workflow_state" },
  { name: "workflow_transition" }, { name: "work_item" }, { name: "work_item_relation" },
  { name: "work_item_collaborator" }, { name: "custom_field_def" }, { name: "custom_field_value" },
  { name: "milestone" }, { name: "iteration" }, { name: "release" }, { name: "module" },
  { name: "saved_view" }, { name: "comment" }, { name: "subscription" }, { name: "attachment" },
  { name: "notification" }, { name: "notification_preference" }, { name: "todo" },
  { name: "activity_entry" }, { name: "audit_entry" }, { name: "idea" }, { name: "idea_vote" },
  { name: "intake_form" }, { name: "intake_submission" }, { name: "import_batch" },
  { name: "import_mapping" }, { name: "metric_snapshot" }, { name: "dashboard" },
  { name: "dashboard_widget" }, { name: "page" }, { name: "page_permission" },
  { name: "page_revision" }, { name: "page_chunk" }, { name: "index_job" },
  { name: "webhook_endpoint" }, { name: "webhook_delivery" }, { name: "time_block" },
  { name: "focus_session" }, { name: "portfolio" }, { name: "portfolio_project" },
  { name: "ai_provider_config" }, { name: "ai_usage_counter" }, { name: "idempotency_key" },
  { name: "skill" }, { name: "dev_activity_daily" }, { name: "rag_consent" },
];

/** 明确排除的表及原因（导出必须能解释自己少了什么） */
export const EXCLUDED_TABLES: Record<string, string> = {
  member: "仅导出非敏感字段（不含密码哈希）",
  session: "会话令牌哈希属安全材料",
  api_token: "令牌哈希属安全材料（元数据见 /me/data-export）",
  password_reset_token: "重置令牌属安全材料",
  invite: "邀请令牌哈希属安全材料",
  two_factor_secret: "双因素密钥与恢复码属安全材料",
  setting: "按掩码导出（敏感键不可回显）",
};

function assertExport(actor: Actor) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}
async function buildExport() {
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};

  for (const t of TABLES) {
    // 表名来自代码内常量白名单（不来自请求），因此这里是安全的标识符拼接
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`select * from "${t.name}" limit 20000`));
    data[t.name] = rows;
    counts[t.name] = rows.length;
  }
  // 成员：**去掉密码哈希**
  const members = await db.execute<Record<string, unknown>>(sql.raw(
    `select id, username, name, email, status, locale, timezone, is_initial_admin, anonymized_at, created_at from "member" limit 20000`));
  data.member = members;
  counts.member = members.length;
  // 设置：按对外口径（敏感键掩码）
  data.setting = await listSettings();

  return {
    schemaVersion: FULL_EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    excludedTables: EXCLUDED_TABLES,
    orderHint: "建议导入顺序：organization/team/role → member → project → workflow → work_item → 其余",
    counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    data,
  };
}

/** 同步导出（保留：接口 no-store、适合小库；异步包见 writeFullExportPackage） */
export async function fullExport(actor: Actor) {
  assertExport(actor);
  const base = await buildExport();
  return {
    ...base,
    mode: "inline" as const,
    note: "同步导出（未落盘）。大库请用 POST /system/exports 走异步打包。",
  };
}

/**
 * 异步导出包（Round 46）：任务队列里生成 JSON 文件，GET /system/exports/:id 下载。
 * 落盘目录 DATA_DIR/exports（0700），文件名 = 任务 id；**包含敏感掩码口径与内联导出完全一致**。
 */
export function exportPackageDir(): string {
  return join(process.env.DATA_DIR ?? "/tmp/feronavi-data", "exports");
}
export function exportPackagePath(jobId: string): string {
  return join(exportPackageDir(), `${jobId}.json`);
}

export async function writeFullExportPackage(jobId: string): Promise<{ path: string; bytes: number; schemaVersion: string }> {
  const base = await buildExport();
  const payload = {
    ...base,
    mode: "async" as const,
    note: "异步导出包：由任务队列生成；下载后请妥善保管（含组织全量业务数据，敏感材料按口径掩码）。",
  };
  const text = JSON.stringify(payload);
  await mkdir(exportPackageDir(), { recursive: true, mode: 0o700 });
  const path = exportPackagePath(jobId);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  return { path, bytes: Buffer.byteLength(text), schemaVersion: FULL_EXPORT_SCHEMA_VERSION };
}

export async function readFullExportPackage(jobId: string): Promise<Buffer> {
  return readFile(exportPackagePath(jobId));
}
