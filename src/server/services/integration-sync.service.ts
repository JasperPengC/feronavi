/**
 * 集成同步（Round 25 长任务第 38 项）：外部仓库提交 → `dev_activity_daily`
 *
 * 为什么是"提交 → 研发活跃度"：规范对 `dev_activity_daily` 的说明是"`integration` 表落地后由同步任务写入"；
 * 集成表（0030）与游标表（`sync_cursor`）已就位，但一直**没有同步者**。本轮补最小可用实现：
 *   · 支持 GITHUB / GITLAB / GITEE 三种提交列表接口（同一套 SSRF 校验与信封加密令牌）；
 *   · `config.repo` 指定仓库，`config.userMap` 把外部作者映射到平台用户名（映射不到 → 跳过，不猜）；
 *   · 每次同步把游标写回 `sync_cursor(integration_id,'commits')`，下次带 `since` 只取新提交；
 *   · 写入走既有 `upsertDevActivity`（累加语义），**可重复执行**（游标 + provider since）。
 *
 * 支持提交、PR/MR 与 GitHub 评审；定时执行由 integration-sync-scheduler 调度。
 * 每个接口只取一页，评审最多查询20个 PR；不代表完整历史统计。
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { integration, member, syncCursor } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { assertSafeOutboundUrl } from "../lib/url-safety.ts";
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { decryptSecret } from "./crypto.service.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { upsertDevActivity } from "./compliance.service.ts";

export interface SyncDeps { fetchImpl?: typeof fetch }
export const SYNC_ENTITY = "commits";

function assertManage(actor: Actor, projectId: string | null): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "integration:manage", { projectId, teamId: null }, ctx)) throw forbidden();
}

interface CommitRow { externalUser: string | null; date: string; sha: string }

function buildRequest(kind: string, baseUrl: string, repo: string, token: string, since: string | null, fetchImpl: typeof fetch) {
  const base = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  let url: string;
  if (kind === "GITLAB") {
    url = `${base}/api/v4/projects/${encodeURIComponent(repo)}/repository/commits?per_page=100${since ? `&since=${encodeURIComponent(since)}` : ""}`;
    headers["private-token"] = token;
  } else if (kind === "GITEE") {
    url = `${base}/repos/${repo}/commits?per_page=100${since ? `&since=${encodeURIComponent(since)}` : ""}`;
    headers.authorization = `Bearer ${token}`;
  } else {
    url = `${base}/repos/${repo}/commits?per_page=100${since ? `&since=${encodeURIComponent(since)}` : ""}`;
    headers.authorization = `Bearer ${token}`;
  }
  // 出站必须有上限：外部服务卡住不能拖死同步请求
  return { url, init: { headers, signal: AbortSignal.timeout(15_000) } as RequestInit, fetchImpl };
}

function parseCommits(kind: string, json: unknown): CommitRow[] {
  if (!Array.isArray(json)) throw new DomainError("INTERNAL", "外部服务返回格式不符合预期（期望提交数组）", null);
  const rows: CommitRow[] = [];
  for (const item of json as Record<string, unknown>[]) {
    const sha = String(item.sha ?? item.id ?? "");
    if (!sha) continue;
    if (kind === "GITLAB") {
      const user = String(item.author_name ?? item.author_email ?? "");
      const date = String(item.committed_date ?? item.authored_date ?? "");
      const iso = date ? new Date(date).toISOString() : "";
      if (iso) rows.push({ sha, externalUser: user || null, date: iso });
    } else {
      const commit = (item.commit ?? {}) as Record<string, unknown>;
      const author = (commit.author ?? {}) as Record<string, unknown>;
      const login = (item.author as Record<string, unknown> | undefined)?.login;
      const user = String(login ?? author.name ?? author.email ?? "");
      const date = String(author.date ?? "");
      const iso = date ? new Date(date).toISOString() : "";
      if (iso) rows.push({ sha, externalUser: user || null, date: iso });
    }
  }
  return rows;
}

/** PR/MR 列表请求（提交与 PR 分开取：两者游标与字段都不同） */
function buildPullRequest(kind: string, baseUrl: string, repo: string, token: string, since: string | null, fetchImpl: typeof fetch) {
  const base = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  let url: string;
  if (kind === "GITLAB") {
    url = `${base}/api/v4/projects/${encodeURIComponent(repo)}/merge_requests?state=all&per_page=100${since ? `&created_after=${encodeURIComponent(since)}` : ""}`;
    headers["private-token"] = token;
  } else {
    // GitHub/Gitee 的 pulls 列表没有 since 参数：取最近 100 条后按 created_at 本地过滤
    url = `${base}/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`;
    headers.authorization = `Bearer ${token}`;
  }
  return { url, init: { headers, signal: AbortSignal.timeout(15_000) } as RequestInit, fetchImpl };
}

function parsePulls(kind: string, json: unknown): { externalUser: string | null; date: string }[] {
  if (!Array.isArray(json)) throw new DomainError("INTERNAL", "外部服务返回格式不符合预期（期望 PR 数组）", null);
  const rows: { externalUser: string | null; date: string }[] = [];
  for (const item of json as Record<string, unknown>[]) {
    if (kind === "GITLAB") {
      const author = (item.author ?? {}) as Record<string, unknown>;
      const user = String(author.username ?? author.name ?? "");
      const iso = item.created_at ? new Date(String(item.created_at)).toISOString() : "";
      if (iso) rows.push({ externalUser: user || null, date: iso });
    } else {
      const user = (item.user as Record<string, unknown> | undefined)?.login;
      const iso = item.created_at ? new Date(String(item.created_at)).toISOString() : "";
      if (iso) rows.push({ externalUser: String(user ?? "") || null, date: iso });
    }
  }
  return rows;
}

function parsePullNumbers(kind: string, json: unknown): number[] {
  if (!Array.isArray(json)) return [];
  return (json as Record<string, unknown>[])
    .map((p) => Number(kind === "GITLAB" ? p.iid ?? p.number : p.number))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * 评审（reviews）：GitHub 用 `/pulls/{number}/reviews` 逐 PR 拉取（N+1，故**只取最近 20 个 PR** 且
 * 每次同步有上限）；GitLab/Gitee 的评审接口与语义不同，**本轮只做 GitHub**（如实登记，不伪造数据）。
 */
async function fetchGitHubReviews(
  baseUrl: string, repo: string, token: string, prNumbers: number[], since: string | null, fetchImpl: typeof fetch,
): Promise<{ externalUser: string | null; date: string }[]> {
  const base = baseUrl.replace(/\/$/, "");
  const out: { externalUser: string | null; date: string }[] = [];
  for (const number of prNumbers.slice(0, 20)) {
    const url = `${base}/repos/${repo}/pulls/${number}/reviews?per_page=100`;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { accept: "application/json", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    } catch {
      continue;   // 单个 PR 的评审拉取失败不阻断其它
    }
    if (!res.ok) continue;
    const json = await res.json().catch(() => null);
    if (!Array.isArray(json)) continue;
    for (const r of json as Record<string, unknown>[]) {
      const login = (r.user as Record<string, unknown> | undefined)?.login;
      const iso = r.submitted_at ? new Date(String(r.submitted_at)).toISOString() : "";
      if (!iso) continue;
      if (since && iso <= since) continue;
      out.push({ externalUser: String(login ?? "") || null, date: iso });
    }
  }
  return out;
}

/** 跑一次同步（可注入 fetch 供测试；生产路径必须过真实 SSRF 校验） */
export async function syncIntegration(actor: Actor, integrationId: string, deps: SyncDeps = {}) {
  const intg = (await db.select().from(integration).where(eq(integration.id, integrationId)).limit(1))[0];
  if (!intg) throw forbidden();
  if (intg.projectId) {
    if (!(await projectRepo.isVisibleTo(actor.memberId, intg.projectId, actor.grants.some((g) => g.scopeType === "ORG")))) throw forbidden();
  }
  assertManage(actor, intg.projectId);
  if (!intg.isActive) throw new DomainError("CONFLICT", "集成已停用", null);
  return runSync(intg, actor, deps);
}

/** 系统调度入口：无人工 actor（审计 actor 为空、快照=系统同步），跳过权限检查但**仍走同一同步逻辑** */
export async function syncIntegrationInternal(integrationId: string, deps: SyncDeps = {}) {
  const intg = (await db.select().from(integration).where(eq(integration.id, integrationId)).limit(1))[0];
  if (!intg || !intg.isActive) return null;
  const repo = ((intg.config ?? {}) as { repo?: unknown }).repo;
  if (typeof repo !== "string" || !repo.trim()) return null;   // 未配置仓库的集成不参与调度
  return runSync(intg, null, deps);
}

type IntegrationRow = typeof integration.$inferSelect;

async function runSync(intg: IntegrationRow, actor: Actor | null, deps: SyncDeps) {
  const integrationId = intg.id;
  const fetchImpl: typeof fetch = (input, init) => safeOutboundFetch(String(input), init, deps.fetchImpl);
  const cfg = (intg.config ?? {}) as { repo?: unknown; userMap?: unknown };
  const repo = typeof cfg.repo === "string" ? cfg.repo.trim() : "";
  const userMap = (cfg.userMap && typeof cfg.userMap === "object" ? cfg.userMap : {}) as Record<string, string>;
  if (!repo) throw new DomainError("VALIDATION", "集成缺少 config.repo（如 owner/repo）", { field: "config.repo" });
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new DomainError("VALIDATION", "config.repo 格式应为 owner/repo", null);

  const cursorRow = (await db.select().from(syncCursor)
    .where(and(eq(syncCursor.integrationId, integrationId), eq(syncCursor.entity, SYNC_ENTITY))).limit(1))[0];
  const since = cursorRow?.cursor ?? null;
  const token = decryptSecret(intg.tokenEncrypted);
  // 防御纵深：即使创建时校验过，出行前再校验一次（与 webhook 投递前的做法一致）
  await assertSafeOutboundUrl(intg.baseUrl);
  const reqInfo = buildRequest(intg.kind, intg.baseUrl, repo, token, since, fetchImpl);

  let response: Response;
  try {
    response = await reqInfo.fetchImpl(reqInfo.url, reqInfo.init);
  } catch (e) {
    throw new DomainError("INTERNAL", `连接外部服务失败：${(e as Error).message}`, null);
  }
  if (!response.ok) {
    throw new DomainError("INTERNAL", `外部服务返回 ${response.status}（检查 base_url / 令牌 / 仓库 ${repo}）`, { status: response.status });
  }
  const commits = parseCommits(intg.kind, await response.json().catch(() => null));

  // PR / MR：游标按 created_at（GitHub/Gitee 列表无 since → 本地过滤）
  const pullsCursorRow = (await db.select().from(syncCursor)
    .where(and(eq(syncCursor.integrationId, integrationId), eq(syncCursor.entity, "pulls"))).limit(1))[0];
  const pullsSince = pullsCursorRow?.cursor ?? null;
  const prReq = buildPullRequest(intg.kind, intg.baseUrl, repo, token, pullsSince, fetchImpl);
  let pullsResponse: Response;
  try {
    pullsResponse = await prReq.fetchImpl(prReq.url, prReq.init);
  } catch (e) {
    throw new DomainError("INTERNAL", `连接外部服务失败（PR 列表）：${(e as Error).message}`, null);
  }
  if (!pullsResponse.ok) {
    throw new DomainError("INTERNAL", `外部服务返回 ${pullsResponse.status}（PR 列表；检查 base_url / 令牌 / 仓库 ${repo}）`, { status: pullsResponse.status });
  }
  const pullsJson = await pullsResponse.json().catch(() => null);
  const pulls = parsePulls(intg.kind, pullsJson)
    .filter((p) => !pullsSince || p.date > pullsSince);

  // 评审游标（仅 GitHub 实现；其它 provider 返回空集）
  const reviewsCursorRow = (await db.select().from(syncCursor)
    .where(and(eq(syncCursor.integrationId, integrationId), eq(syncCursor.entity, "reviews"))).limit(1))[0];
  const reviewsSince = reviewsCursorRow?.cursor ?? null;
  const reviews = intg.kind === "GITHUB"
    ? await fetchGitHubReviews(intg.baseUrl, repo, token, parsePullNumbers(intg.kind, pullsJson), reviewsSince, fetchImpl)
    : [];

  // 外部用户名 → 平台成员（只认显式映射，不猜名字）
  const mappedUsers = [...new Set([
    ...commits.map((c) => c.externalUser),
    ...pulls.map((p) => p.externalUser),
  ].filter((x): x is string => !!x))]
    .map((u) => ({ external: u, platform: userMap[u] ?? userMap[u.toLowerCase()] }))
    .filter((x) => typeof x.platform === "string");
  const platformNames = [...new Set(mappedUsers.map((x) => x.platform).filter((x): x is string => typeof x === "string"))];
  const memberRows: { id: string; username: string }[] = [];
  for (const username of platformNames) {
    const row = (await db.select({ id: member.id, username: member.username }).from(member)
      .where(eq(member.username, username)).limit(1))[0];
    if (row) memberRows.push(row);
  }
  const memberByName = new Map(memberRows.map((m) => [m.username.toLowerCase(), m.id]));

  const perDay = new Map<string, { memberId: string; date: string; commits: number; prs: number; reviews: number }>();
  let synced = 0;
  let skipped = 0;
  for (const c of commits) {
    const platform = c.externalUser ? userMap[c.externalUser] ?? userMap[c.externalUser.toLowerCase()] : undefined;
    const memberId = platform ? memberByName.get(platform.toLowerCase()) : undefined;
    if (!memberId) { skipped++; continue; }
    const day = c.date.slice(0, 10);
    const key = `${memberId}|${day}`;
    const cur = perDay.get(key) ?? { memberId, date: day, commits: 0, prs: 0, reviews: 0 };
    cur.commits++;
    perDay.set(key, cur);
    synced++;
  }
  let prsSynced = 0;
  let prsSkipped = 0;
  for (const p of pulls) {
    const platform = p.externalUser ? userMap[p.externalUser] ?? userMap[p.externalUser.toLowerCase()] : undefined;
    const memberId = platform ? memberByName.get(platform.toLowerCase()) : undefined;
    if (!memberId) { prsSkipped++; continue; }
    const day = p.date.slice(0, 10);
    const key = `${memberId}|${day}`;
    const cur = perDay.get(key) ?? { memberId, date: day, commits: 0, prs: 0, reviews: 0 };
    cur.prs++;
    perDay.set(key, cur);
    prsSynced++;
  }
  let reviewsSynced = 0;
  let reviewsSkipped = 0;
  for (const r of reviews) {
    const platform = r.externalUser ? userMap[r.externalUser] ?? userMap[r.externalUser.toLowerCase()] : undefined;
    const memberId = platform ? memberByName.get(platform.toLowerCase()) : undefined;
    if (!memberId) { reviewsSkipped++; continue; }
    const day = r.date.slice(0, 10);
    const key = `${memberId}|${day}`;
    const cur = perDay.get(key) ?? { memberId, date: day, commits: 0, prs: 0, reviews: 0 };
    cur.reviews++;
    perDay.set(key, cur);
    reviewsSynced++;
  }
  for (const group of perDay.values()) {
    await upsertDevActivity(group.memberId, group.date, { commits: group.commits, prs: group.prs, reviews: group.reviews });
  }

  const latest = commits.reduce((max, c) => (c.date > max ? c.date : max), since ?? "");
  const newCursor = latest || since || new Date().toISOString();
  const [cursorSaved] = await db.insert(syncCursor).values({
    integrationId, entity: SYNC_ENTITY, cursor: newCursor, lastSyncedAt: new Date(),
  }).onConflictDoUpdate({
    target: [syncCursor.integrationId, syncCursor.entity],
    set: { cursor: newCursor, lastSyncedAt: new Date() },
  }).returning();
  const latestReview = reviews.reduce((max, r) => (r.date > max ? r.date : max), reviewsSince ?? "");
  if (latestReview) {
    await db.insert(syncCursor).values({
      integrationId, entity: "reviews", cursor: latestReview, lastSyncedAt: new Date(),
    }).onConflictDoUpdate({
      target: [syncCursor.integrationId, syncCursor.entity],
      set: { cursor: latestReview, lastSyncedAt: new Date() },
    });
  }
  const latestPull = pulls.reduce((max, p) => (p.date > max ? p.date : max), pullsSince ?? "");
  if (latestPull) {
    await db.insert(syncCursor).values({
      integrationId, entity: "pulls", cursor: latestPull, lastSyncedAt: new Date(),
    }).onConflictDoUpdate({
      target: [syncCursor.integrationId, syncCursor.entity],
      set: { cursor: latestPull, lastSyncedAt: new Date() },
    });
  }

  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: actor?.memberId ?? null, actorSnapshot: actor?.username ?? "系统同步",
      action: "integration.synced", targetType: "INTEGRATION", targetId: integrationId,
    });
    if (intg.projectId) {
      const { writeActivity } = await import("./audit.service.ts");
      await writeActivity({
        projectId: intg.projectId, actorId: actor?.memberId ?? null, targetType: "INTEGRATION", targetId: integrationId,
        action: "integration.synced",
        summary: `${actor?.name ?? "系统"}同步了集成「${intg.name}」：${synced} 条提交（跳过 ${skipped} 条）`,
      });
    }
  }
  return {
    integrationId, repo, fetched: commits.length, synced, skipped,
    pulls: { fetched: pulls.length, synced: prsSynced, skipped: prsSkipped },
    reviews: { fetched: reviews.length, synced: reviewsSynced, skipped: reviewsSkipped },
    members: new Set([...perDay.values()].map((g) => g.memberId)).size,
    cursor: cursorSaved?.cursor ?? newCursor,
    pullCursor: latestPull || pullsSince,
  };
}

/** 读取当前游标（运维/界面展示用） */
export async function getSyncCursor(actor: Actor, integrationId: string) {
  const intg = (await db.select({ projectId: integration.projectId }).from(integration).where(eq(integration.id, integrationId)).limit(1))[0];
  if (!intg) throw forbidden();
  if (intg.projectId && !(await projectRepo.isVisibleTo(actor.memberId, intg.projectId, actor.grants.some((g) => g.scopeType === "ORG")))) throw forbidden();
  assertManage(actor, intg.projectId);
  return (await db.select().from(syncCursor)
    .where(and(eq(syncCursor.integrationId, integrationId), eq(syncCursor.entity, SYNC_ENTITY))).limit(1))[0] ?? null;
}
