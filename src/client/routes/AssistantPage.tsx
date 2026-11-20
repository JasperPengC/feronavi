import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "../components/Icon.tsx";
import { Select } from "../components/Select.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Drawer } from "../components/ui/Drawer.tsx";
import { AssistantArtifacts, type AssistantArtifactSelection } from "../components/assistant/AssistantArtifacts.tsx";
import { AssistantMessage } from "../components/assistant/AssistantMessage.tsx";
import { ConversationList } from "../components/assistant/ConversationList.tsx";
import { useRagConversation } from "../components/assistant/useRagConversation.ts";
import { useActor } from "../lib/actor.ts";
import { apiGet, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import type { RagProject, RagReferences } from "../../shared/rag.ts";
import "../styles/assistant.css";

export function AssistantPage() {
  const actor = useActor();
  return <AssistantWorkspace key={actor.memberId} accountId={actor.memberId} />;
}

const noArtifacts: AssistantArtifactSelection[] = [];

function AssistantWorkspace({ accountId }: { accountId: string }) {
  useLocale();
  const { project, conversation: conversationId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const [blankVersion, setBlankVersion] = useState(0);
  const selectionKey = conversationId ?? `blank:${project ?? "all"}:${blankVersion}`;
  const [selections, setSelections] = useState<Record<string, AssistantArtifactSelection[]>>({});
  const [referenceSets, setReferenceSets] = useState<Record<string, RagReferences>>({});
  const references = referenceSets[selectionKey];
  const referencesForSend = (): RagReferences => {
    const live = new Set((selections[selectionKey] ?? noArtifacts).filter(item => Date.parse(item.expiresAt) > Date.now()).map(item => item.id));
    const artifactIds = references?.artifactIds?.filter(id => live.has(id));
    const credentialRefs = references?.credentialRefs?.filter(id => live.has(id));
    return { ...(artifactIds?.length ? { artifactIds } : {}), ...(credentialRefs?.length ? { credentialRefs } : {}) };
  };
  const changeReferences = useCallback((refs: RagReferences) => setReferenceSets(old => ({ ...old, [selectionKey]: refs })), [selectionKey]);
  const chat = useRagConversation(conversationId, project, async (conversation) => {
    setSelections(old => ({ ...old, [conversation.id]: old[selectionKey] ?? [] }));
    setReferenceSets(old => ({ ...old, [conversation.id]: old[selectionKey] ?? {} }));
    await navigate({ to: "/assistant", search: { conversation: conversation.id }, replace: true });
  }, accountId);
  const [mobile, setMobile] = useState(() => window.matchMedia?.("(max-width: 760px)").matches ?? false);
  const [listOpen, setListOpen] = useState(() => !(window.matchMedia?.("(max-width: 760px)").matches ?? false));
  const [deleted, setDeleted] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const currentConversation = useRef(conversationId); currentConversation.current = conversationId;
  const input = useRef<HTMLTextAreaElement>(null);
  const latestTurn = useRef<HTMLElement>(null);
  const hadPending = useRef(false);
  const projects = useQuery({ queryKey: ["rag-projects", accountId], queryFn: () => apiGet<{ items: RagProject[] }>("/api/v1/rag/projects") });
  const items = projects.data?.items ?? [];
  // 已保存会话的范围仅取服务端详情，URL中的project只用于空白会话。
  const scopeProject = chat.conversation ? chat.conversation.projectId ?? undefined : conversationId ? undefined : project;
  const unavailable = chat.conversation?.available === false || (!!scopeProject && projects.isSuccess && !items.some((item) => item.id === scopeProject));
  const canSend = projects.isSuccess && !unavailable && !chat.conversation?.deletedAt && (!conversationId || chat.detail.isSuccess);
  const { draft, pending, messages } = chat;
  const pendingIsListed = pending && messages.some((message) => message.requestId === pending.requestId);
  const empty = !messages.length && !pending;

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const change = () => { setMobile(media.matches); setListOpen(!media.matches); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => { setRename(null); chat.clearActionError(); }, [conversationId]);
  useEffect(() => { latestTurn.current?.querySelector(".assistant-question")?.scrollIntoView?.({ block: "start" }); }, [conversationId, messages.at(-1)?.id, messages.at(-1)?.status, pending?.requestId]);
  useEffect(() => {
    if (hadPending.current && !pending) input.current?.focus({ preventScroll: true });
    hadPending.current = !!pending;
  }, [pending]);

  function newConversation(nextProject?: string) {
    chat.newBlank(); setBlankVersion(value => value + 1); setRename(null);
    if (mobile) setListOpen(false);
    void navigate({ to: "/assistant", search: { project: nextProject } });
    input.current?.focus({ preventScroll: true });
  }
  const list = <ConversationList accountId={accountId} activeId={conversationId} deleted={deleted} onDeletedChange={setDeleted} onSelect={() => { if (mobile) setListOpen(false); }} />;

  return <div className={`page workspace-page assistant-page${empty ? " is-empty" : ""}`}>
    <header className="assistant-header">
      <div className="assistant-header-start">
        <Button variant="ghost" iconOnly aria-label={t("assistant.toggleHistory")} title={t("assistant.toggleHistory")} aria-expanded={listOpen} aria-controls={mobile ? undefined : "assistant-history"} onClick={() => setListOpen(!listOpen)}><Icon name="list" size={18} /></Button>
        <h1 title={chat.conversation?.title}>{chat.conversation?.title ?? t("nav.assistant")}</h1>
      </div>
      <div className="assistant-header-actions">
        {chat.conversation && !chat.conversation.deletedAt && <>
          <Button variant="ghost" iconOnly aria-label={t("assistant.rename")} title={t("assistant.rename")} disabled={chat.changing} onClick={() => setRename(chat.conversation!.title)}><Icon name="pencil" size={16} /></Button>
          <Button variant="ghost" iconOnly aria-label={t("assistant.delete")} title={t("assistant.deleteHint")} disabled={chat.changing} onClick={() => void chat.update({ deleted: true }).then((updated) => { if (updated && currentConversation.current === updated.id) newConversation(scopeProject); })}><Icon name="trash" size={16} /></Button>
        </>}
        {chat.conversation?.deletedAt && <Button variant="ghost" size="sm" loading={chat.changing} onClick={() => void chat.update({ deleted: false }).then((updated) => { if (updated) setDeleted(false); })}>{t("assistant.restore")}</Button>}
        <Button variant="ghost" iconOnly aria-label={t("assistant.new")} title={t("assistant.new")} onClick={() => newConversation(scopeProject)}><Icon name="plus" size={18} /></Button>
      </div>
    </header>
    <div className="assistant-workspace">
      {!mobile && listOpen && <aside id="assistant-history" className="assistant-history" aria-label={t("assistant.history")}>{list}</aside>}
      {mobile && <Drawer open={listOpen} onClose={() => setListOpen(false)} title={t("assistant.history")} side="left" width="sm" className="assistant-session-drawer">{list}</Drawer>}
      <div className="assistant-main">
        {rename !== null && <form className="assistant-rename" onSubmit={(event) => { event.preventDefault(); if (rename.trim()) void chat.update({ title: rename.trim() }).then((updated) => { if (updated && currentConversation.current === updated.id) setRename(null); }); }}>
          <label className="sr-only" htmlFor="assistant-conversation-title">{t("assistant.titleLabel")}</label>
          <input autoFocus className="input" id="assistant-conversation-title" maxLength={120} value={rename} onChange={(event) => setRename(event.target.value)} />
          <Button type="submit" size="sm" disabled={!rename.trim()} loading={chat.changing}>{t("assistant.saveTitle")}</Button>
          <Button variant="ghost" size="sm" onClick={() => setRename(null)}>{t("common.cancel")}</Button>
        </form>}
        {chat.actionError && <p className="assistant-notice" role="alert">{chat.actionError}</p>}
        {conversationId && chat.detail.isPending && <p className="assistant-notice" role="status">{t("assistant.loading")}</p>}
        {conversationId && chat.detail.isError && <div className="assistant-notice" role="alert"><span>{chat.detail.error instanceof ApiError ? chat.detail.error.message : t("assistant.loadFailed")}</span>
          <Button size="sm" onClick={() => void chat.detail.refetch()}>{t("kn.retry")}</Button><Button size="sm" variant="ghost" onClick={() => { setDeleted(true); setListOpen(true); }}>{t("assistant.findDeleted")}</Button>
        </div>}
        {projects.isError && <div className="assistant-notice" role="alert"><span>{projects.error instanceof ApiError ? projects.error.message : t("assistant.projectsFailed")}</span><Button size="sm" onClick={() => void projects.refetch()}>{t("kn.retry")}</Button></div>}
        {unavailable && <p className="assistant-notice" role="alert">{t("assistant.unavailableHint")}</p>}
        {projects.isSuccess && !items.length && <p className="assistant-notice" role="status">{t("assistant.noProjects")}</p>}
        {chat.conversation?.deletedAt && <p className="assistant-notice" role="status">{t("assistant.deletedConversation")}</p>}
        <div className="assistant-conversation" role="log" aria-label={t("assistant.conversation")} aria-live="polite" aria-busy={!!pending} tabIndex={0}>
          <div className="assistant-reading-column">
            {chat.detail.hasNextPage && <Button variant="ghost" size="sm" loading={chat.detail.isFetchingNextPage} onClick={() => void chat.detail.fetchNextPage()}>{t("assistant.earlier")}</Button>}
            {empty && !conversationId && <div className="assistant-empty"><h2>{t("assistant.emptyTitle")}</h2><p>{t("assistant.emptyBody")}</p></div>}
            {messages.map((message, index) => <section className="assistant-turn" key={message.id} ref={index === messages.length - 1 ? latestTurn : undefined}>
              <AssistantMessage message={message} stream={chat.streamFor(message.requestId)} projects={items} accountId={accountId} canAct={canSend && !pending} onDecide={(actionId, decision) => chat.decide(message.requestId, actionId, decision)} canRetry={!pending && canSend} onRetry={() => void chat.submit(message.question, canSend, message.references)} />
            </section>)}
            {pending && !pendingIsListed && <section className="assistant-turn" ref={latestTurn}><AssistantMessage message={{ id: pending.requestId, conversationId: conversationId ?? "", requestId: pending.requestId, question: pending.question, status: "pending", reply: null, createdAt: "", updatedAt: "" }} stream={chat.streamFor(pending.requestId)} canRetry={false} onRetry={() => {}} /></section>}
          </div>
        </div>
        <div className="assistant-composer-wrap">
          {chat.error && <div className="assistant-notice" role="alert"><span>{chat.error}</span><Button size="sm" onClick={() => void chat.submit(undefined, canSend, referencesForSend())} disabled={!draft.trim() || !canSend}>{t("assistant.retry")}</Button></div>}
          {chat.cancelledBeforeSend && <p className="assistant-composer-status" role="status">{t("assistant.cancelled")}</p>}
          <AssistantArtifacts key={selectionKey} projects={items} scopeProject={scopeProject} value={selections[selectionKey] ?? noArtifacts} onChange={value => setSelections(old => ({ ...old, [selectionKey]: value }))} onRefsChange={changeReferences} disabled={!canSend || !!pending} />
          <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void chat.submit(undefined, canSend, referencesForSend()); }}>
            <label className="sr-only" htmlFor="assistant-question">{t("assistant.question")}</label>
            <textarea ref={input} id="assistant-question" className="textarea" rows={2} maxLength={1000} value={draft} readOnly={!!pending}
              placeholder={t("assistant.placeholder")} aria-describedby="assistant-input-hint" onChange={(event) => chat.setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void chat.submit(undefined, canSend, referencesForSend()); } }} />
            <div className="assistant-composer-actions">
              <div className="assistant-context">
                <Select leadingIcon={<Icon name={scopeProject ? "folder" : "layers"} size={15} />} ariaLabel={t("assistant.scope")} value={scopeProject ?? "all"}
                  disabled={projects.isPending || projects.isError || (!!conversationId && !chat.conversation)} searchable description={t("assistant.accessHint")} minPanelWidth={320}
                  options={[{ value: "all", label: t("assistant.all") }, ...(unavailable && scopeProject && !items.some((item) => item.id === scopeProject) ? [{ value: scopeProject, label: t("assistant.unavailable") }] : []), ...items.map((item) => ({ value: item.id, label: `${item.name} · ${item.key}` }))]}
                  onChange={(value) => { if (value !== (scopeProject ?? "all")) newConversation(value === "all" ? undefined : value); }} />
              </div>
              <div className="assistant-submit-actions">
                {draft.length >= 800 && <span className="assistant-character-count">{draft.length} / 1000</span>}
                {pending ? <Button key="stop" type="button" className="assistant-send assistant-stop" iconOnly aria-label={t("assistant.cancel")} title={t("assistant.cancel")}
                  onClick={(event) => { event.preventDefault(); void chat.cancel(); }}><span aria-hidden="true" /></Button>
                  : <Button key="send" type="submit" className="assistant-send" iconOnly aria-label={t("assistant.send")} title={t("assistant.send")} disabled={!draft.trim() || !canSend}><Icon name="arrow" size={18} /></Button>}
              </div>
            </div>
          </form>
          <div className="assistant-composer-footnote"><p className="assistant-session-hint" title={t("assistant.sessionHint")}>{t("assistant.sessionShort")}</p><p id="assistant-input-hint" className="assistant-submit-shortcut">{t("assistant.shortcut")}</p></div>
        </div>
      </div>
    </div>
  </div>;
}
