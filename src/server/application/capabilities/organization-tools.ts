/** 组织目录与管理工具；复用业务服务，所有入口都要求未限制项目的令牌。 */
import { z } from "zod";
import { DomainError } from "../../../shared/errors.ts";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { projectAllowed } from "../../services/token.service.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import * as organization from "../../services/organization.service.ts";
import * as structure from "../../services/org-structure.service.ts";
import * as teams from "../../services/team.service.ts";
import * as members from "../../services/member.service.ts";
import { getMemberDetail, memberPermissions } from "../../services/invite.service.ts";
import * as roles from "../../services/role.service.ts";

const uuid = z.uuid();
const nullableId = uuid.nullable();
const date = z.string();
const name = z.string().trim().min(1).max(80);
const confirm = { userConfirmed: z.boolean() };
const empty = z.object({}).strict();
const ok = z.object({ ok: z.literal(true) }).strict();
const memberId = z.object({ memberId: uuid }).strict();
const organizationView = z.object({ id: z.string(), name: z.string(), logoUrl: z.string().nullable(), defaultLocale: z.string(), defaultTimezone: z.string(), createdAt: date.nullable(), updatedAt: date.nullable() }).strict();
const departmentView = z.object({ id: uuid, name: z.string(), parentId: nullableId, sortOrder: z.number().int(), archivedAt: date.nullable(), createdAt: date }).strict();
const positionView = z.object({ id: uuid, name: z.string(), code: z.string().nullable(), departmentId: nullableId, description: z.string().nullable(), sortOrder: z.number().int(), archivedAt: date.nullable(), createdAt: date }).strict();
const teamView = z.object({ id: uuid, name: z.string(), parentId: nullableId, sortOrder: z.number().int(), archivedAt: date.nullable() }).strict();
const teamNode: z.ZodType<teams.TeamNode> = z.lazy(() => z.object({ id: uuid, name: z.string(), parentId: nullableId, sortOrder: z.number().int(), memberCount: z.number().int(), children: z.array(teamNode) }).strict());
type DepartmentTemplate = { name: string; children?: DepartmentTemplate[] };
const departmentTemplate: z.ZodType<DepartmentTemplate> = z.lazy(() => z.object({ name: z.string(), children: z.array(departmentTemplate).optional() }).strict());
const roleView = z.object({ id: uuid, key: z.string(), name: z.string(), isBuiltin: z.boolean(), isSystem: z.boolean(), permissionKeys: z.array(z.string()) }).strict();
const scopeType = z.enum(["ORG", "TEAM", "PROJECT", "DEPARTMENT"]);
const assignmentView = z.object({ id: uuid, memberId: uuid, roleId: uuid, roleKey: z.string(), roleName: z.string(), roleIsBuiltin: z.boolean(), scopeType, scopeId: nullableId, scopeName: z.string().nullable() }).strict();
const assignmentFields = { roleId: uuid, scopeType, scopeId: nullableId };
const positionFields = { name: name.optional(), code: z.string().max(40).nullable().optional(), departmentId: nullableId.optional(), description: z.string().max(2000).nullable().optional() };
const permissionKeys = z.array(z.string().min(1)).max(100);
const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: "draft-7" }) as NonNullable<ToolDef["outputSchema"]>;
const patchFields: Record<string, string[]> = {
  "organization.update": ["name", "logoUrl", "defaultLocale", "defaultTimezone"],
  "department.update": ["name", "parentId", "sortOrder"],
  "position.update": ["name", "code", "departmentId", "description", "sortOrder"],
  "team.update": ["name", "parentId", "sortOrder"],
  "member.assignOrganization": ["departmentId", "positionId"],
  "role.update": ["name", "permissionKeys"],
};

function tool<I extends z.ZodType>(name: string, kind: ToolDef["kind"], description: string, input: I, output: z.ZodType, handler: (ctx: ToolCtx, args: z.output<I>) => Promise<unknown>): ToolDef {
  return {
    name, kind, description,
    inputSchema: { ...schema(input), ...(patchFields[name] ? { anyOf: patchFields[name]!.map(field => ({ required: [field] })) } : {}) },
    outputSchema: schema(output),
    handler: async (ctx, raw) => {
      const parsed = input.safeParse(raw);
      if (!parsed.success) throw new DomainError("VALIDATION", "工具参数不合法", null);
      if (patchFields[name]?.every(field => (parsed.data as Record<string, unknown>)[field] === undefined)) throw new DomainError("VALIDATION", "请至少修改一项", null);
      if (kind === "write") requireUserConfirmation((parsed.data as Record<string, unknown>).userConfirmed === true);
      if (!projectAllowed(ctx.token, null)) throw new DomainError("FORBIDDEN", "组织工具需要未限制项目的令牌", null);
      return handler(ctx, parsed.data);
    },
  };
}

async function lifecycle(ctx: ToolCtx, id: string, action: "disabled" | "enabled" | "anonymized") {
  await members.manageMemberLifecycle(ctx.actor, id, action);
  return { ok: true };
}

export const ORGANIZATION_TOOLS: ToolDef[] = [
  tool("organization.get", "read", "读取组织名称、品牌与默认语言时区。", empty, organizationView, async () => organization.getOrganization()),
  tool("organization.update", "write", "更新组织资料；需组织 org:manage 权限和用户确认。", z.object({ ...confirm, name: name.optional(), logoUrl: z.url().nullable().optional(), defaultLocale: z.enum(["zh-CN", "en-US"]).optional(), defaultTimezone: z.string().min(1).optional() }).strict(), organizationView,
    async (ctx, { userConfirmed: _, ...patch }) => organization.updateOrganization(ctx.actor, patch)),
  tool("organization.getTemplate", "read", "查看组织结构模板。", z.object({ kind: z.enum(["COMPANY", "OPC"]), locale: z.enum(["zh-CN", "en-US"]).optional() }).strict(), z.object({ departments: z.array(departmentTemplate), positions: z.array(z.object({ name: z.string(), dept: z.string().optional() }).strict()) }).strict(),
    async (_ctx, args) => structure.orgTemplate(args.kind, args.locale)),
  tool("organization.applyTemplate", "write", "补充组织模板中的部门与职位；需组织 member:manage 权限和用户确认。", z.object({ ...confirm, kind: z.enum(["COMPANY", "OPC"]) }).strict(), z.object({ ok: z.literal(true), kind: z.enum(["COMPANY", "OPC"]), departmentsCreated: z.number().int(), departmentCount: z.number().int() }).strict(),
    async (ctx, args) => structure.applyOrganizationTemplate(ctx.actor, args.kind)),

  tool("department.list", "read", "读取活跃部门与直属成员数。", empty, z.object({ departments: z.array(departmentView.extend({ memberCount: z.number().int() })), metric: z.string() }).strict(), async () => structure.listDepartments()),
  tool("department.create", "write", "创建部门；需组织 member:manage 权限和用户确认。", z.object({ ...confirm, name, parentId: nullableId.optional() }).strict(), departmentView,
    async (ctx, { userConfirmed: _, ...input }) => structure.createDepartment(ctx.actor, input)),
  tool("department.update", "write", "更新部门名称、父级或顺序；防止部门树成环。", z.object({ ...confirm, departmentId: uuid, name: name.optional(), parentId: nullableId.optional(), sortOrder: z.number().int().optional() }).strict(), departmentView,
    async (ctx, { departmentId, userConfirmed: _, ...patch }) => structure.updateDepartment(ctx.actor, departmentId, patch)),
  tool("department.archive", "write", "归档无活跃子部门的部门并清除成员归属；需用户确认。", z.object({ ...confirm, departmentId: uuid }).strict(), ok,
    async (ctx, args) => { await structure.archiveDepartment(ctx.actor, args.departmentId); return { ok: true }; }),

  tool("position.list", "read", "读取活跃职位及其部门、成员数。", empty, z.object({ positions: z.array(positionView.omit({ archivedAt: true }).extend({ departmentName: z.string().nullable(), memberCount: z.number().int() })) }).strict(), async () => structure.listPositions()),
  tool("position.create", "write", "创建组织职位；需组织 member:manage 权限和用户确认。", z.object({ ...confirm, ...positionFields, name }).strict(), positionView,
    async (ctx, { userConfirmed: _, ...input }) => structure.createPosition(ctx.actor, input)),
  tool("position.update", "write", "更新职位资料或部门；需组织 member:manage 权限和用户确认。", z.object({ ...confirm, positionId: uuid, ...positionFields, sortOrder: z.number().int().optional() }).strict(), positionView,
    async (ctx, { positionId, userConfirmed: _, ...patch }) => structure.updatePosition(ctx.actor, positionId, patch)),
  tool("position.archive", "write", "归档职位并清除成员职位归属；需用户确认。", z.object({ ...confirm, positionId: uuid }).strict(), ok,
    async (ctx, args) => { await structure.archivePosition(ctx.actor, args.positionId); return { ok: true }; }),

  tool("team.list", "read", "读取团队树与各团队的直属角色成员数。", empty, z.object({ teams: z.array(teamNode) }).strict(), async (ctx) => ({ teams: await teams.listTeams(ctx.actor) })),
  tool("team.members", "read", "读取团队及其子团队的成员与角色名称。", z.object({ teamId: uuid }).strict(), z.object({ teamIds: z.array(uuid), members: z.array(z.object({ id: uuid, name: z.string(), username: z.string(), roles: z.array(z.string()) }).strict()) }).strict(), async (ctx, args) => teams.listTeamMembers(ctx.actor, args.teamId)),
  tool("team.create", "write", "创建团队；需组织 member:manage 权限和用户确认。", z.object({ ...confirm, name, parentId: nullableId.optional(), sortOrder: z.number().int().optional() }).strict(), teamView,
    async (ctx, { userConfirmed: _, ...input }) => teams.createTeam(ctx.actor, input)),
  tool("team.update", "write", "更新团队名称、父级或顺序；需用户确认。", z.object({ ...confirm, teamId: uuid, name: name.optional(), parentId: nullableId.optional(), sortOrder: z.number().int().optional() }).strict(), teamView,
    async (ctx, { teamId, userConfirmed: _, ...patch }) => teams.updateTeam(ctx.actor, teamId, patch)),
  tool("team.delete", "write", "删除无子团队和角色指派的团队；需用户确认。", z.object({ ...confirm, teamId: uuid }).strict(), ok,
    async (ctx, args) => { await teams.deleteTeam(ctx.actor, args.teamId); return { ok: true }; }),

  tool("member.get", "read", "读取成员目录详情，仅返回可公开给已登录成员的字段。", memberId, z.object({ id: uuid, username: z.string(), name: z.string(), email: z.string().nullable(), status: z.string(), timezone: z.string().nullable(), locale: z.string(), lastLoginAt: date.nullable(), createdAt: date, anonymizedAt: date.nullable(), departmentId: nullableId, departmentName: z.string().nullable(), positionId: nullableId, positionName: z.string().nullable() }).strict(), async (_ctx, args) => getMemberDetail(args.memberId)),
  tool("member.getPermissions", "read", "读取本人权限；查看他人需组织 member:manage 权限，作用域随指派原样返回。", memberId, z.object({ member: z.object({ id: uuid, username: z.string(), name: z.string() }).strict(), assignments: z.array(z.object({ id: uuid, scopeType, scopeId: nullableId, role: z.object({ id: uuid, key: z.string(), name: z.string() }).strict() }).strict()), permissions: z.array(z.string()) }).strict(), async (ctx, args) => memberPermissions(ctx.actor, args.memberId)),
  tool("member.assignOrganization", "write", "设置成员部门与职位；需组织 member:manage 权限和用户确认。", z.object({ ...confirm, memberId: uuid, departmentId: nullableId.optional(), positionId: nullableId.optional() }).strict(), z.object({ id: uuid, departmentId: nullableId, positionId: nullableId }).strict(),
    async (ctx, { memberId, userConfirmed: _, ...patch }) => structure.assignMemberOrganization(ctx.actor, memberId, patch)),
  tool("member.disable", "write", "禁用成员并撤销其凭据；需组织 member:manage 权限和用户确认。", memberId.extend(confirm), ok, async (ctx, args) => lifecycle(ctx, args.memberId, "disabled")),
  tool("member.enable", "write", "重新启用未匿名化成员；需组织 member:manage 权限和用户确认。", memberId.extend(confirm), ok, async (ctx, args) => lifecycle(ctx, args.memberId, "enabled")),
  tool("member.anonymize", "write", "匿名化成员身份并撤销凭据和角色指派；此操作不可恢复，需用户确认。", memberId.extend(confirm), ok, async (ctx, args) => lifecycle(ctx, args.memberId, "anonymized")),

  tool("role.list", "read", "读取组织角色和权限；需组织 role:manage 权限。", empty, z.object({ roles: z.array(roleView) }).strict(), async (ctx) => ({ roles: await roles.listRoles(ctx.actor) })),
  tool("role.listPermissions", "read", "读取可分配权限目录；需组织 role:manage 权限。", empty, z.object({ groups: z.array(z.object({ group: z.string(), permissions: z.array(z.object({ key: z.string(), group: z.string(), description: z.string() }).strict()) }).strict()) }).strict(), async (ctx) => ({ groups: await roles.listPermissionCatalog(ctx.actor) })),
  tool("role.listScopes", "read", "读取角色指派可选的团队、项目或部门；需组织 role:manage 权限。", z.object({ scopeType: z.enum(["TEAM", "PROJECT", "DEPARTMENT"]) }).strict(), z.object({ scopeType: z.enum(["TEAM", "PROJECT", "DEPARTMENT"]), scopes: z.array(z.object({ id: uuid, name: z.string() }).strict()) }).strict(), async (ctx, args) => roles.listScopeOptions(ctx.actor, args.scopeType)),
  tool("role.create", "write", "创建自定义组织角色；需组织 role:manage 权限和用户确认。", z.object({ ...confirm, slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/), name, permissionKeys }).strict(), roleView,
    async (ctx, { userConfirmed: _, ...input }) => roles.createRole(ctx.actor, input)),
  tool("role.update", "write", "更新自定义角色名称和权限；内置角色不可改，需用户确认。", z.object({ ...confirm, roleId: uuid, name: name.optional(), permissionKeys: permissionKeys.optional() }).strict(), roleView,
    async (ctx, { roleId, userConfirmed: _, ...patch }) => roles.updateRole(ctx.actor, roleId, patch)),
  tool("role.delete", "write", "删除自定义角色及其指派；内置角色和仍用于项目成员的角色不可删除，需用户确认。", z.object({ ...confirm, roleId: uuid }).strict(), ok,
    async (ctx, args) => { await roles.deleteRole(ctx.actor, args.roleId); return { ok: true }; }),
  tool("role.listAssignments", "read", "读取指定成员的完整角色指派；需组织 role:manage 权限。", memberId, z.object({ assignments: z.array(assignmentView) }).strict(), async (ctx, args) => ({ assignments: await roles.listRoleAssignments(ctx.actor, args.memberId) })),
  tool("role.createAssignment", "write", "为成员创建角色指派；ORG范围scopeId必须为null，其他范围需真实资源ID。", z.object({ ...confirm, memberId: uuid, ...assignmentFields }).strict(), assignmentView,
    async (ctx, { userConfirmed: _, ...input }) => roles.createRoleAssignment(ctx.actor, input)),
  tool("role.updateAssignment", "write", "更新既有角色指派的角色与范围；需组织 role:manage 权限和用户确认。", z.object({ ...confirm, assignmentId: uuid, ...assignmentFields }).strict(), assignmentView,
    async (ctx, { assignmentId, userConfirmed: _, ...patch }) => roles.updateRoleAssignment(ctx.actor, assignmentId, patch)),
  tool("role.deleteAssignment", "write", "删除既有成员角色指派；需组织 role:manage 权限和用户确认。", z.object({ ...confirm, assignmentId: uuid }).strict(), ok,
    async (ctx, args) => { await roles.deleteRoleAssignment(ctx.actor, args.assignmentId); return { ok: true }; }),
];

export const ORGANIZATION_ACCOUNT_TOOLS = new Set(ORGANIZATION_TOOLS.map(tool => tool.name));
