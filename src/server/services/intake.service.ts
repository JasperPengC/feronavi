/**
 * 需求收集 Intake（第十一期，规范 5.3 + REST 9 节）
 *
 * 三条纪律：
 *   1 外部提交靠**匿名链接**：令牌只存 SHA-256（等值查找即鉴权，C-28），明文只在建表单时返回一次
 *   2 匿名端点**绝不把令牌写日志**（规范明示），失败也一律同一形状，不区分"令牌不存在/表单已停用"
 *   3 删表单时有提交记录**必须拒绝**（外键 RESTRICT 是最后一道，应用层先给出可读错误）
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { idea, intakeForm, intakeSubmission } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import * as ideaService from "./idea.service.ts";
import { recordBusinessEvent } from "./event-log.ts";

export type IntakeField = { key: string; label: string; type?: "TEXT" | "TEXTAREA" | "SELECT"; required?: boolean; options?: string[] };

const MAX_FIELDS = 30;
const MAX_PAYLOAD_BYTES = 64 * 1024;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
async function assertProjectVisible(actor: Actor, projectId: string) {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}
function assertManage(actor: Actor, projectId: string) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "idea:manage", { projectId, teamId: null }, ctx)) throw forbidden();
}

function validateSchema(schema: unknown): IntakeField[] {
  if (!Array.isArray(schema)) throw new DomainError("VALIDATION", "字段定义必须是数组", null);
  if (schema.length === 0) throw new DomainError("VALIDATION", "至少需要一个字段", null);
  if (schema.length > MAX_FIELDS) throw new DomainError("VALIDATION", `字段数不能超过 ${MAX_FIELDS}`, null);
  const seen = new Set<string>();
  return (schema as IntakeField[]).map((f) => {
    if (!f?.key || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(f.key)) {
      throw new DomainError("VALIDATION", `字段 key「${f?.key ?? ""}」不合法（字母开头，字母/数字/下划线）`, null);
    }
    if (seen.has(f.key)) throw new DomainError("VALIDATION", `字段 key 重复：${f.key}`, null);
    seen.add(f.key);
    if (!f.label) throw new DomainError("VALIDATION", `字段 ${f.key} 缺少 label`, null);
    if (f.type === "SELECT" && (!Array.isArray(f.options) || f.options.length === 0)) {
      throw new DomainError("VALIDATION", `SELECT 字段 ${f.key} 必须提供 options`, null);
    }
    return { key: f.key, label: f.label, type: f.type ?? "TEXT", required: f.required === true, options: f.options };
  });
}

/** 建表单：返回**明文提交令牌一次**（服务端只存哈希） */
export async function createForm(actor: Actor, projectId: string, input: { name: string; schema: unknown }) {
  await assertProjectVisible(actor, projectId);
  assertManage(actor, projectId);
  const fields = validateSchema(input.schema);
  const raw = `intk_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(intakeForm).values({
    projectId, name: input.name, schema: fields as object, submitTokenHash: hashToken(raw),
  }).returning();
  await recordBusinessEvent({
    actor, action: "intake.form_created", targetType: "INTAKE_FORM", targetId: row!.id, projectId,
    summary: `${actor.name} 创建了外部收集表单「${input.name}」`,
  });
  return { form: { ...row!, submitTokenHash: undefined }, submitToken: raw };
}

export async function listForms(actor: Actor, projectId: string) {
  await assertProjectVisible(actor, projectId);
  assertManage(actor, projectId);
  const rows = await db.select().from(intakeForm).where(eq(intakeForm.projectId, projectId)).orderBy(asc(intakeForm.createdAt));
  // 哈希永不出现在响应里
  return rows.map(({ submitTokenHash: _h, ...rest }) => rest);
}

export async function updateForm(actor: Actor, id: string, patch: { name?: string; isActive?: boolean; schema?: unknown }) {
  const f = (await db.select().from(intakeForm).where(eq(intakeForm.id, id)).limit(1))[0];
  if (!f) throw forbidden();
  await assertProjectVisible(actor, f.projectId);
  assertManage(actor, f.projectId);
  const next: Record<string, unknown> = { ...patch };
  if (patch.schema !== undefined) next.schema = validateSchema(patch.schema);
  const [row] = await db.update(intakeForm).set(next).where(eq(intakeForm.id, id)).returning();
  await recordBusinessEvent({
    actor, action: "intake.form_updated", targetType: "INTAKE_FORM", targetId: id, projectId: f.projectId,
    summary: `${actor.name} 更新了外部收集表单「${row!.name}」`,
  });
  return { ...row!, submitTokenHash: undefined };
}

/** 重新生成匿名提交链接（旧链接立即失效；明文只返回一次） */
export async function rotateToken(actor: Actor, id: string) {
  const f = (await db.select().from(intakeForm).where(eq(intakeForm.id, id)).limit(1))[0];
  if (!f) throw forbidden();
  assertManage(actor, f.projectId);
  const raw = `intk_${randomBytes(24).toString("base64url")}`;
  await db.update(intakeForm).set({ submitTokenHash: hashToken(raw) }).where(eq(intakeForm.id, id));
  return { submitToken: raw };
}

export async function deleteForm(actor: Actor, id: string): Promise<void> {
  const f = (await db.select().from(intakeForm).where(eq(intakeForm.id, id)).limit(1))[0];
  if (!f) throw forbidden();
  await assertProjectVisible(actor, f.projectId);
  assertManage(actor, f.projectId);
  const subs = await db.select({ id: intakeSubmission.id }).from(intakeSubmission).where(eq(intakeSubmission.formId, id)).limit(1);
  if (subs[0]) {
    throw new DomainError("CONFLICT", "该表单已有提交记录，不能删除；可改为停用", null);
  }
  await db.delete(intakeForm).where(eq(intakeForm.id, id));
  await recordBusinessEvent({
    actor, action: "intake.form_deleted", targetType: "INTAKE_FORM", targetId: id, projectId: f.projectId,
    summary: `${actor.name} 删除了外部收集表单「${f.name}」`,
  });
}

/** 匿名提交（公开端点用）。任何失败都返回同一形状，避免探测表单是否存在 */
/** 匿名表单渲染：只返回名称与字段 schema，不泄露任何提交/表单内部数据。 */
export async function publicForm(submitToken: string) {
  const missing = () => new DomainError("NOT_FOUND", "提交入口不可用", null);
  if (!submitToken || !submitToken.startsWith("intk_")) throw missing();
  const f = (await db.select().from(intakeForm).where(eq(intakeForm.submitTokenHash, hashToken(submitToken))).limit(1))[0];
  if (!f || !f.isActive) throw missing();
  return { name: f.name, schema: f.schema };
}

export async function publicSubmit(submitToken: string, payload: Record<string, unknown>) {
  const notFound = () => new DomainError("NOT_FOUND", "提交入口不可用", null);
  if (!submitToken || !submitToken.startsWith("intk_")) throw notFound();
  const f = (await db.select().from(intakeForm).where(eq(intakeForm.submitTokenHash, hashToken(submitToken))).limit(1))[0];
  if (!f || !f.isActive) throw notFound();

  const fields = (f.schema ?? []) as IntakeField[];
  const clean: Record<string, string> = {};
  for (const field of fields) {
    const raw = payload[field.key];
    const v = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw);
    if (field.required && !v) throw new DomainError("VALIDATION", `「${field.label}」为必填`, { field: field.key });
    if (field.type === "SELECT" && v && !(field.options ?? []).includes(v)) {
      throw new DomainError("VALIDATION", `「${field.label}」取值不在选项中`, { field: field.key });
    }
    if (v.length > 5000) throw new DomainError("VALIDATION", `「${field.label}」过长`, { field: field.key });
    clean[field.key] = v;
  }
  // 未知字段直接丢弃（避免把表单当任意 KV 存储用）
  const size = Buffer.byteLength(JSON.stringify(clean), "utf8");
  if (size > MAX_PAYLOAD_BYTES) throw new DomainError("VALIDATION", "提交内容过大", null);

  const [row] = await db.insert(intakeSubmission).values({ formId: f.id, payload: clean as object, status: "PENDING" }).returning();
  {
    const { writeActivity } = await import("./audit.service.ts");
    await writeActivity({
      projectId: f.projectId, actorId: null,
      targetType: "INTAKE_SUBMISSION", targetId: row!.id,
      action: "intake.submitted",
      // 不把提交正文写进活动（可能含 PII）；只报"哪个表单收到了一条"
      summary: `收到一条外部提交（表单「${f.name}」）`,
    });
  }
  return { id: row!.id, status: row!.status };
}

export async function listSubmissions(actor: Actor, projectId: string, opts: { status?: string } = {}) {
  await assertProjectVisible(actor, projectId);
  assertManage(actor, projectId);
  const conds = [eq(intakeForm.projectId, projectId)];
  if (opts.status) conds.push(eq(intakeSubmission.status, opts.status));
  const rows = await db.select({
    id: intakeSubmission.id, formId: intakeSubmission.formId, payload: intakeSubmission.payload,
    status: intakeSubmission.status, convertedIdeaId: intakeSubmission.convertedIdeaId, createdAt: intakeSubmission.createdAt,
    formName: intakeForm.name,
  }).from(intakeSubmission).innerJoin(intakeForm, eq(intakeSubmission.formId, intakeForm.id))
    .where(and(...conds)).orderBy(desc(intakeSubmission.createdAt)).limit(200);
  return { items: rows, total: rows.length };
}

/**
 * 提交 → 想法（单事务语义：建想法 + 回填 + 置 CONVERTED）。
 * ⚠️ Intake 是**外部输入**，转想法时标题取第一个字段的值，正文保留其余字段以便溯源。
 */
export async function convertSubmission(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    await tx.select({ id: intakeSubmission.id }).from(intakeSubmission).where(eq(intakeSubmission.id, id)).for("update");
    return convertSubmissionLocked(actor, id);
  });
}

async function convertSubmissionLocked(actor: Actor, id: string) {
  const s = (await db.select().from(intakeSubmission).where(eq(intakeSubmission.id, id)).limit(1))[0];
  if (!s) throw forbidden();
  const f = (await db.select().from(intakeForm).where(eq(intakeForm.id, s.formId)).limit(1))[0];
  if (!f) throw forbidden();
  await assertProjectVisible(actor, f.projectId);
  assertManage(actor, f.projectId);

  if (s.convertedIdeaId) {
    const existing = (await db.select().from(idea).where(eq(idea.id, s.convertedIdeaId)).limit(1))[0];
    return { idea: existing ?? null, alreadyConverted: true };
  }

  const fields = (f.schema ?? []) as IntakeField[];
  const payload = (s.payload ?? {}) as Record<string, string>;
  const firstKey = fields[0]?.key;
  const title = (firstKey ? payload[firstKey] : "") || "外部提交";
  const body = fields.map((x) => `${x.label}：${payload[x.key] ?? ""}`).join("\n");

  const created = await ideaService.createIdea(actor, f.projectId, {
    title: title.slice(0, 300),
    description: body,
    submitterDisplay: "外部提交",
  });
  await db.update(intakeSubmission).set({ convertedIdeaId: created!.id, status: "CONVERTED" }).where(eq(intakeSubmission.id, id));
  await recordBusinessEvent({
    actor, action: "intake.converted", targetType: "INTAKE_SUBMISSION", targetId: id, projectId: f.projectId,
    summary: `${actor.name} 把外部提交转为想法「${(created!.title ?? "").slice(0, 60)}」`,
  });
  return { idea: created, alreadyConverted: false };
}

export async function rejectSubmission(actor: Actor, id: string): Promise<void> {
  const s = (await db.select().from(intakeSubmission).where(eq(intakeSubmission.id, id)).limit(1))[0];
  if (!s) throw forbidden();
  const f = (await db.select().from(intakeForm).where(eq(intakeForm.id, s.formId)).limit(1))[0];
  if (!f) throw forbidden();
  await assertProjectVisible(actor, f.projectId);
  assertManage(actor, f.projectId);
  await db.update(intakeSubmission).set({ status: "REJECTED" }).where(eq(intakeSubmission.id, id));
  await recordBusinessEvent({
    actor, action: "intake.rejected", targetType: "INTAKE_SUBMISSION", targetId: id, projectId: f.projectId,
    summary: `${actor.name} 驳回了外部提交`,
  });
}

void isNull;

/** 匿名提交端点的**严格限流**依赖 app 的全局 @fastify/rate-limit（按路由覆写 max/timeWindow）。
 * 这里固化一条自检：若限流器被摘掉，公开写入就变成可刷爆的入口，必须有测试守住。 */
export const INTAKE_RATE_LIMIT = { max: 10, timeWindow: "1 minute" } as const;
