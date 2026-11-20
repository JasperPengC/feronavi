/** 全组织管理工具：只允许未限制项目的令牌，保留领域服务权限和安全审计。 */
import { z } from "zod";
import { businessTool as tool, id, text, ok } from "./business-tool.ts";
import type { ToolDef } from "../tools.ts";
import * as roles from "../../../services/role.service.ts";
import * as org from "../../../services/org-structure.service.ts";
import * as teams from "../../../services/team.service.ts";

const account = { scope: "account" } as const;
const management = { ...account, destructive: true };
const permissionKeys = z.array(z.string().min(1).max(100)).max(200);
const assignment = { roleId: id, scopeType: z.enum(["ORG", "TEAM", "PROJECT", "DEPARTMENT"]), scopeId: id.nullable() };
const department = { name: text, parentId: id.nullable().optional() };
const position = { name: text, code: z.string().max(60).nullable().optional(), departmentId: id.nullable().optional(), description: z.string().max(2000).nullable().optional() };

export const ADMINISTRATION_TOOLS: ToolDef[] = [
  tool("role.permissions", "读取权限目录，创建角色前先查真实权限 key。", "read", {}, (c) => roles.listPermissionCatalog(c.actor), account),
  tool("role.create", "创建自定义角色并授予权限；先读取目录并确认授权范围。", "write", { slug: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/), name: text, permissionKeys }, (c, a) => roles.createRole(c.actor, a), management),
  tool("role.update", "修改角色名称或完整权限集合；需要用户确认。", "write", { roleId: id, name: text.optional(), permissionKeys: permissionKeys.optional() }, (c, { roleId, ...a }) => roles.updateRole(c.actor, roleId, a), management),
  tool("role.delete", "删除可删除的自定义角色，保留系统角色保护；需确认。", "write", { roleId: id }, (c, a) => ok(roles.deleteRole(c.actor, a.roleId)), management),
  tool("role.scopeOptions", "查询角色可指派的真实团队/项目/部门 ID。", "read", { scopeType: z.enum(["TEAM", "PROJECT", "DEPARTMENT"]) }, (c, a) => roles.listScopeOptions(c.actor, a.scopeType), account),
  tool("role.assignments", "读取指定成员的角色指派及范围。", "read", { memberId: id }, (c, a) => roles.listRoleAssignments(c.actor, a.memberId), account),
  tool("role.getAssignment", "通过真实指派 ID 读取成员和范围；需组织角色管理权。", "read", { assignmentId: id }, (c, a) => roles.getRoleAssignment(c.actor, a.assignmentId), account),
  tool("role.assign", "指派成员角色和范围；先读取角色/成员/范围并确认。", "write", { memberId: id, ...assignment }, (c, a) => roles.createRoleAssignment(c.actor, a), management),
  tool("role.updateAssignment", "修改已有角色指派，需确认。", "write", { assignmentId: id, ...assignment }, (c, { assignmentId, ...a }) => roles.updateRoleAssignment(c.actor, assignmentId, a), management),
  tool("role.revoke", "撤销一条角色指派，需确认；保留末位管理员等领域保护。", "write", { assignmentId: id }, (c, a) => ok(roles.deleteRoleAssignment(c.actor, a.assignmentId)), management),
  tool("organization.departments", "读取部门目录，用于项目/成员的组织归属。", "read", {}, () => org.listDepartments(), account),
  tool("organization.createDepartment", "创建部门，需 member:manage。", "write", department, (c, a) => org.createDepartment(c.actor, a), management),
  tool("organization.updateDepartment", "更新部门及父子关系，循环关系由业务层拒绝。", "write", { departmentId: id, name: text.optional(), parentId: id.nullable().optional(), sortOrder: z.number().int().min(0).optional() }, (c, { departmentId, ...a }) => org.updateDepartment(c.actor, departmentId, a), management),
  tool("organization.archiveDepartment", "归档部门并清除成员关联；需确认，有活跃子部门时拒绝。", "write", { departmentId: id }, (c, a) => org.archiveDepartment(c.actor, a.departmentId), management),
  tool("organization.positions", "读取职位目录。", "read", {}, () => org.listPositions(), account),
  tool("organization.createPosition", "创建职位。", "write", position, (c, a) => org.createPosition(c.actor, a), management),
  tool("organization.updatePosition", "修改职位名称、归属和描述。", "write", { positionId: id, name: text.optional(), code: position.code, departmentId: position.departmentId, description: position.description, sortOrder: z.number().int().min(0).optional() }, (c, { positionId, ...a }) => org.updatePosition(c.actor, positionId, a), management),
  tool("organization.archivePosition", "归档职位并清除成员关联，需确认。", "write", { positionId: id }, (c, a) => org.archivePosition(c.actor, a.positionId), management),
  tool("organization.assignMember", "设置成员的部门及职位；先发现 ID 并确认。", "write", { memberId: id, departmentId: id.nullable().optional(), positionId: id.nullable().optional() }, (c, { memberId, ...a }) => org.assignMemberOrganization(c.actor, memberId, a), management),
  tool("organization.applyTemplate", "应用 COMPANY/OPC 组织架构模板，需确认。", "write", { kind: z.enum(["COMPANY", "OPC"]) }, (c, a) => org.applyOrganizationTemplate(c.actor, a.kind), management),
  tool("team.list", "读取团队树及目录。", "read", {}, (c) => teams.listTeams(c.actor), account),
  tool("team.members", "读取团队成员。", "read", { teamId: id }, (c, a) => teams.listTeamMembers(c.actor, a.teamId), account),
  tool("team.create", "创建团队，需 member:manage。", "write", { name: text, parentId: id.nullable().optional(), sortOrder: z.number().int().min(0).optional() }, (c, a) => teams.createTeam(c.actor, a), management),
  tool("team.update", "修改团队名称、父级与顺序。", "write", { teamId: id, name: text.optional(), parentId: id.nullable().optional(), sortOrder: z.number().int().min(0).optional() }, (c, { teamId, ...a }) => teams.updateTeam(c.actor, teamId, a), management),
  tool("team.delete", "删除团队；业务依赖不满足时拒绝，需确认。", "write", { teamId: id }, (c, a) => ok(teams.deleteTeam(c.actor, a.teamId)), management),
];
