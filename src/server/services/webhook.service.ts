/**
 * Webhook 出站（第十一期，规范 7.5 + REST 8.3）
 *
 * 四条纪律：
 *   1 URL 必须过**统一** SSRF 模块（url-safety.ts）—— 创建时校验，**每次投递前再校验一次**
 *      （域名可能被改成内网）
 *   2 签名密钥走**信封加密**（与 SMTP 密码同一套），库里不存明文
 *   3 投递失败进**死信队列**（`webhook_delivery` 承载，规范 4.6），重试有上限与退避
 *   4 出站请求不阻塞业务：`deliver()` 只入队 + 尽力投一次，失败留给重试/人工重放
 */
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { createHmac, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { webhookDelivery, webhookEndpoint } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { assertSafeOutboundUrl } from "../lib/url-safety.ts";
import { decryptSecret, encryptSecret } from "./crypto.service.ts";

export const MAX_ATTEMPTS = 5;
/** 退避（分钟）：1 / 5 / 30 / 120 / 720 */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
export const WEBHOOK_EVENTS = [
  "work_item.created", "work_item.updated", "work_item.transitioned", "work_item.deleted",
  "comment.created", "idea.created", "idea.promoted", "milestone.created", "intake.submitted",
] as const;

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
function assertManage(actor: Actor, projectId: string | null) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "integration:manage", { projectId, teamId: null }, ctx)) throw forbidden();
}
async function assertProjectVisible(actor: Actor, projectId: string | null) {
  if (!projectId) return;
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}

export async function createEndpoint(actor: Actor, input: {
  name: string; url: string; events: string[]; projectId?: string | null;
}) {
  if (input.projectId) await assertProjectVisible(actor, input.projectId);
  assertManage(actor, input.projectId ?? null);
  // 统一 SSRF 校验（不传 skipDns：生产路径必须真的解析域名）
  await assertSafeOutboundUrl(input.url);

  const bad = input.events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (bad.length) throw new DomainError("VALIDATION", `不支持的事件：${bad.join(", ")}`, { events: bad });
  if (input.events.length === 0) throw new DomainError("VALIDATION", "至少订阅一个事件", null);

  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(webhookEndpoint).values({
    projectId: input.projectId ?? null, name: input.name, url: input.url,
    secretEncrypted: encryptSecret(secret), events: input.events as object,
  }).returning();
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "webhook.created", targetType: "WEBHOOK_ENDPOINT", targetId: row!.id,
    });
  }
  // 明文密钥只在创建时返回一次（与令牌、SMTP 密码同一纪律）
  return { endpoint: { ...row!, secretEncrypted: undefined }, secret };
}

export async function listEndpoints(actor: Actor, projectId?: string | null) {
  if (projectId) await assertProjectVisible(actor, projectId);
  assertManage(actor, projectId ?? null);
  const rows = projectId
    ? await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.projectId, projectId)).orderBy(asc(webhookEndpoint.createdAt))
    : await db.select().from(webhookEndpoint).orderBy(asc(webhookEndpoint.createdAt));
  return rows.map(({ secretEncrypted: _s, ...rest }) => rest);   // 密钥永不出现在响应里
}

export async function updateEndpoint(actor: Actor, id: string, patch: { name?: string; url?: string; events?: string[]; isActive?: boolean }) {
  const e = (await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, id)).limit(1))[0];
  if (!e) throw forbidden();
  await assertProjectVisible(actor, e.projectId);
  assertManage(actor, e.projectId);
  if (patch.url && patch.url !== e.url) await assertSafeOutboundUrl(patch.url);
  if (patch.events) {
    const bad = patch.events.filter((x) => !(WEBHOOK_EVENTS as readonly string[]).includes(x));
    if (bad.length) throw new DomainError("VALIDATION", `不支持的事件：${bad.join(", ")}`, { events: bad });
  }
  const [row] = await db.update(webhookEndpoint).set(patch).where(eq(webhookEndpoint.id, id)).returning();
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "webhook.updated", targetType: "WEBHOOK_ENDPOINT", targetId: id,
    });
  }
  return { ...row!, secretEncrypted: undefined };
}

export async function deleteEndpoint(actor: Actor, id: string): Promise<void> {
  const e = (await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, id)).limit(1))[0];
  if (!e) throw forbidden();
  await assertProjectVisible(actor, e.projectId);
  assertManage(actor, e.projectId);
  await db.delete(webhookEndpoint).where(eq(webhookEndpoint.id, id));
  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor.memberId, actorSnapshot: actor.username,
      action: "webhook.deleted", targetType: "WEBHOOK_ENDPOINT", targetId: id,
    });
  }
}

/** HMAC-SHA256 签名：`sha256=<hex>`，签名内容 = `timestamp.body`（防重放） */
export function signPayload(secret: string, body: string, timestamp: number): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export interface DeliveryDeps {
  /** 可注入的 fetch（测试用假接收端，避免生产防护被测试需求削弱） */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 尽力投递一次；无论成败都写投递记录（失败进死信队列待重试/人工重放） */
export async function attemptDelivery(deliveryId: string, deps: DeliveryDeps = {}) {
  const d = (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, deliveryId)).limit(1))[0];
  if (!d) throw forbidden();
  const e = (await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, d.endpointId)).limit(1))[0];
  if (!e) throw forbidden();
  if (!e.isActive) {
    await db.update(webhookDelivery).set({ status: "DEAD", error: "端点已停用", finishedAt: new Date() }).where(eq(webhookDelivery.id, deliveryId));
    return { ok: false, reason: "端点已停用" };
  }

  const attempts = d.attempts + 1;
  const ts = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const body = JSON.stringify({ event: d.event, deliveryId: d.id, data: d.payload });
  const fetchImpl: typeof fetch = (input, init) => safeOutboundFetch(String(input), init, deps.fetchImpl);

  try {
    // 每次投递前**重新校验** URL：域名可能在这期间被改成内网地址
    await assertSafeOutboundUrl(e.url);
    const res = await fetchImpl(e.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-feronavi-event": d.event,
        "x-feronavi-delivery": d.id,
        "x-feronavi-timestamp": String(ts),
        "x-feronavi-signature": signPayload(decryptSecret(e.secretEncrypted), body, ts),
      },
      body,
    });
    if (res.ok) {
      await db.update(webhookDelivery).set({ status: "SUCCEEDED", attempts, responseCode: res.status, finishedAt: new Date(), nextRetryAt: null })
        .where(eq(webhookDelivery.id, deliveryId));
      return { ok: true, attempts, status: res.status };
    }
    return finalizeFailure(deliveryId, attempts, res.status, `HTTP ${res.status}`);
  } catch (err) {
    return finalizeFailure(deliveryId, attempts, null, (err as Error).message);
  }
}

async function finalizeFailure(deliveryId: string, attempts: number, code: number | null, error: string) {
  const dead = attempts >= MAX_ATTEMPTS;
  const nextRetryAt = dead ? null : new Date(Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 720) * 60_000);
  await db.update(webhookDelivery)
    .set({ status: dead ? "DEAD" : "RETRYING", attempts, responseCode: code, error, nextRetryAt, finishedAt: dead ? new Date() : null })
    .where(eq(webhookDelivery.id, deliveryId));
  return { ok: false, attempts, dead, error };
}

/** 触发事件：给订阅了该事件的活跃端点各建一条投递记录，并尽力投一次 */
export async function deliver(event: string, payload: Record<string, unknown>, projectId: string | null, deps: DeliveryDeps = {}) {
  const endpoints = await db.select().from(webhookEndpoint).where(and(
    eq(webhookEndpoint.isActive, true),
    projectId === null
      ? sql`${webhookEndpoint.projectId} is null`
      : or(sql`${webhookEndpoint.projectId} is null`, eq(webhookEndpoint.projectId, projectId)),
  ));
  const subs = endpoints.filter((e) => ((e.events ?? []) as string[]).includes(event));
  const results = [];
  for (const e of subs) {
    const [row] = await db.insert(webhookDelivery).values({ endpointId: e.id, event, payload: payload as object, status: "PENDING" }).returning();
    results.push(await attemptDelivery(row!.id, deps));
  }
  return { event, endpoints: subs.length, results };
}

export async function listDeliveries(actor: Actor, endpointId: string, opts: { status?: string } = {}) {
  const e = (await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, endpointId)).limit(1))[0];
  if (!e) throw forbidden();
  await assertProjectVisible(actor, e.projectId);
  assertManage(actor, e.projectId);
  const conds = [eq(webhookDelivery.endpointId, endpointId)];
  if (opts.status) conds.push(eq(webhookDelivery.status, opts.status));
  return db.select().from(webhookDelivery).where(and(...conds)).orderBy(desc(webhookDelivery.createdAt)).limit(100);
}

/** 手动重放（规范：死信队列的**唯一人工出口**） */
export async function replayDelivery(actor: Actor, deliveryId: string, deps: DeliveryDeps = {}) {
  const d = (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, deliveryId)).limit(1))[0];
  if (!d) throw forbidden();
  const e = (await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, d.endpointId)).limit(1))[0];
  if (!e) throw forbidden();
  await assertProjectVisible(actor, e.projectId);
  assertManage(actor, e.projectId);
  // 重放重置尝试计数（人工出口不受退避限制），但仍受最大尝试数约束于本次执行
  await db.update(webhookDelivery).set({ status: "PENDING", nextRetryAt: null }).where(eq(webhookDelivery.id, deliveryId));
  return attemptDelivery(deliveryId, deps);
}

/** 扫描到期的重试（供 worker 调用；本期无 worker，故暴露给测试与将来的定时任务） */
export async function retryDue(limit = 50, deps: DeliveryDeps = {}) {
  const due = await db.select().from(webhookDelivery)
    .where(and(eq(webhookDelivery.status, "RETRYING"), lte(webhookDelivery.nextRetryAt, new Date())))
    .orderBy(asc(webhookDelivery.nextRetryAt)).limit(limit);
  const out = [];
  for (const d of due) out.push({ id: d.id, ...(await attemptDelivery(d.id, deps)) });
  return out;
}

void inArray;
