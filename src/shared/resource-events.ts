/** SSE 只携带缓存定位；业务内容始终经带权限的 GET 回源。 */
export const RESOURCE_DOMAINS = ["workitem", "plan", "attachment", "comment", "wiki", "import", "project", "automation", "sla", "workflow", "field", "idea", "intake", "report", "insight"] as const;
export type ResourceDomain = typeof RESOURCE_DOMAINS[number];
export interface ResourceScope {
  projectId: string;
  resourceType: string;
  resourceId: string;
}
export interface ResourceInvalidation extends ResourceScope { domain: ResourceDomain }

export function parseResourceInvalidation(data: Record<string, unknown>): ResourceInvalidation | null {
  if (!RESOURCE_DOMAINS.includes(data.domain as ResourceDomain)
    || typeof data.projectId !== "string" || !data.projectId
    || typeof data.resourceType !== "string" || !data.resourceType
    || typeof data.resourceId !== "string" || !data.resourceId) return null;
  return { domain: data.domain as ResourceDomain, projectId: data.projectId, resourceType: data.resourceType, resourceId: data.resourceId };
}

export function businessInvalidation(input: {
  action: string; targetType: string; targetId?: string | null; projectId?: string | null;
  invalidation?: Pick<ResourceInvalidation, "domain" | "resourceType" | "resourceId">;
}): ResourceInvalidation | null {
  if (!input.projectId || !input.targetId) return null;
  const prefix = input.action.split(".")[0];
  const domain = prefix === "work_item" ? "workitem" : prefix;
  return parseResourceInvalidation({
    domain, projectId: input.projectId, resourceType: input.targetType, resourceId: input.targetId,
    ...input.invalidation,
  });
}

/** 私有及组织共享资源独立通道，服务端始终逐成员定向。 */
export const WORKSPACE_DOMAINS = ["todo", "focus", "savedView", "portfolio", "dashboard", "organization", "directory", "role", "projectTemplate", "ragConversation"] as const;
export type WorkspaceDomain = typeof WORKSPACE_DOMAINS[number];
export interface WorkspaceInvalidation {
  domain: WorkspaceDomain;
  projectId: string | null;
  resourceType: string;
  resourceId: string;
}
export function parseWorkspaceInvalidation(data: Record<string, unknown>): WorkspaceInvalidation | null {
  if (!WORKSPACE_DOMAINS.includes(data.domain as WorkspaceDomain)
    || !(data.projectId === null || typeof data.projectId === "string" && !!data.projectId)
    || typeof data.resourceType !== "string" || !data.resourceType
    || typeof data.resourceId !== "string" || !data.resourceId) return null;
  return { domain: data.domain as WorkspaceDomain, projectId: data.projectId as string | null, resourceType: data.resourceType, resourceId: data.resourceId };
}
