import { assistantCapabilities } from "./assistant-capabilities.ts";
import { ASSISTANT_CONTEXT_READ_TOOLS } from "./assistant-projection.ts";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { apiToken, workItem } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import type { RagChatResult } from "../../shared/rag.ts";
import type { Actor } from "../permission/actor.ts";
import { projectForMcpResource } from "./mcp-resource.service.ts";
import { getPage } from "./wiki.service.ts";
import { readAssistantResource } from "./assistant-resource.ts";
import { assertToolPolicyAllowed } from "./mcp-client.service.ts";
import type { TokenContext } from "./token.service.ts";
export async function refreshAssistantToken(
  token: TokenContext,
): Promise<TokenContext> {
  const [row] = await db
    .select()
    .from(apiToken)
    .where(eq(apiToken.id, token.tokenId))
    .limit(1);
  if (
    !row ||
    row.memberId !== token.memberId ||
    row.revokedAt ||
    (row.expiresAt && row.expiresAt.getTime() <= Date.now())
  )
    throw new DomainError("FORBIDDEN", "令牌已失效", null);
  return {
    ...token,
    tier: row.tier as TokenContext["tier"],
    projectWhitelist: (row.projectWhitelist ?? []) as string[],
  };
}
export async function assertAssistantReplyReadable(
  actor: Actor,
  reply: RagChatResult,
  projectIds: string[],
  token?: TokenContext,
) {
  if (reply.scope.projectIds.some((id) => !projectIds.includes(id)))
    throw new DomainError("FORBIDDEN", "资料范围已变化", null);
  // getWorkItem's read policy is project visibility (already projected above) plus non-deleted row.
  // Batch the equivalent row checks; per-token N+1 queries would exhaust the bounded generation window.
  const ids = [
    ...new Set(
      [
        ...(reply.evidence ?? []).flatMap((e) => e.resources),
        ...(reply.actions ?? []).flatMap((a) => [
          ...(a.target
            ? [a.target]
            : a.targetId
              ? [{ kind: "workItem", id: a.targetId }]
              : []),
          ...(a.resources ?? []),
          ...(a.result?.resources ?? []),
        ]),
      ]
        .filter((r) => r.kind === "workItem")
        .map((r) => r.id),
    ),
  ];
  const currentItems = ids.length
    ? await db
        .select({ id: workItem.id, projectId: workItem.projectId })
        .from(workItem)
        .where(and(inArray(workItem.id, ids), isNull(workItem.deletedAt)))
    : [];
  const itemProjects = new Map(
    currentItems.map((row) => [row.id, row.projectId]),
  );
  for (const e of reply.evidence ?? []) {
    if (e.scope) await revalidateScope(actor,e.scope,projectIds,token);
    if (e.projectId && !projectIds.includes(e.projectId))
      throw new DomainError("FORBIDDEN", "项目权限已变化", null);
    if (!e.projectId && !e.scope) throw new DomainError("FORBIDDEN","证据范围不完整",null);
    if (e.verificationReads?.length) await replayReads(actor,e.verificationReads,projectIds,token);
    if (token) {
      await assertToolPolicyAllowed(token.tokenId, e.toolName);
      if (e.toolName === "project.context")
        for (const name of e.readTools ?? ASSISTANT_CONTEXT_READ_TOOLS)
          await assertToolPolicyAllowed(token.tokenId, name);
    }
    await Promise.all(
      e.resources.map(async (r) => {
        if (r.kind === "workItem") {
          if (e.projectId ? itemProjects.get(r.id) !== e.projectId : !projectIds.includes(itemProjects.get(r.id)??""))
            throw new DomainError("NOT_FOUND", "资料不存在", null);
          return;
        }
        const resourceProject=await projectForMcpResource(r.kind,r.id);
        if (e.projectId ? resourceProject !== e.projectId : !resourceProject || !projectIds.includes(resourceProject))
          throw new DomainError("NOT_FOUND", "资料不存在", null);
        if (r.kind === "page") await getPage(actor, r.id);
        if (r.kind === "comment" || r.kind === "module" || r.kind === "idea") {
          const current = await readAssistantResource(actor, r);
          if (e.projectId && current.projectId !== e.projectId)
            throw new DomainError("NOT_FOUND", "资料不存在", null);
        }
      }),
    );
  }
  for (const a of reply.actions ?? []) {
    if (a.scope) await revalidateScope(actor,a.scope,projectIds,token);
    if (!a.projectId && !a.scope) throw new DomainError("FORBIDDEN","操作范围不完整",null);
    const reads=a.status==="confirmed" ? a.result?.verificationReads : a.verificationReads;
    if (reads?.length) await replayReads(actor,reads,projectIds,token);
    if (token) {
      await assertToolPolicyAllowed(token.tokenId, a.toolName);
      for (const observation of a.observations ?? [])
        await assertToolPolicyAllowed(token.tokenId, observation.toolName);
    }
    if (a.projectId && !projectIds.includes(a.projectId))
      throw new DomainError("FORBIDDEN", "操作范围已变化", null);
    const resources = [
      ...(a.target
        ? [a.target]
        : a.targetId
          ? [{ kind: "workItem" as const, id: a.targetId }]
          : []),
      ...(a.resources ?? []),
      ...(a.result?.resources ?? []),
    ];
    for (const resource of resources) {
      const projectId =
        resource.kind === "workItem"
          ? itemProjects.get(resource.id)
          : (await readAssistantResource(actor, resource)).projectId;
      if (a.projectId ? projectId !== a.projectId : !projectId || !projectIds.includes(projectId))
        throw new DomainError("FORBIDDEN", "操作范围已变化", null);
    }
  }
}

async function revalidateScope(actor:Actor,scope:import("../../shared/rag.ts").RagBusinessScope,projectIds:string[],token?:TokenContext) {
  if ("ownerId" in scope) {
    if(scope.ownerId!==actor.memberId || token?.projectWhitelist.length) throw new DomainError("FORBIDDEN","账号范围已变化",null);
  } else if(scope.projectIds.some(id=>!projectIds.includes(id)))throw new DomainError("FORBIDDEN","项目范围已变化",null);
}
async function replayReads(actor:Actor,reads:import("../../shared/rag.ts").RagVerificationRead[],projectIds:string[],token?:TokenContext) {
  const TOOLS = assistantCapabilities();
  const {ASSISTANT_WORKFLOW_READ_TOOLS}=await import("./assistant-workflow-contracts.ts");
  for(const read of reads) {
    const tool=TOOLS.find(t=>t.kind==="read"&&t.name===read.toolName&&ASSISTANT_WORKFLOW_READ_TOOLS.includes(t.name));
    if(!tool)throw new DomainError("FORBIDDEN","资料读取能力已变化",null);
    if(token)await assertToolPolicyAllowed(token.tokenId,tool.name);
    if(typeof read.parameters.projectId==="string"&&!projectIds.includes(read.parameters.projectId))throw new DomainError("FORBIDDEN","资料项目范围已变化",null);
    let global=tool.scope==="account"||tool.scope==="personal"||tool.scope==="identity"||["project.list","meta.fields"].includes(tool.name);
    if (tool.name.startsWith("savedView.")) {
      const viewProject = typeof read.parameters.savedViewId === "string"
        ? await projectForMcpResource("savedView", read.parameters.savedViewId)
        : read.parameters.projectId;
      if (typeof viewProject === "string" && !projectIds.includes(viewProject))
        throw new DomainError("FORBIDDEN", "资料项目范围已变化", null);
      // 个人视图的真实所有权仍由读取工具检查；会话回读不能合成项目受限令牌。
      global = !viewProject;
    }
    if(global&&token?.projectWhitelist.length&&tool.scope!=="identity")throw new DomainError("FORBIDDEN","账号范围已变化",null);
    if(!global&&!projectIds.length)throw new DomainError("FORBIDDEN","资料项目范围已变化",null);
    await tool.handler({actor,token:token ?? {memberId:actor.memberId,tokenId:"assistant-session",tier:"READ_WRITE",projectWhitelist:global?[]:projectIds}},read.parameters);
  }
}
