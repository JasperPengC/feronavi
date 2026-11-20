import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { streamAssistantMessage } from "../../lib/assistant-stream.ts";
import { invalidateWorkItemQueries } from "../../lib/query-keys.ts";
import type { RagReferences } from "../../../shared/rag.ts";
import type { RagConversation, RagConversationDetail, RagConversationUpdate, RagMessage, RagMessageResult } from "../../../shared/rag-conversations.ts";

const base = "/api/v1/rag/conversations";
const key = (accountId: string, id: string) => ["rag-conversation", accountId, id] as const;
export interface AssistantStreamState { text: string; phase: "thinking" | "tool" | "answering" | "retrying" | "recovering"; toolName?: string; error?: string }
interface RequestState { requestId: string; question: string; references?: RagReferences; pending: boolean; error?: string; ambiguous?: boolean; cancelled?: boolean; stream?: AssistantStreamState }

/** 草稿与请求按会话隔离；切换路由不取消服务端正在执行的回答。 */
export function useRagConversation(id: string | undefined, project: string | undefined,
  open: (conversation: RagConversation) => Promise<void>, accountId: string) {
  const client = useQueryClient();
  // 身份变化由外层key重挂载；正常切换会话保留同一世代。
  const generation = useRef({ active: true }).current;
  useLayoutEffect(() => {
    generation.active = true;
    return () => { generation.active = false; };
  }, [generation]);
  const isCurrent = () => generation.active;
  const conversationKey = (conversationId: string) => key(accountId, conversationId);
  const [blankId, setBlankId] = useState(() => crypto.randomUUID());
  const draftKey = id ?? `blank:${project ?? "all"}:${blankId}`;
  const active = useRef(draftKey); active.current = draftKey;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<Record<string, RequestState | undefined>>({});
  const locks = useRef(new Map<string, string>());
  const cancelled = useRef(new Set<string>());
  const restored = useRef(new Set<string>());
  const transports = useRef(new Map<string, AbortController>());
  useEffect(() => () => { transports.current.forEach(controller => controller.abort()); }, []);
  const [changing, setChanging] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const detail = useInfiniteQuery({
    queryKey: conversationKey(id ?? ""), enabled: !!id, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiGet<RagConversationDetail>(`${base}/${id}`, { before: pageParam }),
    getNextPageParam: (last) => last.hasMore ? last.messages[0]?.id : undefined,
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.messages.some((message) => message.status === "pending" || message.reply?.actions?.some(action => action.status === "queued" || action.status === "running"))) ? 1500 : false,
  });
  const visibleData = detail.isSuccess ? detail.data : undefined;
  const conversation = visibleData?.pages[0]?.conversation;
  const seen = new Set<string>();
  const messages = [...(visibleData?.pages ?? [])].reverse().flatMap((page) => page.messages).filter((message) => {
    if (seen.has(message.id)) return false; seen.add(message.id); return true;
  });
  const local = requests[draftKey];
  const serverPending = messages.find((message) => message.status === "pending");
  const pending = serverPending ?? (!local?.error && local?.pending ? local : undefined);
  const draft = drafts[draftKey] ?? "";
  const setDraft = (value: string) => setDrafts((old) => ({ ...old, [draftKey]: value }));

  function saveResult(result: RagMessageResult) {
    if (!isCurrent()) return;
    client.setQueryData<InfiniteData<RagConversationDetail, string | undefined>>(conversationKey(result.conversation.id), (old) => {
      if (!old) return { pages: [{ conversation: result.conversation, messages: [result.message], hasMore: false }], pageParams: [undefined] };
      const current = old.pages.flatMap((page) => page.messages).find((message) => message.requestId === result.message.requestId);
      // 已取消的请求不能被迟到的POST响应重新变成已完成。
      if ((current?.status === "cancelled" && result.message.status !== "cancelled") || current?.status === "unavailable") return old;
      const exists = !!current;
      return { ...old, pages: old.pages.map((page, index) => ({ ...page, conversation: result.conversation,
        messages: [...page.messages.map((message) => message.requestId === result.message.requestId ? result.message : message), ...(!exists && index === 0 ? [result.message] : [])],
      })) };
    });
    void client.invalidateQueries({ queryKey: ["rag-conversations", accountId] });
  }
  function settle(conversationId: string, message: RagMessage) {
    if (!isCurrent() || message.status === "pending") return;
    if (locks.current.get(conversationId) === message.requestId) locks.current.delete(conversationId);
    setRequests((old) => old[conversationId]?.requestId === message.requestId ? { ...old, [conversationId]: undefined } : old);
    if (message.status === "failed" || message.status === "cancelled") {
      restored.current.add(message.requestId);
      setDrafts((old) => ({ ...old, [conversationId]: old[conversationId] && old[conversationId] !== message.question ? old[conversationId]! : message.question }));
    } else {
      setDrafts((old) => old[conversationId] === message.question ? { ...old, [conversationId]: "" } : old);
    }
  }
  const latest = messages.at(-1);
  useEffect(() => {
    if (!id || !latest || latest.status === "pending") return;
    if (latest.status === "failed" || latest.status === "cancelled") {
      if (!restored.current.has(latest.requestId)) {
        restored.current.add(latest.requestId);
        setDrafts((old) => old[id] === undefined || old[id] === latest.question ? { ...old, [id]: latest.question } : old);
      }
    }
    const request = requests[id];
    if (request?.requestId === latest.requestId) settle(id, latest);
  }, [id, latest?.id, latest?.status]); // 请求结果只恢复一次，不能覆盖用户随后编辑的草稿。

  async function submit(questionText?: string, allowed = true, inputReferences?: RagReferences) {
    const references: RagReferences = { ...(inputReferences?.artifactIds?.length ? { artifactIds: [...inputReferences.artifactIds] } : {}), ...(inputReferences?.credentialRefs?.length ? { credentialRefs: [...inputReferences.credentialRefs] } : {}) };
    const referenceKey = (value?: RagReferences) => JSON.stringify([[...(value?.artifactIds ?? [])].sort(), [...(value?.credentialRefs ?? [])].sort()]);
    const question = (questionText ?? draft).trim();
    if (!isCurrent() || !allowed || !question || question.length > 1000 || pending || locks.current.has(draftKey)) return;
    const originKey = draftKey;
    const previous = requests[originKey];
    const requestId = previous?.ambiguous && previous.question === question && referenceKey(previous.references) === referenceKey(references) ? previous.requestId : crypto.randomUUID();
    locks.current.set(originKey, requestId);
    setDrafts((old) => ({ ...old, [originKey]: "" }));
    setRequests((old) => ({ ...old, [originKey]: { requestId, question, references, pending: true } }));
    let targetId = id;
    try {
      if (!targetId) {
        const created = await apiPost<RagConversation>(base, project ? { projectId: project } : {});
        if (!isCurrent()) return;
        targetId = created.id;
        if (cancelled.current.has(requestId)) return;
        locks.current.set(targetId, requestId);
        setDrafts((old) => ({ ...old, [created.id]: "" }));
        setRequests((old) => ({ ...old, [originKey]: undefined, [created.id]: { requestId, question, references, pending: true } }));
        if (active.current === originKey) await open(created);
      }
      if (!isCurrent() || cancelled.current.has(requestId)) return;
      const controller = new AbortController();
      transports.current.set(requestId, controller);
      const target = targetId;
      await streamAssistantMessage(`${base}/${targetId}/messages/stream`, { requestId, question, ...references }, (event) => {
        if (!isCurrent() || cancelled.current.has(requestId)) return;
        if (event.type === "accepted" || event.type === "result") {
          if (event.result.conversation.id !== target || event.result.message.requestId !== requestId) return;
          saveResult(event.result);
          settle(target, event.result.message);
          return;
        }
        setRequests((old) => {
          const current = old[target];
          if (current?.requestId !== requestId || !current.pending) return old;
          const stream = current.stream ?? { text: "", phase: "thinking" as const };
          if (event.type === "delta") return { ...old, [target]: { ...current, stream: { text: stream.text + event.text, phase: "answering" } } };
          if (event.type === "reset") return { ...old, [target]: { ...current, stream: { text: "", phase: "retrying" } } };
          if (event.type === "status") return { ...old, [target]: { ...current, stream: { ...stream, phase: event.phase, toolName: event.toolName } } };
          if (event.type === "error") return { ...old, [target]: { ...current, stream: { ...stream, phase: "recovering", error: event.message } } };
          return old;
        });
      }, controller.signal);
    } catch (cause) {
      const target = targetId ?? originKey;
      if (isCurrent() && !cancelled.current.has(requestId)) {
        const ambiguous = !(cause instanceof ApiError) || cause.status >= 500;
        setDrafts((old) => old[target] ? old : { ...old, [target]: question });
        setRequests((old) => ({ ...old, [target]: { requestId, question, references, pending: false, ambiguous, error: cause instanceof ApiError ? cause.message : t("assistant.failed"),
          stream: ambiguous ? { text: old[target]?.stream?.text ?? "", phase: "recovering", error: old[target]?.stream?.error } : undefined } }));
      }
    } finally {
      transports.current.delete(requestId);
      if (locks.current.get(originKey) === requestId) locks.current.delete(originKey);
      if (targetId && locks.current.get(targetId) === requestId) locks.current.delete(targetId);
      if (isCurrent() && targetId) void client.invalidateQueries({ queryKey: conversationKey(targetId) });
    }
  }
  async function cancel() {
    if (!isCurrent() || !pending) return;
    const requestId = pending.requestId;
    cancelled.current.add(requestId);
    setDrafts((old) => old[draftKey] ? old : { ...old, [draftKey]: pending.question });
    if (!id) {
      // 尚在创建空会话，消息还未提交；create返回后也不再启动该请求。
      setRequests((old) => ({ ...old, [draftKey]: { requestId, question: pending.question, pending: false, cancelled: true } }));
      if (locks.current.get(draftKey) === requestId) locks.current.delete(draftKey);
      return;
    }
    try {
      const result = await apiPost<RagMessageResult>(`${base}/${id}/requests/${requestId}/cancel`);
      if (!isCurrent()) return;
      transports.current.get(requestId)?.abort();
      saveResult(result); settle(id, result.message);
    } catch (cause) {
      if (!isCurrent()) return;
      cancelled.current.delete(requestId);
      if (active.current === id) setActionError(cause instanceof ApiError ? cause.message : t("assistant.cancelFailed"));
    } finally { if (isCurrent()) void client.invalidateQueries({ queryKey: conversationKey(id) }); }
  }
  const decisionLocks = useRef(new Set<string>());
  async function decide(requestId: string, actionId: string, decision: "confirm" | "reject") {
    if (!isCurrent() || !id || decisionLocks.current.has(actionId)) return;
    const target = id;
    decisionLocks.current.add(actionId);
    try {
      const result = await apiPost<RagMessageResult>(`${base}/${target}/requests/${requestId}/actions/${actionId}`, { decision });
      if (!isCurrent()) return;
      saveResult(result);
      // 成功后重新读取领域状态与建议；参数始终由服务端保存。
      await invalidateWorkItemQueries(client);
      await client.invalidateQueries({ queryKey: ["assistant-action-target", accountId] });
      await client.invalidateQueries({ queryKey: ["assistant-action-reference", accountId] });
      await Promise.all([
        ["assistant-generic-target", accountId], ["assistant-generic-reference", accountId],
        ["wiki-tree"], ["wiki-page"], ["wiki-revisions"], ["comments"], ["changelog"],
      ].map(queryKey => client.invalidateQueries({ queryKey })));
    } catch (cause) {
      if (isCurrent()) {
        await client.invalidateQueries({ queryKey: conversationKey(target) });
        if (isCurrent()) throw cause;
      }
    } finally {
      decisionLocks.current.delete(actionId);
      if (isCurrent()) void client.invalidateQueries({ queryKey: conversationKey(target) });
    }
  }
  async function update(value: RagConversationUpdate) {
    if (!isCurrent() || !id || changing) return undefined;
    setChanging(true); setActionError(undefined);
    try {
      const updated = await apiPatch<RagConversation>(`${base}/${id}`, value);
      if (!isCurrent()) return undefined;
      client.setQueryData<InfiniteData<RagConversationDetail>>(conversationKey(id), (old) => old ? { ...old, pages: old.pages.map((page) => ({ ...page, conversation: updated })) } : old);
      void client.invalidateQueries({ queryKey: ["rag-conversations", accountId] });
      void client.invalidateQueries({ queryKey: conversationKey(id) });
      return updated;
    } catch (cause) { if (isCurrent() && active.current === id) setActionError(cause instanceof ApiError ? cause.message : t("assistant.actionFailed")); return undefined; }
    finally { if (isCurrent()) setChanging(false); }
  }
  return { detail, conversation, messages, draft, setDraft, pending, streamFor: (requestId: string) => local?.requestId === requestId ? local.stream : undefined, decide, cancelledBeforeSend: local?.cancelled, error: serverPending ? undefined : local?.error, submit, cancel, update, changing, actionError,
    newBlank: () => setBlankId(crypto.randomUUID()), clearActionError: () => setActionError(undefined) };
}
