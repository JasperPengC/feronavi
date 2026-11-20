/**
 * 成员生命周期路由（R3）—— 薄层：只解析入参、调服务、序列化
 *
 * 权限：全部要求 `member:manage`（禁用/启用/删除）或 `member:invite`（邀请）。
 * ⚠️ 判定在服务层用 assertCan，路由里不判（第 5.2 节纪律 1）。
 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import { createMemberSchema } from "../../shared/schemas/member.ts";
import { manageMemberLifecycle, listMembers } from "../services/member.service.ts";
import {
  findMemberByUserOrEmail, issueResetToken, changeOwnPassword,
  resetPasswordWithToken,
} from "../services/password-reset.service.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const resetLinkBody = z.object({ memberId: z.string().uuid() });
const changePwBody = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12) });
const useTokenBody = z.object({ token: z.string().min(10), newPassword: z.string().min(12) });

export async function registerMemberRoutes(app: FastifyInstance): Promise<void> {
  // 成员目录（第 47 轮）：组织级成员 + **真实负荷**（按分配的工作项数聚合，不画假刻度）
  app.get("/api/v1/members", async (req) => {
    actorOf(req);                       // 仅要求已认证；成员目录属组织级公开信息
    const q = req.query as { departmentId?: string };
    const departmentId = q.departmentId && /^[0-9a-f-]{36}$/i.test(q.departmentId) ? q.departmentId : undefined;
    return listMembers({ departmentId });
  });
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const needPerm = (req: { actor?: Actor }, perm: string): Actor => {
    const a = actorOf(req);
    const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: a.memberId };
    // 成员管理/邀请是组织级动作：必须由**ORG 档**授权持有，部门 ADMIN 不能靠角色并集越权
    if (!can(a, perm, { projectId: null, teamId: null }, ctx)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    return a;
  };

  // ── 改密（完成第 3 步遗留）────────────────────────────────
  app.post("/api/v1/auth/password/change", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const parsed = changePwBody.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    await changeOwnPassword(actor.memberId, parsed.data.currentPassword, parsed.data.newPassword);
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, actorSnapshot: actor.username,
        action: "auth.password_changed", targetType: "MEMBER", targetId: actor.memberId, ip: req.ip,
      });
    }
    return { ok: true };
  });

  // 用一次性令牌重置（公开端点 —— 用户还没登录就要用它）
  app.post("/api/v1/auth/password/reset", async (req) => {
    const parsed = useTokenBody.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    await resetPasswordWithToken(parsed.data.token, parsed.data.newPassword);
    return { ok: true };
  });

  // ── 管理员生成一次性重置链接（主路径，界面上直接展示）──────
  app.post("/api/v1/members/:id/reset-link", { onRequest: app.csrfProtection }, async (req) => {
    const actor = needPerm(req, "member:manage");
    const { id } = req.params as { id: string };
    const { token, expiresAt } = await issueResetToken({ memberId: id, issuedByMemberId: actor.memberId });
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, action: "member.reset_link_issued", targetType: "MEMBER", targetId: id, ip: req.ip,
      });
    }
    // ⚠️ 明文令牌只在此处返回一次，绝不写日志（审计也不记录 token）
    return { token, expiresAt, url: `/reset-password?token=${token}` };
  });

  // ── 禁用 / 启用 ───────────────────────────────────────────
  app.post("/api/v1/members/:id/disable", { onRequest: app.csrfProtection }, async (req) => {
    const actor = needPerm(req, "member:manage");
    const { id } = req.params as { id: string };
    return manageMemberLifecycle(actor, id, "disabled", req.ip);
  });

  app.post("/api/v1/members/:id/enable", { onRequest: app.csrfProtection }, async (req) => {
    const actor = needPerm(req, "member:manage");
    const { id } = req.params as { id: string };
    return manageMemberLifecycle(actor, id, "enabled", req.ip);
  });

  // ── 创建成员 / 邀请（REST 第 3 节；member:invite）────────
  app.get("/api/v1/members/:id", async (req) => {
    actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return (await import("../services/invite.service.ts")).getMemberDetail(id);
  });

  app.get("/api/v1/members/:id/permissions", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return (await import("../services/invite.service.ts")).memberPermissions(actor, id);
  });

  app.post("/api/v1/members", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = needPerm(req, "member:invite");
    const parsed = createMemberSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return (await import("../services/invite.service.ts")).createMember(actor, parsed.data);
  });

  app.get("/api/v1/invites", async (req) => {
    const actor = needPerm(req, "member:invite");
    return { invites: await (await import("../services/invite.service.ts")).listInvites(actor) };
  });

  app.post("/api/v1/invites", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = needPerm(req, "member:invite");
    const parsed = z.object({
      email: z.string().email().max(200),
      projectId: z.string().uuid().nullable().optional(),
      projectRoleIds: z.array(z.string().uuid()).max(10).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
    const host = (req.headers.host as string) ?? "localhost:3000";
    return (await import("../services/invite.service.ts")).createInvite(actor, { ...parsed.data, origin: `${proto}://${host}` });
  });

  app.delete("/api/v1/invites/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = needPerm(req, "member:invite");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await (await import("../services/invite.service.ts")).revokeInvite(actor, id);
    return { ok: true };
  });

  /** 公开：邀请令牌校验（注册页用；不泄露邮箱） */
  app.get("/api/v1/invites/:token", async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.params);
    const r = await (await import("../services/invite.service.ts")).checkInvite(token);
    return r;
  });

  /** 公开：接受邀请 */
  app.post("/api/v1/invites/:token/accept", async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.params);
    const parsed = z.object({
      username: z.string().min(3).max(32), name: z.string().min(1).max(100), password: z.string().min(12).max(200),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return (await import("../services/invite.service.ts")).acceptInvite(token, parsed.data);
  });

  // ── 删除 = 匿名化 ─────────────────────────────────────────
  app.delete("/api/v1/members/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = needPerm(req, "member:manage");
    const { id } = req.params as { id: string };
    return manageMemberLifecycle(actor, id, "anonymized", req.ip);
  });

  void resetLinkBody;
  void findMemberByUserOrEmail;
}
