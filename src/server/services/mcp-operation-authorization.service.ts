/** 幂等重放前重新验证当前账号权限，不能凭历史缓存恢复已撤销的授权。 */
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import { DomainError } from "../../shared/errors.ts";
import { projectForMcpResource } from "./mcp-resource.service.ts";
import { assertRoleManagement } from "./role.service.ts";
import { getProjectDetail } from "./project.service.ts";

export async function authorizeMcpOperation(actor: Actor, name: string, args: Record<string, unknown>) {
  if (name.startsWith("role.")) { assertRoleManagement(actor); return; }
  const permission = name.startsWith("workflow.") ? "work_item:manage_workflow"
    : name.startsWith("import.") ? (name === "import.rollback" ? "work_item:delete" : "work_item:create")
      : name === "organization.update" ? "org:manage" : name.startsWith("organization.") || name.startsWith("team.") ? "member:manage" : null;
  if (!permission) return;
  let projectId: string | null = typeof args.projectId === "string" ? args.projectId : null;
  if (name.startsWith("import.") && !projectId) projectId = await projectForMcpResource("importBatch", String(args.batchId));
  if (name.startsWith("workflow.") && !projectId) {
    const kind = typeof args.workflowId === "string" ? "workflow" : typeof args.stateId === "string" ? "workflowState" : "workflowTransition";
    const id = args.workflowId ?? args.stateId ?? args.transitionId;
    if (typeof id === "string") projectId = await projectForMcpResource(kind, id);
  }
  if (name.startsWith("import.") && !projectId) throw new DomainError("NOT_FOUND", "资源不存在", null);
  if (projectId) await getProjectDetail(actor, projectId);
  if (!can(actor, permission, { projectId }, { memberId: actor.memberId, memberProjectIds: new Set(), memberTeamIds: new Set() })) throw new DomainError("FORBIDDEN", "账号缺少该操作所需权限", null);
}
