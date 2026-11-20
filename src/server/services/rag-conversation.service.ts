import { DomainError } from "../../shared/errors.ts";
import {
  ragConversationCreateSchema,
  ragConversationListSchema,
  ragConversationUpdateSchema,
  ragMessageCreateSchema,
  type RagConversation,
  type RagConversationCreate,
  type RagConversationDetail,
  type RagConversationList,
  type RagConversationListInput,
  type RagConversationUpdate,
  type RagMessage,
  type RagMessageCreate,
  type RagMessageResult,
} from "../../shared/rag-conversations.ts";
import type {
  RagChatInput,
  RagChatResult,
  RagProject,
} from "../../shared/rag.ts";
import type { Actor } from "../permission/actor.ts";
import { loadActor } from "../auth/actor-loader.ts";
import * as repo from "../repos/rag-conversation.repo.ts";
import { chatRag, listRagProjects } from "./rag.service.ts";
import { getPage } from "./wiki.service.ts";
import { publishWorkspaceInvalidation } from "./workspace-events.service.ts";

const notFound = () =>
  new DomainError("NOT_FOUND", "会话不存在或不可访问", null);
const activeGenerations = new Map<string, AbortController>();
const staleCutoff = () => new Date(Date.now() - 3 * 60 * 1000);
const conversationChanged = (row: repo.ConversationRow) => publishWorkspaceInvalidation({ domain: "ragConversation", resourceType: "RAG_CONVERSATION", resourceId: row.id, memberId: row.ownerId });
/** 会话恢复和长耗时模型响应都重新读取角色主体；入口Actor不是权限快照。 */
async function activeActor(actor: Actor): Promise<Actor> {
  const current = await loadActor(actor.memberId);
  if (!current)
    throw new DomainError("FORBIDDEN", "账号已失效或不可访问", null);
  return current;
}
function requireConversation(
  row: repo.ConversationRow | null,
  allowedProjectIds?: string[],
): repo.ConversationRow {
  if (
    !row ||
    (allowedProjectIds !== undefined &&
      (!row.projectId || !allowedProjectIds.includes(row.projectId)))
  )
    throw notFound();
  return row;
}
function conversationDto(
  row: repo.ConversationRow,
  projects: RagProject[],
): RagConversation {
  const project = projects.find((p) => p.id === row.projectId);
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    projectName: project?.name ?? null,
    available: !row.projectId || !!project,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
/** 快照不是权限。任何一份回答只要有来源已失权就整轮隐藏，避免从答案反推摘录。 */
async function messageDto(
  actor: Actor,
  row: repo.MessageRow,
  projects: RagProject[],
  conversationAvailable: boolean,
): Promise<RagMessage> {
  let readable = conversationAvailable;
  if (row.reply) {
    if (
      row.reply.evidence?.some(
        (e) => !!e.projectId && !projects.some((p) => p.id === e.projectId),
      ) ||
      row.reply.actions?.some(
        (a) => !!a.projectId && !projects.some((p) => p.id === a.projectId),
      ) ||
      row.reply.scope.projectIds.some(
        (id) => !projects.some((p) => p.id === id),
      )
    )
      readable = false;
    if (readable && (row.reply.evidence?.length || row.reply.actions?.length)) {
      try {
        const { assertAssistantReplyReadable } =
          await import("./assistant-access.ts");
        await assertAssistantReplyReadable(
          actor,
          row.reply,
          projects.map((p) => p.id),
        );
      } catch (error) {
        if (
          error instanceof DomainError &&
          (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
        )
          readable = false;
        else throw error;
      }
    }
    for (const citation of row.reply.citations) {
      if (!projects.some((p) => p.id === citation.projectId)) {
        readable = false;
        break;
      }
      try {
        const current = await getPage(actor, citation.pageId);
        if (current.projectId !== citation.projectId) {
          readable = false;
          break;
        }
      } catch (error) {
        if (
          error instanceof DomainError &&
          (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
        ) {
          readable = false;
          break;
        }
        throw error;
      }
    }
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    requestId: row.requestId,
    question: row.question,
    ...(row.requestMetadata ? {references:row.requestMetadata} : {}),
    status: readable ? (row.status as RagMessage["status"]) : "unavailable",
    reply: readable ? row.reply : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
async function resultDto(
  actor: Actor,
  conversation: repo.ConversationRow,
  message: repo.MessageRow,
  allowedProjectIds?: string[],
  token?: import("./token.service.ts").TokenContext,
): Promise<RagMessageResult> {
  actor = await activeActor(actor);
  const projects = await listRagProjects(actor, allowedProjectIds, true);
  if (token) {
    const { refreshAssistantToken, assertAssistantReplyReadable } =
      await import("./assistant-access.ts");
    token = await refreshAssistantToken(token);
    if (
      token.projectWhitelist.length &&
      message.reply?.scope.projectIds.some(
        (id) => !token!.projectWhitelist.includes(id),
      )
    )
      throw notFound();
    if (message.reply)
      await assertAssistantReplyReadable(
        actor,
        message.reply,
        projects.map((p) => p.id),
        token,
      );
  }
  const dto = conversationDto(conversation, projects);
  return {
    conversation: dto,
    message: await messageDto(actor, message, projects, dto.available),
  };
}
export async function listConversations(
  actor: Actor,
  input: RagConversationListInput,
  allowedProjectIds?: string[],
): Promise<RagConversationList> {
  actor = await activeActor(actor);
  const parsed = ragConversationListSchema.parse(input);
  const [result, projects] = await Promise.all([
    repo.listConversations(
      actor.memberId,
      parsed.deleted === "true",
      parsed.page,
      parsed.pageSize,
      allowedProjectIds,
    ),
    listRagProjects(actor, allowedProjectIds, true),
  ]);
  return {
    items: result.rows.map((row) => conversationDto(row, projects)),
    total: result.total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}
export async function createConversation(
  actor: Actor,
  input: RagConversationCreate,
  allowedProjectIds?: string[],
): Promise<RagConversation> {
  actor = await activeActor(actor);
  const parsed = ragConversationCreateSchema.parse(input);
  const projects = await listRagProjects(actor, allowedProjectIds, true);
  if (
    (allowedProjectIds !== undefined && !parsed.projectId) ||
    (parsed.projectId && !projects.some((p) => p.id === parsed.projectId))
  )
    throw notFound();
  const row = await repo.insertConversation({
    ownerId: actor.memberId,
    projectId: parsed.projectId ?? null,
    title: parsed.title ?? "新对话",
    titleIsDefault: parsed.title === undefined,
  });
  await conversationChanged(row);
  return conversationDto(row, projects);
}
export async function getConversation(
  actor: Actor,
  id: string,
  before?: string,
  allowedProjectIds?: string[],
  token?: import("./token.service.ts").TokenContext,
): Promise<RagConversationDetail> {
  actor = await activeActor(actor);
  const conversation = await repo.withConversationLock(
    actor.memberId,
    id,
    async (row) => {
      const current = requireConversation(row, allowedProjectIds);
      if (await repo.expirePending(id, staleCutoff())) await conversationChanged(current);
      return current;
    },
  );
  const [rows, projects] = await Promise.all([
    repo.listMessages(id, 101, before),
    listRagProjects(actor, allowedProjectIds, true),
  ]);
  if (token) {
    const { refreshAssistantToken, assertAssistantReplyReadable } =
      await import("./assistant-access.ts");
    token = await refreshAssistantToken(token);
    for (const row of rows) {
      if (!row.reply) continue;
      try {
        if (
          token.projectWhitelist.length &&
          row.reply.scope.projectIds.some(
            (id) => !token!.projectWhitelist.includes(id),
          )
        )
          throw notFound();
        await assertAssistantReplyReadable(
          actor,
          row.reply,
          projects.map((p) => p.id),
          token,
        );
      } catch (error) {
        if (
          error instanceof DomainError &&
          (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
        ) {
          row.reply = null;
          row.status = "unavailable";
        } else throw error;
      }
    }
  }
  const dto = conversationDto(conversation, projects);
  return {
    conversation: dto,
    messages: await Promise.all(
      rows
        .slice(0, 100)
        .reverse()
        .map((row) => messageDto(actor, row, projects, dto.available)),
    ),
    hasMore: rows.length > 100,
  };
}
export async function updateConversation(
  actor: Actor,
  id: string,
  input: RagConversationUpdate,
  allowedProjectIds?: string[],
): Promise<RagConversation> {
  actor = await activeActor(actor);
  const parsed = ragConversationUpdateSchema.parse(input);
  const row = await repo.withConversationLock(
    actor.memberId,
    id,
    async (current) => {
      const existing = requireConversation(current, allowedProjectIds);
      if (parsed.deleted) {
        await repo.cancelPending(id);
        for (const [key, controller] of activeGenerations)
          if (key.startsWith(`${id}:`)) controller.abort();
      }
      return repo.updateConversation(id, {
        ...(parsed.title !== undefined
          ? { title: parsed.title, titleIsDefault: false }
          : {}),
        ...(parsed.deleted !== undefined
          ? {
              deletedAt: parsed.deleted
                ? (existing.deletedAt ?? new Date())
                : null,
            }
          : {}),
      });
    },
  );
  await conversationChanged(row);
  return conversationDto(row, await listRagProjects(actor, allowedProjectIds, true));
}
async function historyFor(
  actor: Actor,
  id: string,
  projects: RagProject[],
): Promise<NonNullable<RagChatInput["history"]>> {
  const turns: RagMessage[] = [];
  let before: string | undefined;
  for (;;) {
    const rows = await repo.listMessages(id, 100, before);
    for (const row of rows) {
      if (row.status !== "completed" || !row.reply?.answer) continue;
      const message = await messageDto(actor, row, projects, true);
      if (message.status === "completed" && message.reply?.answer)
        turns.push(message);
      if (turns.length === 6) break;
    }
    if (turns.length === 6 || rows.length < 100) break;
    before = rows.at(-1)!.id;
  }
  return turns.reverse().flatMap((message) => [
    { role: "user" as const, content: message.question },
    {
      role: "assistant" as const,
      content: message.reply!.answer!.slice(0, 2000),
    },
  ]);
}
export async function sendMessage(
  actor: Actor,
  id: string,
  input: RagMessageCreate,
  allowedProjectIds?: string[],
  options: import("./rag.service.ts").RagRunOptions = {},
): Promise<RagMessageResult> {
  actor = await activeActor(actor);
  const parsed = ragMessageCreateSchema.parse(input);
  const projects = await listRagProjects(actor, allowedProjectIds, true);
  const claim = await repo.withConversationLock(
    actor.memberId,
    id,
    async (row) => {
      let conversation = requireConversation(row, allowedProjectIds);
      if (conversation.deletedAt) throw notFound();
      if (!conversationDto(conversation, projects).available) throw notFound();
      if (await repo.expirePending(id, staleCutoff())) await conversationChanged(conversation);
      const replay = await repo.findMessage(id, parsed.requestId);
      if (replay) {
        // 取消先于认领时先保留墓碑，首次发送只补问题，永不启动模型。
        if (replay.status === "cancelled" && replay.question === "") {
          return {
            conversation,
            message: await repo.updateMessage(replay.id, {
              question: parsed.question,
            }),
            claimed: false,
            changed: true,
          };
        }
        const references = {artifactIds:[...new Set(parsed.artifactIds??[])].sort(),credentialRefs:[...new Set(parsed.credentialRefs??[])].sort()};
        const prior = {artifactIds:[...new Set(replay.requestMetadata?.artifactIds??[])].sort(),credentialRefs:[...new Set(replay.requestMetadata?.credentialRefs??[])].sort()};
        if (replay.question !== parsed.question || JSON.stringify(prior)!==JSON.stringify(references))
          throw new DomainError("CONFLICT", "请求ID已用于其他问题", null);
        return { conversation, message: replay, claimed: false };
      }
      if (await repo.findPending(id))
        throw new DomainError(
          "CONFLICT",
          "当前会话正在回答，请等待或取消后重试",
          null,
        );
      const message = await repo.insertMessage({
        conversationId: id,
        requestId:parsed.requestId,question:parsed.question,
        ...((parsed.artifactIds?.length||parsed.credentialRefs?.length)?{requestMetadata:{artifactIds:parsed.artifactIds,credentialRefs:parsed.credentialRefs}}:{}),
        status: "pending",
      });
      if (conversation.titleIsDefault)
        conversation = await repo.updateConversation(id, {
          title: parsed.question.slice(0, 120),
          titleIsDefault: false,
        });
      else conversation = await repo.updateConversation(id, {});
      return { conversation, message, claimed: true };
    },
  );
  if (claim.claimed || "changed" in claim && claim.changed) await conversationChanged(claim.conversation);
  if (!claim.claimed)
    return resultDto(
      actor,
      claim.conversation,
      claim.message,
      allowedProjectIds,
      options.token,
    );
  await options.emit?.({
    type: "accepted",
    result: await resultDto(
      actor,
      claim.conversation,
      claim.message,
      allowedProjectIds,
    ),
  });
  const generationKey = `${id}:${parsed.requestId}`,
    controller = new AbortController();
  activeGenerations.set(generationKey, controller);
  let reply: RagChatResult | null = null;
  try {
    const generationActor = await activeActor(actor);
    const history = await historyFor(
      generationActor,
      id,
      await listRagProjects(generationActor, allowedProjectIds, true),
    );
    reply = await chatRag(
      generationActor,
      {
        question: parsed.question,
        artifactIds:parsed.artifactIds,
        credentialRefs:parsed.credentialRefs,
        ...(claim.conversation.projectId
          ? { projectIds: [claim.conversation.projectId] }
          : {}),
        history,
      },
      allowedProjectIds,
      async () => {
        await activeActor(actor);
        await repo.withConversationLock(actor.memberId, id, async (row) => {
          const current = requireConversation(row, allowedProjectIds);
          const message = await repo.findMessage(id, parsed.requestId);
          if (current.deletedAt || message?.status !== "pending")
            throw new DomainError("CONFLICT", "本轮回答已停止", null);
        });
      },
      {
        ...options,
        signal: AbortSignal.any([
          controller.signal,
          ...(options.signal ? [options.signal] : []),
        ]),
        persistent: true,
      },
    );
  } catch {
    await options.emit?.({ type: "reset" });
    // 供应商异常只改变本轮状态；问题留存便于使用新requestId重试，内部异常内容不写历史。
  }
  activeGenerations.delete(generationKey);
  const finished = await repo.withConversationLock(
    actor.memberId,
    id,
    async (row) => {
      const conversation = requireConversation(row, allowedProjectIds);
      let message = await repo.findMessage(id, parsed.requestId);
      if (!message) throw notFound();
      if (message.status === "pending") {
        message = await repo.updateMessage(message.id, {
          status: conversation.deletedAt
            ? "cancelled"
            : reply?.ok
              ? "completed"
              : "failed",
          reply: conversation.deletedAt ? null : reply,
        });
        if (!conversation.deletedAt)
          return {
            conversation: await repo.updateConversation(id, {}),
            message,
          };
      }
      return { conversation, message };
    },
  );
  await conversationChanged(finished.conversation);
  return resultDto(
    actor,
    finished.conversation,
    finished.message,
    allowedProjectIds,
    options.token,
  );
}
export async function cancelMessage(
  actor: Actor,
  id: string,
  requestId: string,
  allowedProjectIds?: string[],
  token?: import("./token.service.ts").TokenContext,
): Promise<RagMessageResult> {
  actor = await activeActor(actor);
  const result = await repo.withConversationLock(
    actor.memberId,
    id,
    async (row) => {
      const conversation = requireConversation(row, allowedProjectIds);
      const current = await repo.findMessage(id, requestId);
      if (!current && conversation.deletedAt) throw notFound();
      const message = !current
        ? await repo.insertMessage({
            conversationId: id,
            requestId,
            question: "",
            status: "cancelled",
          })
        : current.status === "pending"
          ? await repo.updateMessage(current.id, {
              status: "cancelled",
              reply: null,
            })
          : current;
      return { conversation, message };
    },
  );
  activeGenerations.get(`${id}:${requestId}`)?.abort();
  await conversationChanged(result.conversation);
  return resultDto(
    actor,
    result.conversation,
    result.message,
    allowedProjectIds,
    token,
  );
}
/** 本人导出同样逐轮重验权限，绝不把原始数据库快照作为用户导出。 */
export async function exportConversationData(
  actor: Actor,
): Promise<{ conversations: RagConversation[]; messages: RagMessage[] }> {
  actor = await activeActor(actor);
  const conversations: RagConversation[] = [],
    messages: RagMessage[] = [];
  for (const deleted of ["false", "true"] as const) {
    for (let page = 1; ; page++) {
      const result = await listConversations(actor, {
        deleted,
        page,
        pageSize: 50,
      });
      for (const conversation of result.items) {
        conversations.push(conversation);
        let before: string | undefined;
        for (;;) {
          const detail = await getConversation(actor, conversation.id, before);
          messages.push(...detail.messages);
          if (!detail.hasMore) break;
          before = detail.messages[0]!.id;
        }
      }
      if (page * 50 >= result.total) break;
    }
  }
  return { conversations, messages };
}

/** Confirmation accepts only a decision; parameters always come from the locked server snapshot. */
export async function decideAction(
  actor: Actor,
  id: string,
  requestId: string,
  actionId: string,
  decision: "confirm" | "reject",
  allowedProjectIds?: string[],
  token?: import("./token.service.ts").TokenContext,
): Promise<RagMessageResult> {
  actor = await activeActor(actor);
  const { assistantRegistry, executeAssistantTool, authorizeAssistantTool, assertAssistantObservationsCurrent, rereadAssistantClosureResult } =
    await import("./assistant-tools.ts");
  const { refreshAssistantToken, assertAssistantReplyReadable } =
    await import("./assistant-access.ts");
  const { lockAssistantResources, assertAssistantActionCurrent, rereadAssistantActionResult } = await import("./assistant-resource.ts");
  const { withIdempotency } = await import("./idempotency.service.ts");
  const result = await repo.withConversationLock(
    actor.memberId,
    id,
    async (row) => {
      actor = await activeActor(actor);
      const conversation = requireConversation(row, allowedProjectIds);
      if (conversation.deletedAt) throw notFound();
      const message = await repo.findMessage(id, requestId);
      if (!message?.reply || message.status !== "completed") throw notFound();
      const projects = await listRagProjects(actor, allowedProjectIds, true);
      const projectIds = projects.map((p) => p.id);
      if (token) {
        token = await refreshAssistantToken(token);
        const { tierAllows } = await import("./token.service.ts");
        if (
          !tierAllows(token, "write") ||
          (token.projectWhitelist.length &&
            message.reply.scope.projectIds.some(
              (id) => !token!.projectWhitelist.includes(id),
            ))
        )
          throw new DomainError("FORBIDDEN", "令牌不允许该操作", null);
      }
      await assertAssistantReplyReadable(
        actor,
        message.reply,
        projectIds,
        token,
      );
      const reply = structuredClone(message.reply),
        action = reply.actions?.find((a) => a.id === actionId);
      if (!action) throw notFound();
      if (action.status !== "pending") return { conversation, message };
      if (new Date(action.expiresAt).getTime() <= Date.now()) {
        action.status = "expired";
        return {
          conversation,
          message: await repo.updateMessage(message.id, { reply }),
        };
      }
      if (decision === "reject") {
        action.status = "rejected";
        return {
          conversation,
          message: await repo.updateMessage(message.id, { reply }),
        };
      }
      if (
        action.projectId !== null && !projectIds.includes(action.projectId) ||
        (conversation.projectId && conversation.projectId !== action.projectId)
      )
        throw notFound();
      const tool = (await assistantRegistry()).find(
        (t) => t.kind === "write" && t.name === action.toolName,
      );
      if (!tool) throw notFound();
      const {isAssistantExternalAction,queueAssistantExternalAction}=await import("./assistant-external-action.service.ts");
      if (isAssistantExternalAction(tool.name)) {
        const access={actor,projectIds:conversation.projectId?[conversation.projectId]:reply.scope.projectIds,allowAccount:!conversation.projectId&&!token?.projectWhitelist.length,token,check:async()=>{await activeActor(actor);}};
        await authorizeAssistantTool(access,tool,action.parameters);
        await assertAssistantObservationsCurrent(access,action);
        await queueAssistantExternalAction({ownerId:actor.memberId,conversationId:id,requestId,action,projectIds:access.projectIds,token});
        return {conversation,message:await repo.updateMessage(message.id,{reply})};
      }
      const targets = action.target ? [action.target] : action.targetId ? [{ kind: "workItem" as const, id: action.targetId }] : [];
      const { lockAssistantClosureRecords } = await import("./assistant-closure.ts");
      await lockAssistantClosureRecords(action);
      const {lockAssistantWorkflowRecords}=await import("./assistant-tools.ts");
      await lockAssistantWorkflowRecords(action);
      if(action.projectId) await lockAssistantResources(action.projectId, [...targets, ...(action.resources ?? [])]);
      await assertAssistantActionCurrent(actor, action);
      const execution = await withIdempotency(
        {
          actorId: actor.memberId,
          key: action.id,
          scope: "assistant.action",
          body: { toolName: action.toolName, parameters: action.parameters },
        },
        async () => {
          // 服务器确认ID拥有幂等键；模型提供的键不能重放另一条业务建议。
          const parameters: Record<string, unknown> = { ...action.parameters, userConfirmed: true };
          if (Object.hasOwn((tool.inputSchema.properties ?? {}) as object, "idempotencyKey")) parameters.idempotencyKey = action.id;
          const access = {
            actor,
            projectIds: conversation.projectId ? [conversation.projectId] : reply.scope.projectIds,
            allowAccount: !conversation.projectId && !token?.projectWhitelist.length,
            artifactIds:message.requestMetadata?.artifactIds,
            credentialRefs:message.requestMetadata?.credentialRefs,
            token,
            check: async () => { await activeActor(actor); },
          };
          const before = await assertAssistantObservationsCurrent(access,action);
          try {
            const executed = await executeAssistantTool(access, tool, parameters);
            return (await rereadAssistantClosureResult(access,action,executed.value,{before})) ?? rereadAssistantActionResult(executed.ctx.actor, tool.name, executed.value, action.projectId!);
          } catch (error) {
            // 审批边已经产生待审记录；只保留经过授权复核的该工作项PENDING结果。
            // 其它业务失败必须继续抛出，确保事务不会误提交部分写入。
            if (tool.name !== "workitem.transition" || !(error instanceof DomainError) || error.code !== "BLOCKED_BY_PREREQUISITE") throw error;
            const approvalId = (error.details as { approvalId?: unknown } | null)?.approvalId;
            if (typeof approvalId !== "string" || typeof parameters.workItemId !== "string") throw error;
            const authorized = await authorizeAssistantTool(access, tool, parameters);
            const { listForItem } = await import("./approval.service.ts");
            const pending = (await listForItem(authorized.ctx.actor, parameters.workItemId))
              .find(item => item.id === approvalId && item.workItemId === parameters.workItemId && item.status === "PENDING");
            if (!pending) throw error;
            const current = await rereadAssistantActionResult(authorized.ctx.actor, tool.name, { id: parameters.workItemId }, action.projectId!);
            return { ...current, outcome: "approval_pending" as const, approval: { status: "PENDING" as const } };
          }
        },
      );
      action.result = execution.value;
      action.status = "confirmed";
      return {
        conversation,
        message: await repo.updateMessage(message.id, { reply }),
      };
    },
  );
  await conversationChanged(result.conversation);
  return resultDto(
    actor,
    result.conversation,
    result.message,
    allowedProjectIds,
    token,
  );
}
