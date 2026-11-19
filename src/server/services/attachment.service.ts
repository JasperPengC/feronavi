/**
 * 附件（T4，规范 L1）
 *
 * L1 四条硬要求：
 *   1 大小上限（默认 25MB，可配）
 *   2 **扩展名 + MIME 双重白名单** —— 只查一个不够：扩展名可伪造，MIME 也可伪造
 *   3 文件名清洗（防路径穿越：`../`、绝对路径、控制字符）
 *   4 存储路径 UUID 命名、不可预测
 *
 * ⚠️ **下载与预览必须是两个端点**（规范）：下载 `Content-Disposition: attachment`、
 *    预览 `inline`。合成一个端点意味着预览内容可被当成下载执行，反之亦然。
 */
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { db } from "../../db/index.ts";
import { attachment } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { describeTarget } from "./activity-labels.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { attachmentCollabEvent } from "./collab-event-payload.ts";
import { publishResourceEvent } from "./collab-events.service.ts";
import { isS3Configured, loadStorageConfig, s3Client, storageKey } from "./storage.service.ts";

/** 默认 25MB；部署者可通过环境变量调高 */
const MAX_SIZE = Number(process.env.ATTACHMENT_MAX_BYTES ?? 25 * 1024 * 1024);
/** 本地存储根目录 */
const STORAGE_ROOT = process.env.ATTACHMENT_DIR
  ?? (process.env.DATA_DIR ? join(process.env.DATA_DIR, "attachments") : "/data/attachments");


/**
 * 扩展名 + MIME 双重白名单。
 * ⚠️ 刻意**不用** `mime` 推断库：浏览器给的 MIME 本身不可信，
 *    这里以「扩展名 ↔ 声明的 MIME」成对校验为准。
 */
const ALLOWED: Record<string, string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".pdf": ["application/pdf"],
  ".zip": ["application/zip"],
  ".csv": ["text/csv"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown"],
  ".json": ["application/json"],
};

/**
 * 文件名清洗：防路径穿越。
 * 只保留 basename，再剔除控制字符与 Windows 保留字符。
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
   
  // ⚠️ 正则里必须是单反斜杠的 \x00-\x1f（控制字符范围）。
  //    写成 \\x00-\\x1f 会变成匹配字面量 \ x 0 - 1 f 这些字符，
  //    把文件名里的字母一起替换掉（实测 "evil.txt" 被洗成 "evil.t_t"）。
  const cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/^[.\s]+/, "").trim();
  return cleaned.slice(0, 200) || "file";
}

export function validateUpload(input: {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.sizeBytes <= 0) return { ok: false, reason: "文件不能为空" };
  if (input.sizeBytes > MAX_SIZE) {
    return { ok: false, reason: `文件超过大小上限（${Math.floor(MAX_SIZE / 1024 / 1024)}MB）` };
  }
  const ext = `.${(input.originalName.split(".").pop() ?? "").toLowerCase()}`;
  const allowed = ALLOWED[ext];
  if (!allowed) return { ok: false, reason: `不支持的扩展名 ${ext}` };
  // 双重白名单：MIME 必须落在该扩展名允许的集合里
  if (!allowed.includes(input.mimeType.toLowerCase())) {
    return { ok: false, reason: `扩展名 ${ext} 与声明的类型 ${input.mimeType} 不一致` };
  }
  return { ok: true };
}

/** 目标可见性：附件跟着 target，target 必须看得见 */
async function assertTargetVisible(actor: Actor, targetType: string, targetId: string): Promise<string | null> {
  let pid: string | null;
  if (targetType === "WORK_ITEM") {
    const rows = await db.execute(sql`
      select project_id::text as project_id from work_item where id = ${targetId} and deleted_at is null
    `) as unknown as { project_id: string | null }[];
    pid = rows[0]?.project_id ?? null;
  } else if (targetType === "MILESTONE") {
    const rows = await db.execute(sql`
      select project_id::text as project_id from milestone where id = ${targetId}
    `) as unknown as { project_id: string | null }[];
    pid = rows[0]?.project_id ?? null;
  } else if (targetType === "PAGE") {
    const rows = await db.execute(sql`
      select project_id::text as project_id, visibility from page where id = ${targetId} and deleted_at is null
    `) as unknown as { project_id: string | null; visibility: string }[];
    pid = rows[0]?.project_id ?? null;
    if (pid && rows[0]?.visibility === "RESTRICTED") {
      const wiki = await import("./wiki.service.ts");
      if (!(await wiki.hasAcl(actor, targetId, "read"))) throw forbidden();
    }
  } else if (targetType === "IDEA") {
    const rows = await db.execute(sql`
      select project_id::text as project_id from idea where id = ${targetId} and deleted_at is null
    `) as unknown as { project_id: string | null }[];
    pid = rows[0]?.project_id ?? null;
  } else if (targetType === "COMMENT") {
    const rows = await db.execute(sql`
      select target_type, target_id::text as target_id from comment where id = ${targetId} and deleted_at is null
    `) as unknown as { target_type: string; target_id: string }[];
    const c = rows[0];
    if (!c) throw forbidden();
    return assertTargetVisible(actor, c.target_type, c.target_id);
  } else {
    throw new DomainError("VALIDATION", "不支持的附件目标", null);
  }
  if (!pid) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, pid, actor.grants.some((g) => g.scopeType === "ORG")))) throw forbidden();
  return pid;
}

/** 秒传：同 content_hash 且同大小 → 直接复用已有存储路径 */
async function findDedup(contentHash: string, sizeBytes: number) {
  const rows = await db.select().from(attachment)
    .where(and(eq(attachment.contentHash, contentHash), eq(attachment.sizeBytes, sizeBytes)))
    .limit(1);
  return rows[0] ?? null;
}

/** 存文件：本地磁盘或 S3 兼容对象存储，由系统内存储配置决定。 */
async function store(storagePath: string, data: Buffer, mimeType?: string): Promise<void> {
  const cfg = await loadStorageConfig();
  if (cfg.kind === "s3") {
    if (!isS3Configured(cfg)) throw new DomainError("VALIDATION", "S3 配置不完整，请到设置 → 组织与实例配置附件存储", null);
    await s3Client(cfg).send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: storageKey(cfg, storagePath),
      Body: data,
      ContentType: mimeType,
    }));
    return;
  }
  const full = join(STORAGE_ROOT, storagePath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
}

async function load(storagePath: string, backend: "local" | "s3"): Promise<Buffer> {
  const cfg = await loadStorageConfig();
  if (backend === "s3") {
    if (!isS3Configured(cfg)) throw new DomainError("VALIDATION", "S3 配置不完整，请到设置 → 组织与实例配置附件存储", null);
    const r = await s3Client(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: storageKey(cfg, storagePath) }));
    if (!r.Body) throw new DomainError("INTERNAL", "S3 返回空对象", null);
    return Buffer.from(await r.Body.transformToByteArray());
  }
  return readFile(join(STORAGE_ROOT, storagePath));
}

export async function upload(actor: Actor, input: {
  targetType: string; targetId: string;
  originalName: string; mimeType: string; sizeBytes: number; data: Buffer;
}) {
  const projectId = await assertTargetVisible(actor, input.targetType, input.targetId);
  // 兑现目录承诺的 attachment:upload（权限键审计 2026-11-01）：GUEST 不持有该键 → 访客不可上传；
  // ADMIN/MEMBER/PM 均持有，现有角色行为不变。放在 projectId 解析之后，PROJECT 级授权才能生效。
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "attachment:upload", { projectId, teamId: null, createdBy: null }, ctx)) throw forbidden();
  const v = validateUpload(input);
  if (!v.ok) throw new DomainError("VALIDATION", v.reason, null);

  const contentHash = createHash("sha256").update(input.data).digest("hex");
  const safeName = sanitizeFileName(input.originalName);
  const dup = await findDedup(contentHash, input.sizeBytes);

  // UUID 命名、不可预测（L1）；按日期分目录避免单目录文件过多
  const storagePath = dup?.storagePath ?? `${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  const storageBackend = dup?.storageBackend ?? (await loadStorageConfig()).kind;
  if (!dup) await store(storagePath, input.data, input.mimeType);

  const [row] = await db.insert(attachment).values({
    targetType: input.targetType,
    targetId: input.targetId,
    uploaderId: actor.memberId,
    originalName: safeName,
    storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    contentHash,
    storageBackend,
  }).returning();
  if (projectId) {
    const label = await describeTarget(input.targetType, input.targetId);
    await recordBusinessEvent({
      actor, action: "attachment.uploaded", targetType: "ATTACHMENT", targetId: row!.id, projectId,
      summary: `${actor.name} 在${label}上传了附件「${row!.originalName}」`,
    });
    const resourceType = ["PAGE", "WORK_ITEM", "COMMENT"].includes(input.targetType) ? input.targetType : null;
    if (resourceType) {
      const event = attachmentCollabEvent("attachment.uploaded", {
        attachmentId: row!.id, targetType: input.targetType, targetId: input.targetId, projectId,
        originalName: row!.originalName, mimeType: row!.mimeType, sizeBytes: row!.sizeBytes,
      });
      await publishResourceEvent(resourceType, input.targetId, event.event, event.data);
    }
  }
  return row;
}

export async function listAttachments(actor: Actor, targetType: string, targetId: string) {
  await assertTargetVisible(actor, targetType, targetId);
  return db.select().from(attachment)
    .where(and(eq(attachment.targetType, targetType), eq(attachment.targetId, targetId)));
}

/**
 * 下载：`Content-Disposition: attachment`，永远同源。
 * ⚠️ 与预览**必须是两个端点** —— 合成一个意味着预览内容可被当成下载执行。
 */
export async function download(actor: Actor, id: string): Promise<{ data: Buffer; originalName: string; mimeType: string }> {
  const rows = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw forbidden();
  await assertTargetVisible(actor, row.targetType, row.targetId);
  return { data: await load(row.storagePath, row.storageBackend as "local" | "s3"), originalName: row.originalName, mimeType: row.mimeType };
}

/** 预览：`Content-Disposition: inline`。只允许白名单内的可预览类型 */
export async function preview(actor: Actor, id: string): Promise<{ data: Buffer; mimeType: string }> {
  const rows = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw forbidden();
  await assertTargetVisible(actor, row.targetType, row.targetId);
  // 白名单外一律不给预览（例如 .zip、.txt 也可能带 HTML）
  const ext = `.${(row.originalName.split(".").pop() ?? "").toLowerCase()}`;
  const previewable = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"];
  if (!previewable.includes(ext)) {
    throw new DomainError("FORBIDDEN", "该类型不支持预览，请下载后查看", null);
  }
  return { data: await load(row.storagePath, row.storageBackend as "local" | "s3"), mimeType: row.mimeType };
}

export async function remove(actor: Actor, id: string): Promise<void> {
  const rows = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw forbidden();
  await assertTargetVisible(actor, row.targetType, row.targetId);
  // 只有上传者能删
  if (row.uploaderId !== actor.memberId) throw forbidden();
  const projectId = await assertTargetVisible(actor, row.targetType, row.targetId);
  // 秒传会让多条附件共享同一 storagePath：只有最后一条引用才删物理对象
  const refs = await db.select({ id: attachment.id }).from(attachment)
    .where(eq(attachment.storagePath, row.storagePath));
  if (refs.every((r) => r.id === id)) {
    const cfg = await loadStorageConfig();
    if (row.storageBackend === "s3" && isS3Configured(cfg)) {
      await s3Client(cfg).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: storageKey(cfg, row.storagePath) })).catch(() => {});
    } else {
      await unlink(join(STORAGE_ROOT, row.storagePath)).catch(() => {});
    }
  }
  await db.delete(attachment).where(eq(attachment.id, id));
  if (projectId) {
    const label = await describeTarget(row.targetType, row.targetId);
    await recordBusinessEvent({
      actor, action: "attachment.deleted", targetType: "ATTACHMENT", targetId: id, projectId,
      summary: `${actor.name} 删除了${label}的附件「${row.originalName}」`,
    });
    const resourceType = ["PAGE", "WORK_ITEM", "COMMENT"].includes(row.targetType) ? row.targetType : null;
    if (resourceType) {
      const event = attachmentCollabEvent("attachment.deleted", {
        attachmentId: id, targetType: row.targetType, targetId: row.targetId, projectId,
        originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes,
      });
      await publishResourceEvent(resourceType, row.targetId, event.event, event.data);
    }
  }
}

export { ALLOWED, MAX_SIZE };
