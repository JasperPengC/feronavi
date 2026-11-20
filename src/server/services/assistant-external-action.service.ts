/** 外部动作以持久化单次任务执行；会话确认事务只入队，绝不跨外部HTTP持锁。 */
import { and, eq, sql as query } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { currentDatabaseContext } from "../../db/context.ts";
import { job } from "../../db/schema.ts";
import type { RagActionProposal } from "../../shared/rag.ts";
import { DomainError } from "../../shared/errors.ts";
import { loadActor } from "../auth/actor-loader.ts";
import * as repo from "../repos/rag-conversation.repo.ts";
import { enqueue, registerJobHandler, registerJobRecovery, type JobRow } from "./job.service.ts";
import type { TokenContext } from "./token.service.ts";
import { refreshAssistantToken } from "./assistant-access.ts";
import { listRagProjects } from "./rag-projects.ts";
import { assistantRegistry, authorizeAssistantTool, assertAssistantObservationsCurrent, executeAssistantTool, rereadAssistantClosureResult, type AssistantAccess } from "./assistant-tools.ts";
import { assertAssistantActionCurrent } from "./assistant-resource.ts";
import { publishWorkspaceInvalidation } from "./workspace-events.service.ts";

const KIND = "assistant.external_action";
const payloadSchema = z.strictObject({
  ownerId: z.string().uuid(), conversationId: z.string().uuid(), requestId: z.string().min(1), actionId: z.string().uuid(),
  projectIds: z.array(z.string().uuid()).min(1).max(1000),
  conversationProjectId: z.string().uuid().nullable(),
  token: z.strictObject({ tokenId: z.string().uuid(), memberId: z.string().uuid(), tier: z.enum(["READ_ONLY", "READ_WRITE", "ADMIN"]), projectWhitelist: z.array(z.string().uuid()) }).optional(),
});
type Payload = z.infer<typeof payloadSchema>;
type ExternalStatus = "queued" | "running" | "succeeded" | "failed" | "uncertain";
export const isAssistantExternalAction = (name: string) => name === "integration.sync";
function result(status: ExternalStatus, jobId: string, value: Record<string, unknown> = {}): NonNullable<RagActionProposal["result"]> {
  return { observedAt: new Date().toISOString(), resources: [], value: { executionStatus: status, jobId, ...value } };
}

export interface QueueAssistantExternalActionInput {
  ownerId: string;
  conversationId: string;
  requestId: string;
  action: RagActionProposal;
  projectIds: string[];
  token?: TokenContext;
}
/** 必须在调用者的短确认事务内调用，并由调用者一并保存已修改的action。 */
export async function queueAssistantExternalAction(input: QueueAssistantExternalActionInput): Promise<NonNullable<RagActionProposal["result"]>> {
  if (!currentDatabaseContext()?.transaction) throw new DomainError("INTERNAL", "外部动作必须在确认事务内登记", null);
  if (!isAssistantExternalAction(input.action.toolName)) throw new DomainError("VALIDATION", "该操作不属于异步外部动作", null);
  if (input.action.status !== "pending") {
    if (typeof input.action.result?.value.jobId === "string") return input.action.result;
    throw new DomainError("CONFLICT", "操作已处理，不能重复登记", null);
  }
  const conversation = await repo.findConversation(input.ownerId, input.conversationId);
  if (!conversation || conversation.deletedAt || !input.action.projectId || !input.projectIds.includes(input.action.projectId)
    || conversation.projectId && conversation.projectId !== input.action.projectId) throw new DomainError("NOT_FOUND", "会话范围已变化", null);
  const payload = payloadSchema.parse({ ownerId: input.ownerId, conversationId: input.conversationId, requestId: input.requestId,
    actionId: input.action.id, projectIds: input.projectIds, conversationProjectId: conversation.projectId,
    ...(input.token ? { token: { tokenId: input.token.tokenId, memberId: input.token.memberId, tier: input.token.tier, projectWhitelist: [...input.token.projectWhitelist] } } : {}) });
  const queued = await enqueue({ kind: KIND, payload, dedupeKey: `assistant-external:${input.ownerId}:${input.action.id}`, maxAttempts: 1 });
  if (!queued) throw new DomainError("CONFLICT", "外部任务登记失败", null);
  input.action.status = "queued";
  input.action.result = result("queued", queued.id);
  return input.action.result;
}

async function saveState(payload: Payload, jobId: string, status: "confirmed" | "failed" | "uncertain", output: NonNullable<RagActionProposal["result"]>) {
  await repo.withConversationLock(payload.ownerId, payload.conversationId, async conversation => {
    if (!conversation) return;
    const message = await repo.findMessage(payload.conversationId, payload.requestId);
    if (!message?.reply) return;
    const reply = structuredClone(message.reply);
    const action = reply.actions?.find(a => a.id === payload.actionId);
    if (!action || action.result?.value.jobId !== jobId || !["queued", "running"].includes(action.status)) return;
    action.status = status; action.result = output;
    await repo.updateMessage(message.id, { reply });
    await publishWorkspaceInvalidation({ domain: "ragConversation", resourceType: "RAG_CONVERSATION", resourceId: conversation.id, memberId: conversation.ownerId });
  });
}

async function accessFor(payload: Payload, action: RagActionProposal): Promise<AssistantAccess> {
  const actor = await loadActor(payload.ownerId);
  if (!actor) throw new DomainError("FORBIDDEN", "账号已失效", null);
  const token = payload.token ? await refreshAssistantToken(payload.token) : undefined;
  if (token && token.memberId !== payload.ownerId) throw new DomainError("FORBIDDEN", "令牌不属于会话所有者", null);
  const visible = await listRagProjects(actor, token?.projectWhitelist.length ? token.projectWhitelist : undefined,true);
  if (!action.projectId || !payload.projectIds.includes(action.projectId) || !visible.some(p => p.id === action.projectId)) throw new DomainError("FORBIDDEN", "项目权限已变化", null);
  const check = async () => {
    const conversation = await repo.findConversation(payload.ownerId, payload.conversationId);
    if (!conversation || conversation.deletedAt || conversation.projectId !== payload.conversationProjectId
      || conversation.projectId && conversation.projectId !== action.projectId) throw new DomainError("NOT_FOUND", "会话范围已变化", null);
    const message = await repo.findMessage(payload.conversationId, payload.requestId);
    if (!message?.reply || message.status !== "completed" || !message.reply.scope.projectIds.includes(action.projectId!)) throw new DomainError("NOT_FOUND", "操作上下文已不可访问", null);
  };
  await check();
  return { actor, token, projectIds: payload.projectIds.filter(id => visible.some(p => p.id === id)), check };
}

async function execute(payload: Payload, row: JobRow): Promise<void> {
  // 队列处理器不能从关闭的确认事务异步泄漏出来，或在HTTP前继承会话行锁。
  if (currentDatabaseContext()?.transaction) throw new DomainError("INTERNAL", "外部任务不能在会话事务中执行", null);
  let dispatchStarted = false;
  try {
    const action = await repo.withConversationLock(payload.ownerId, payload.conversationId, async conversation => {
      if (!conversation || conversation.deletedAt || conversation.projectId !== payload.conversationProjectId) throw new DomainError("NOT_FOUND", "会话范围已变化", null);
      const message = await repo.findMessage(payload.conversationId, payload.requestId);
      if (!message?.reply || message.status !== "completed") throw new DomainError("NOT_FOUND", "操作上下文已不可访问", null);
      const reply = structuredClone(message.reply), candidate = reply.actions?.find(a => a.id === payload.actionId);
      if (!candidate || candidate.result?.value.jobId !== row.id) throw new DomainError("CONFLICT", "任务与操作不匹配", null);
      if (candidate.status !== "queued") return null;
      if (!isAssistantExternalAction(candidate.toolName)) throw new DomainError("VALIDATION", "任务类型不支持", null);
      candidate.status = "running"; candidate.result = result("running", row.id);
      await repo.updateMessage(message.id, { reply });
      await publishWorkspaceInvalidation({ domain: "ragConversation", resourceType: "RAG_CONVERSATION", resourceId: conversation.id, memberId: conversation.ownerId });
      return candidate;
    });
    if (!action) return;
    const access = await accessFor(payload, action);
    const registry = await assistantRegistry();
    const tool = registry.find(t => t.kind === "write" && t.name === action.toolName);
    const statusTool = registry.find(t => t.kind === "read" && t.name === "integration.syncStatus");
    if (!tool || !statusTool) throw new DomainError("FORBIDDEN", "外部执行能力已不可用", null);
    await authorizeAssistantTool(access, tool, action.parameters);
    await assertAssistantActionCurrent(access.actor, action);
    await assertAssistantObservationsCurrent(access, action);
    // job 单次租约拥有去重；不能让工具幂等包装器再次跨外部HTTP打开数据库事务。
    const parameters = { ...action.parameters }; delete parameters.idempotencyKey;
    dispatchStarted = true;
    const executed = await executeAssistantTool(access, tool, parameters);
    const reread = await executeAssistantTool(access, statusTool, { projectId: action.projectId, integrationId: parameters.integrationId });
    const status = reread.value as Record<string, unknown>;
    if (!status.lastSyncedAt) throw new DomainError("INTERNAL", "同步完成后未发现持久化状态", null);
    const verified = await rereadAssistantClosureResult(access, action, executed.value);
    await saveState(payload, row.id, "confirmed", {
      ...(verified ?? result("succeeded", row.id)),
      value: { ...(verified?.value ?? {}), executionStatus: "succeeded", jobId: row.id, syncStatus: status },
    });
  } catch (error) {
    const status = dispatchStarted ? "uncertain" : "failed";
    await saveState(payload, row.id, status, result(status, row.id, { code: error instanceof DomainError ? error.code : "EXTERNAL_ACTION_FAILED",
      message: dispatchStarted ? "外部执行未能确认完成，请复读同步状态；不会自动重试。" : "操作执行前授权或上下文检查失败，未发送外部请求。" }));
    // 单次任务进入DEAD，持久化失败码不包含供应商响应、配置或凭据。
    throw new Error(dispatchStarted ? "EXTERNAL_ACTION_UNCERTAIN" : "EXTERNAL_ACTION_REJECTED", { cause: error });
  }
}

/** 启动/租约恢复只标记不确定；外发是否发生无法从进程中断推断，绝不再次调用sync。 */
export async function reconcileAssistantExternalActions(): Promise<void> {
  const dead = await db.select().from(job).where(and(eq(job.kind, KIND), eq(job.status, "DEAD"), query`coalesce(${job.payload}->>'assistantReconciled','false') <> 'true'`)).limit(100);
  for (const row of dead) {
    const parsed = payloadSchema.safeParse(row.payload);
    if (parsed.success) await saveState(parsed.data, row.id, "uncertain", result("uncertain", row.id, { code: "EXECUTION_INTERRUPTED", message: "执行进程中断，结果待复核；不会自动再次外发。" }));
    await db.update(job).set({ payload: { ...(row.payload as Record<string, unknown>), assistantReconciled: true } }).where(eq(job.id, row.id));
  }
}

export function registerAssistantExternalActionJobs(): void {
  registerJobHandler(KIND, async (payload, row) => { await execute(payloadSchema.parse(payload), row); });
  registerJobRecovery("assistant-external-action", reconcileAssistantExternalActions);
}
