/** 外部 Agent 只登记服务端校验的提议；执行仍走同一个确认与幂等入口。 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import { ragExecutionProposeSchema, ragExecutionReviseSchema, type RagExecutionPropose, type RagExecutionRevise, type RagExecutionResult } from "../../shared/rag-conversations.ts";
import type { Actor } from "../permission/actor.ts";
import { loadActor } from "../auth/actor-loader.ts";
import * as repo from "../repos/rag-conversation.repo.ts";
import { refreshAssistantToken } from "./assistant-access.ts";
import { assistantRegistry, proposeAssistantAction, type AssistantAccess } from "./assistant-tools.ts";
import { listRagProjects } from "./rag.service.ts";
import { getExecution } from "./rag-conversation.service.ts";
import { tierAllows, type TokenContext } from "./token.service.ts";
import { publishWorkspaceInvalidation } from "./workspace-events.service.ts";

const notFound = () => new DomainError("NOT_FOUND", "会话不存在或不可访问", null);
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > 40_000)
    throw new DomainError("VALIDATION", "运行参数不合法或超过大小限制", null);
  return parsed.data;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
async function accessFor(actor: Actor, row: repo.ConversationRow | null, allowedProjectIds?: string[], token?: TokenContext): Promise<AssistantAccess> {
  if (!row || row.deletedAt || !row.projectId || (allowedProjectIds && !allowedProjectIds.includes(row.projectId))) throw notFound();
  const current = await loadActor(actor.memberId);
  if (!current) throw new DomainError("FORBIDDEN", "账号已失效", null);
  if (token) {
    token = await refreshAssistantToken(token);
    if (token.memberId !== actor.memberId || !tierAllows(token, "write") || (token.projectWhitelist.length && !token.projectWhitelist.includes(row.projectId)))
      throw new DomainError("FORBIDDEN", "令牌不允许登记该项目操作", null);
  }
  if (!(await listRagProjects(current, [row.projectId], true)).some(p => p.id === row.projectId)) throw notFound();
  return { actor: current, projectIds: [row.projectId], token, allowAccount: false, check: async () => {
    if (!(await loadActor(actor.memberId))) throw new DomainError("FORBIDDEN", "账号已失效", null);
  } };
}
async function propose(access: AssistantAccess, toolName: string, parameters: Record<string, unknown>) {
  if (Object.hasOwn(parameters, "userConfirmed") || Object.hasOwn(parameters, "idempotencyKey"))
    throw new DomainError("VALIDATION", "确认状态和执行幂等键只能由服务端记录", null);
  const tool = (await assistantRegistry()).find(t => t.kind === "write" && t.name === toolName);
  if (!tool) throw new DomainError("FORBIDDEN", "该工具未开放给助手", null);
  return proposeAssistantAction(access, tool, parameters);
}
async function changed(row: repo.ConversationRow) {
  await publishWorkspaceInvalidation({ domain: "ragConversation", resourceType: "RAG_CONVERSATION", resourceId: row.id, memberId: row.ownerId });
}
export async function proposeExecution(actor: Actor, conversationId: string, input: RagExecutionPropose, allowedProjectIds?: string[], token?: TokenContext): Promise<RagExecutionResult> {
  const parsed = parse(ragExecutionProposeSchema, input), requestHash = hash(parsed);
  const conversation = await repo.withConversationLock(actor.memberId, conversationId, async row => {
    const access = await accessFor(actor, row, allowedProjectIds, token);
    const existing = await repo.findMessage(conversationId, parsed.requestId);
    if (existing) {
      if (existing.reply?.executionRequest?.requestHash !== requestHash) throw new DomainError("CONFLICT", "运行 ID 已用于不同请求", null);
      await getExecution(actor, conversationId, parsed.requestId, allowedProjectIds, token);
      return row!;
    }
    const actions = [];
    for (const step of parsed.steps) actions.push(await propose(access, step.toolName, step.parameters));
    await repo.insertMessage({ conversationId, requestId: parsed.requestId, question: parsed.title, status: "completed", reply: {
      ok: true, answer: null, mode: "none", citations: [], scope: { projectIds: access.projectIds, projectCount: 1 }, actions,
      executionRequest: { origin: "agent", requestHash },
    } });
    return repo.updateConversation(conversationId, {});
  });
  await changed(conversation);
  return getExecution(actor, conversationId, parsed.requestId, allowedProjectIds, token);
}
export async function reviseExecutionAction(actor: Actor, conversationId: string, requestId: string, actionId: string, input: RagExecutionRevise, allowedProjectIds?: string[], token?: TokenContext): Promise<RagExecutionResult> {
  const parsed = parse(ragExecutionReviseSchema, input), requestHash = hash({ actionId, parameters: parsed.parameters });
  const conversation = await repo.withConversationLock(actor.memberId, conversationId, async row => {
    const access = await accessFor(actor, row, allowedProjectIds, token);
    await getExecution(actor, conversationId, requestId, allowedProjectIds, token);
    const message = await repo.findMessage(conversationId, requestId);
    if (!message?.reply || message.status !== "completed") throw notFound();
    const reply = structuredClone(message.reply), actions = reply.actions ?? [];
    const previous = actions.find(a => a.id === actionId);
    if (!previous) throw notFound();
    const duplicate = actions.find(a => a.revisionRequest?.id === parsed.replacementId);
    if (duplicate) {
      if (duplicate.supersedesId !== actionId || duplicate.revisionRequest?.hash !== requestHash) throw new DomainError("CONFLICT", "修正 ID 已用于不同请求", null);
      return row!;
    }
    if (previous.supersededById || !["pending", "expired", "failed"].includes(previous.status))
      throw new DomainError("CONFLICT", "此步骤不能修正，请先核对原执行结果", null);
    if (actions.length >= 100) throw new DomainError("VALIDATION", "此运行的修正历史已达上限，请新建运行", null);
    const replacement = await propose(access, previous.toolName, parsed.parameters);
    replacement.supersedesId = previous.id;
    replacement.revisionRequest = { id: parsed.replacementId, hash: requestHash };
    previous.status = "rejected";
    previous.supersededById = replacement.id;
    actions.push(replacement);
    await repo.updateMessage(message.id, { reply });
    return repo.updateConversation(conversationId, {});
  });
  await changed(conversation);
  return getExecution(actor, conversationId, requestId, allowedProjectIds, token);
}
