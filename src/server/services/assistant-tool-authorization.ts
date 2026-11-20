/** 每次工具调用重验真实身份、Token和会话范围；不会授予领域权限。 */
import { DomainError } from "../../shared/errors.ts";
import type { RagBusinessEvidence } from "../../shared/rag.ts";
import { loadActor } from "../auth/actor-loader.ts";
import type { Actor } from "../permission/actor.ts";
import type { ToolDef } from "../application/capabilities/tools.ts";
import {
  projectForMcpResource,
  type McpResourceKind,
} from "./mcp-resource.service.ts";
import { assertToolPolicyAllowed } from "./mcp-client.service.ts";
import { tierAllows, type TokenContext } from "./token.service.ts";
import { readAssistantResource } from "./assistant-resource.ts";
import { refreshAssistantToken } from "./assistant-access.ts";
import { assistantClosureReferences } from "./assistant-closure.ts";
import { ASSISTANT_WORKFLOW_CONTRACTS } from "./assistant-workflow-contracts.ts";
import {
  ASSISTANT_READ_TOOLS,
  ASSISTANT_WRITE_TOOLS,
} from "./assistant-tool-catalogue.ts";
const resourceKeys: Record<string, McpResourceKind> = {
  attachmentId: "attachment",
  ruleId: "automationRule",
  formId: "intakeForm",
  submissionId: "intakeSubmission",
  fieldId: "customFieldDef",
  dashboardId: "dashboard",
  widgetId: "dashboardWidget",
  workflowId: "workflow",
  stateId: "workflowState",
  fromStateId: "workflowState",
  toStateId: "workflowState",
  transitionId: "workflowTransition",
  batchId: "importBatch",
  integrationId: "integration",
  endpointId: "webhookEndpoint",
  deliveryId: "webhookDelivery",
  savedViewId: "savedView",
  policyId: "slaPolicy",
  workItemId: "workItem",
  fromWorkItemId: "workItem",
  toWorkItemId: "workItem",
  targetIterationId: "iteration",
  ideaId: "idea",
  parentId: "workItem",
  milestoneId: "milestone",
  iterationId: "iteration",
  releaseId: "release",
  moduleId: "module",
  pageId: "page",
  commentId: "comment",
};
export interface AssistantAccess {
  actor: Actor;
  projectIds: string[];
  token?: TokenContext;
  /** 全范围会话显式开放；项目会话/受限Token不能借空白名单提升到账号范围。 */
  allowAccount?: boolean;
  artifactIds?: string[];
  credentialRefs?: string[];
  check(): Promise<void>;
}
export async function authorizeAssistantTool(
  access: AssistantAccess,
  tool: ToolDef,
  args: Record<string, unknown>,
) {
  await access.check();
  if (
    !(tool.kind === "read" ? ASSISTANT_READ_TOOLS : ASSISTANT_WRITE_TOOLS).has(
      tool.name,
    )
  )
    throw new DomainError("FORBIDDEN", "该工具未开放给助手", null);
  const actor = await loadActor(access.actor.memberId);
  if (!actor) throw new DomainError("FORBIDDEN", "账号已失效", null);
  const liveToken = access.token
    ? await refreshAssistantToken(access.token)
    : undefined;
  if (liveToken) {
    if (
      liveToken.projectWhitelist.length &&
      access.projectIds.some((id) => !liveToken.projectWhitelist.includes(id))
    )
      throw new DomainError("FORBIDDEN", "令牌范围已变化", null);
    if (!tierAllows(liveToken, tool.kind))
      throw new DomainError("FORBIDDEN", "令牌档位不允许", null);
    await assertToolPolicyAllowed(liveToken.tokenId, tool.name);
  }
  let projectId =
    typeof args.projectId === "string" ? args.projectId : undefined;
  const contract = ASSISTANT_WORKFLOW_CONTRACTS[tool.name];
  let scopeKind: "project" | "personal" | "account" | "project-set" =
    contract?.scope ??
    (tool.scope === "personal"
      ? "personal"
      : tool.scope === "account"
        ? "account"
        : tool.scope === "project-set"
          ? "project-set"
          : "project");
  if (tool.scope === "identity" || tool.name === "project.list")
    scopeKind = "account";
  if (tool.name.startsWith("savedView.") && !args.projectId)
    scopeKind = "project-set";
  if (
    ["account", "personal"].includes(scopeKind) &&
    (!access.allowAccount || liveToken?.projectWhitelist.length)
  )
    throw new DomainError(
      "FORBIDDEN",
      "此能力需要全范围会话及未限制项目的令牌",
      null,
    );
  if (
    Array.isArray(args.projectIds) &&
    args.projectIds.some(
      (id) => typeof id !== "string" || !access.projectIds.includes(id),
    )
  )
    throw new DomainError("NOT_FOUND", "项目集合超出会话范围", null);
  const resources: RagBusinessEvidence["resources"] = [];
  const extra = await assistantClosureReferences(tool.name, args);
  for (const resource of extra) {
    const current = await readAssistantResource(actor, resource);
    if (
      !access.projectIds.includes(current.projectId) ||
      (projectId && current.projectId !== projectId)
    )
      throw new DomainError("NOT_FOUND", "资源不存在或不可访问", null);
    projectId = current.projectId;
    resources.push(resource);
  }
  if (tool.name === "meta.fields" && !projectId)
    projectId = access.projectIds[0];
  const keys = {
    ...resourceKeys,
    parentId: tool.name.startsWith("page.")
      ? "page"
      : tool.name === "workitem.comment"
        ? "comment"
        : tool.name.endsWith("Module")
          ? "module"
          : "workItem",
  } as Record<string, McpResourceKind>;
  if (typeof args.targetId === "string") {
    const kind = (
      {
        WORK_ITEM: "workItem",
        PAGE: "page",
        MILESTONE: "milestone",
        ITERATION: "iteration",
        IDEA: "idea",
        COMMENT: "comment",
      } as Record<string, McpResourceKind>
    )[String(args.targetType)];
    if (kind) keys.targetId = kind;
  }
  for (const [key, kind] of Object.entries(keys))
    if (typeof args[key] === "string") {
      const project = await projectForMcpResource(kind, args[key]);
      if (kind === "savedView" && !project) continue; // 个人视图仍由受守卫的领域读取验证所有权。
      if (!project || !access.projectIds.includes(project))
        throw new DomainError("NOT_FOUND", "资源不存在或不可访问", null);
      if (projectId && projectId !== project)
        throw new DomainError("NOT_FOUND", "资源不属于指定项目", null);
      projectId = project;
      if (
        [
          "workItem",
          "milestone",
          "iteration",
          "release",
          "module",
          "page",
          "comment",
          "idea",
        ].includes(kind)
      ) {
        const resource = {
          kind: kind as RagBusinessEvidence["resources"][number]["kind"],
          id: args[key],
        };
        // 同项目并不足以证明受限文档或其评论可读。
        await readAssistantResource(actor, resource);
        resources.push(resource);
      }
    }
  if (
    scopeKind === "project" &&
    (!projectId || !access.projectIds.includes(projectId))
  )
    throw new DomainError("NOT_FOUND", "项目不存在或不可访问", null);
  if (projectId && !access.projectIds.includes(projectId))
    throw new DomainError("NOT_FOUND", "项目不存在或不可访问", null);
  if (
    scopeKind === "project-set" &&
    !projectId &&
    !access.allowAccount &&
    tool.scope !== "project-set"
  )
    throw new DomainError("FORBIDDEN", "个人资源需要全范围会话", null);
  // The caller's full actor is preserved; this token only narrows, never grants permissions.
  const token: TokenContext = {
    memberId: actor.memberId,
    tier: liveToken?.tier ?? "READ_WRITE",
    tokenId: liveToken?.tokenId ?? "assistant-session",
    projectWhitelist:
      scopeKind === "account" ||
      scopeKind === "personal" ||
      (scopeKind === "project-set" && access.allowAccount)
        ? [...(liveToken?.projectWhitelist ?? [])]
        : [...access.projectIds],
  };
  const effectiveProject =
    scopeKind === "personal" || scopeKind === "account"
      ? null
      : (projectId ?? null);
  const scope =
    scopeKind === "personal" || scopeKind === "account"
      ? ({ kind: scopeKind, ownerId: actor.memberId } as const)
      : ({
          kind: scopeKind,
          projectIds: effectiveProject
            ? [effectiveProject]
            : [...access.projectIds],
        } as const);
  return {
    ctx: { actor, token },
    projectId: effectiveProject,
    resources,
    scope,
  };
}
