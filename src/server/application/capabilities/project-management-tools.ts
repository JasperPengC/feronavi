/** 项目管理 MCP 参数映射；业务写入、可见性和权限复用 REST 领域服务。 */
import type { ToolCtx, ToolDef } from "./tools.ts";
import { DomainError } from "../../../shared/errors.ts";
import { createProjectSchema } from "../../../shared/schemas/project.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import { projectAllowed } from "../../services/token.service.ts";
import * as projects from "../../services/project.service.ts";
import * as members from "../../services/project-member.service.ts";
import * as directory from "../../services/member.service.ts";
import * as plans from "../../services/planning.service.ts";
import * as progress from "../../services/milestone-detail.service.ts";

type Schema = Record<string, unknown>;
const UUID = { type: "string", format: "uuid" };
const text = { type: "string" };
const nullableText = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const bool = { type: "boolean" };
const array = (items: Schema) => ({ type: "array", items });
const shape = (properties: Record<string, Schema>) => ({ type: "object" as const, properties, required: Object.keys(properties), additionalProperties: false });
const input = (properties: Record<string, Schema>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const confirmation = { userConfirmed: bool };
const scoped = { projectId: UUID };
const scopedWrite = { ...scoped, ...confirmation };
const success = shape({ ok: bool });
const status = shape({ key: text, name: text, category: text, color: text });
const memberResult = shape({ ok: bool, memberId: UUID, roleId: UUID, roleIds: array(UUID), roleName: text });
const capacityMember = shape({ memberId: UUID, name: text, username: text, capacityPoints: nullableNumber, capacityHours: nullableNumber, loggedPoints: { type: "number" } });
const progressFields = { summary: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" }, nextSteps: { ...nullableText, maxLength: 5000 }, blockers: { ...nullableText, maxLength: 5000 } };
const progressView = shape({ id: UUID, summary: text, nextSteps: nullableText, blockers: nullableText, createdAt: text, authorName: nullableText });
const roleIds = { type: "array", items: UUID, minItems: 1, maxItems: 20, uniqueItems: true };

function accountScope(ctx: ToolCtx) {
  if (!projectAllowed(ctx.token, null)) throw new DomainError("FORBIDDEN", "此工具需要未限制项目的令牌", null);
}
async function planInProject(ctx: ToolCtx, args: Record<string, unknown>, kind: "iteration" | "milestone") {
  const plan = await plans.get(ctx.actor, args[`${kind}Id`] as string, kind);
  if (plan.projectId !== args.projectId) throw new DomainError("NOT_FOUND", "资源不存在", null);
  return plan;
}

// 由中央目录统一 guard；此处保持原始定义，防止重复包装。
export const PROJECT_MANAGEMENT_TOOLS: ToolDef[] = [
  {
    name: "project.create", kind: "write", description: "创建项目并复制内置工作流。需要组织级创建权限、未限制项目的令牌及 userConfirmed=true。",
    inputSchema: input({ key: { type: "string", minLength: 2, maxLength: 10, pattern: "^[A-Z][A-Z0-9]*$" }, name: { type: "string", minLength: 1, maxLength: 200 }, description: { ...nullableText, maxLength: 5000 }, template: { type: "string", maxLength: 40 }, departmentId: { type: ["string", "null"], format: "uuid" }, ...confirmation }, ["key", "name", "userConfirmed"]),
    outputSchema: shape({ id: UUID, key: text }),
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      accountScope(ctx);
      const { userConfirmed: _confirmed, ...raw } = args;
      const parsed = createProjectSchema.safeParse(raw);
      if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
      return projects.createProject(ctx.actor, parsed.data);
    },
  },
  {
    name: "project.update", kind: "write", description: "更新项目名称、说明、负责人或部门；项目标识创建后不可改。需要 userConfirmed=true。",
    inputSchema: input({ ...scopedWrite, name: { type: "string", minLength: 1, maxLength: 200 }, description: { ...nullableText, maxLength: 5000 }, leadMemberId: { type: ["string", "null"], format: "uuid" }, departmentId: { type: ["string", "null"], format: "uuid" } }, ["projectId", "userConfirmed"]),
    outputSchema: shape({ id: UUID, name: text, description: nullableText, leadMemberId: { type: ["string", "null"] }, departmentId: { type: ["string", "null"] } }),
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      const { projectId, userConfirmed: _confirmed, ...patch } = args;
      const row = await projects.updateProject(ctx.actor, projectId as string, patch);
      return { id: row.id, name: row.name, description: row.description, leadMemberId: row.leadMemberId, departmentId: row.departmentId };
    },
  },
  {
    name: "project.setStatus", kind: "write", description: "按项目状态规则流转项目。状态键从 project.get.statusDefs 发现，需要 userConfirmed=true。",
    inputSchema: input({ ...scopedWrite, statusKey: { type: "string", minLength: 1, maxLength: 40 } }), outputSchema: shape({ id: UUID, status }),
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      return projects.transitionProjectStatus(ctx.actor, args.projectId as string, { statusKey: args.statusKey });
    },
  },
  {
    name: "member.list", kind: "read", description: "发现组织成员的ID、用户名、姓名与状态，供项目添加成员。仅未限制项目的令牌可调用。",
    inputSchema: input({ departmentId: UUID }, []), outputSchema: shape({ members: array(shape({ id: UUID, username: text, name: text, status: text })) }),
    handler: async (ctx, args) => {
      accountScope(ctx);
      const result = await directory.listMembers({ departmentId: args.departmentId as string | undefined });
      return { members: result.members.map(row => ({ id: row.id, username: row.username, name: row.name, status: row.status })) };
    },
  },
  {
    name: "project.listMemberRoles", kind: "read", description: "读取可分配的项目成员角色ID；需要目标项目的成员管理权限。",
    inputSchema: input(scoped), outputSchema: shape({ roles: array(shape({ id: UUID, key: text, name: text })) }),
    handler: async (ctx, args) => ({ roles: await members.listProjectMemberRoles(ctx.actor, args.projectId as string) }),
  },
  ...(["add", "update"] as const).map(action => ({
    name: `project.${action}Member`, kind: "write" as const,
    description: `${action === "add" ? "添加" : "更新现有"}项目成员与项目角色。roleIds由project.listMemberRoles发现，需要 userConfirmed=true。`,
    inputSchema: input({ ...scopedWrite, memberId: UUID, roleIds }), outputSchema: memberResult,
    handler: async (ctx: ToolCtx, args: Record<string, unknown>) => {
      requireUserConfirmation(args.userConfirmed === true);
      const data = { memberId: args.memberId as string, roleIds: args.roleIds as string[] };
      return action === "add" ? members.addProjectMember(ctx.actor, args.projectId as string, data) : members.updateProjectMember(ctx.actor, args.projectId as string, data);
    },
  })),
  {
    name: "project.removeMember", kind: "write", description: "移除项目成员并撤销该项目角色指派，需要 userConfirmed=true。",
    inputSchema: input({ ...scopedWrite, memberId: UUID }), outputSchema: success,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      await members.removeProjectMember(ctx.actor, args.projectId as string, args.memberId as string);
      return { ok: true };
    },
  },
  {
    name: "plan.getIterationCapacity", kind: "read", description: "读取迭代各项目成员的容量点数、小时及已记点数；迭代必须属于所给项目。",
    inputSchema: input({ ...scoped, iterationId: UUID }), outputSchema: shape({ members: array(capacityMember) }),
    handler: async (ctx, args) => { await planInProject(ctx, args, "iteration"); return plans.getIterationCapacity(ctx.actor, args.iterationId as string); },
  },
  {
    name: "plan.setIterationCapacity", kind: "write", description: "设置迭代成员容量，点数与小时二选一。已完成或归档迭代不可写，需要 userConfirmed=true。",
    inputSchema: input({ ...scopedWrite, iterationId: UUID, memberId: UUID, capacityPoints: { ...nullableNumber, minimum: 0, maximum: 99999 }, capacityHours: { ...nullableNumber, minimum: 0, maximum: 999999 } }, ["projectId", "iterationId", "memberId", "userConfirmed"]),
    outputSchema: shape({ id: UUID, iterationId: UUID, memberId: UUID, capacityPoints: nullableNumber, capacityHours: nullableNumber, loggedPoints: { type: "number" } }),
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      await planInProject(ctx, args, "iteration");
      const row = await plans.setIterationCapacity(ctx.actor, args.iterationId as string, args.memberId as string, { capacityPoints: args.capacityPoints, capacityHours: args.capacityHours });
      if (!row) throw new DomainError("INTERNAL", "容量写入失败", null);
      return { id: row.id, iterationId: row.iterationId, memberId: row.memberId, capacityPoints: row.capacityPoints === null ? null : Number(row.capacityPoints), capacityHours: row.capacityHours === null ? null : Number(row.capacityHours), loggedPoints: Number(row.loggedPoints) };
    },
  },
  {
    name: "plan.listMilestoneProgress", kind: "read", description: "读取里程碑结构化进展记录，含总结、后续步骤和阻碍。",
    inputSchema: input({ ...scoped, milestoneId: UUID }), outputSchema: shape({ updates: array(progressView) }),
    handler: async (ctx, args) => {
      await planInProject(ctx, args, "milestone");
      return { updates: (await progress.milestoneDetail(ctx.actor, args.milestoneId as string)).progressUpdates };
    },
  },
  {
    name: "plan.addMilestoneProgress", kind: "write", description: "记录里程碑结构化进展；需要里程碑管理权限及 userConfirmed=true。",
    inputSchema: input({ ...scopedWrite, milestoneId: UUID, ...progressFields }, ["projectId", "milestoneId", "summary", "userConfirmed"]),
    outputSchema: shape({ id: UUID, projectId: UUID, milestoneId: UUID, summary: text, nextSteps: nullableText, blockers: nullableText, createdAt: text }),
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      await planInProject(ctx, args, "milestone");
      const row = await progress.addProgressUpdate(ctx.actor, args.milestoneId as string, { summary: args.summary as string, nextSteps: args.nextSteps as string | null | undefined, blockers: args.blockers as string | null | undefined });
      if (!row) throw new DomainError("INTERNAL", "进展写入失败", null);
      return { id: row.id, projectId: row.projectId, milestoneId: row.milestoneId, summary: row.summary, nextSteps: row.nextSteps, blockers: row.blockers, createdAt: row.createdAt };
    },
  },
  {
    name: "plan.deleteMilestoneProgress", kind: "write", description: "删除指定里程碑的进展记录；项目、里程碑与记录归属必须匹配，需要 userConfirmed=true。",
    inputSchema: input({ ...scopedWrite, milestoneId: UUID, progressUpdateId: UUID }), outputSchema: success,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      await planInProject(ctx, args, "milestone");
      const detail = await progress.milestoneDetail(ctx.actor, args.milestoneId as string);
      if (!detail.progressUpdates.some(row => row.id === args.progressUpdateId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
      await progress.deleteProgressUpdate(ctx.actor, args.progressUpdateId as string);
      return { ok: true };
    },
  },
];
