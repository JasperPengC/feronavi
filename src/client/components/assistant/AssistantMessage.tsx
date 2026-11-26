import { Link } from "@tanstack/react-router";
import { Icon } from "../Icon.tsx";
import { Button } from "../ui/Button.tsx";
import { MarkdownView } from "../ui/MarkdownView.tsx";
import { t } from "../../i18n/index.ts";
import type { RagMessage } from "../../../shared/rag-conversations.ts";
import type { RagChatResult } from "../../../shared/rag.ts";
import type { RagProject } from "../../../shared/rag.ts";
import type { AssistantStreamState } from "./useRagConversation.ts";
import { AssistantAction, BusinessEvidence, toolLabel } from "./AssistantBusiness.tsx";
import { AssistantExecution } from "./AssistantExecution.tsx";
import { useCan } from "../../lib/actor.ts";

function answerNote(reply: RagChatResult) {
  if (!reply.ok && !reply.answer) {
    if (/timeout|timed out|超时/i.test(reply.note ?? "")) return t("assistant.providerTimeout");
    if (/^调用失败|^模型服务返回/.test(reply.note ?? "")) return t("assistant.providerFailed");
  }
  return reply.note ?? t("assistant.noAnswer");
}
export function AssistantMessage({ message, canRetry, onRetry, stream, projects = [], accountId = "", canAct = false, onDecide, onRefresh }: { message: RagMessage; canRetry: boolean; onRetry: () => void; onRefresh?: () => Promise<void>;
  stream?: AssistantStreamState; projects?: RagProject[]; accountId?: string; canAct?: boolean; onDecide?: (actionId: string, decision: "confirm" | "reject") => Promise<void> }) {
  const reply = message.status === "unavailable" ? null : message.reply;
  const canConfigure = useCan("ai:configure");
  const needsModel = !!reply && !reply.ok && !reply.answer && /^未配置对话模型/.test(reply.note ?? "");
  const note = needsModel ? t(canConfigure ? "assistant.modelSetup" : "assistant.modelSetupAdmin") : reply ? answerNote(reply) : "";
  return <>
    {message.question && <p className="assistant-question">{message.question}</p>}
    {message.status === "pending" && <>
      <p className="assistant-pending" role="status"><span className="ui-button-spinner" aria-hidden="true" />{stream ? stream.phase === "tool" ? t("assistant.stream.tool", { tool: toolLabel(stream.toolName) }) : t(`assistant.stream.${stream.phase}`) : t("assistant.pending")}</p>
      {stream?.text && <MarkdownView text={stream.text} streaming />}
      {stream?.error && <p className="assistant-answer-note" role="alert">{stream.error}</p>}
    </>}
    {message.status === "cancelled" && <p className="assistant-answer-note" role="status">{t("assistant.cancelled")}</p>}
    {message.status === "unavailable" && <p className="assistant-answer-note" role="status">{t("assistant.historyUnavailable")}</p>}
    {message.status === "failed" && !reply && <p className="assistant-answer-note" role="alert">{t("assistant.failed")}</p>}
    {reply?.answer && <MarkdownView text={reply.answer} citations={reply.citations.map(citation => ({ href: `/projects/${encodeURIComponent(citation.projectId)}/wiki?page=${encodeURIComponent(citation.pageId)}`, label: `${citation.projectName} · ${citation.title}` }))} />}
    <div className={message.status === "failed" ? "assistant-failure" : undefined}>
    {reply && (reply.note || !reply.answer && !reply.actions?.length) && <p className="assistant-answer-note" role={!reply.ok ? "alert" : undefined}>{note}</p>}
    {needsModel && canConfigure && <Link to="/settings/integrations" className="btn btn-sm">{t("assistant.configureModel")}</Link>}
    {reply && !reply.ok && reply.note && note !== reply.note && <details className="assistant-error-details"><summary><Icon name="chevron-down" size={12} />{t("assistant.errorDetails")}</summary><p>{reply.note}</p></details>}
    {message.status === "failed" && <Button variant="ghost" size="sm" className="assistant-retry" disabled={!canRetry} onClick={onRetry}><Icon name="refresh" size={14} />{t("assistant.retry")}</Button>}
    </div>
    {!!reply?.actions?.length && <><AssistantExecution message={message} onRefresh={onRefresh} /><div className="assistant-actions">{reply.actions.map(action => <div key={action.id} id={`assistant-action-${action.id}`} tabIndex={-1}><AssistantAction action={action} accountId={accountId} projects={projects} canAct={canAct} onDecide={(actionId, decision) => onDecide?.(actionId, decision) ?? Promise.resolve()} /></div>)}</div></>}
    {!!reply?.evidence?.length && <BusinessEvidence evidence={reply.evidence} projects={projects} />}
    {!!reply?.citations.length && <details className="assistant-sources">
      <summary title={t(`assistant.mode.${reply.mode}`)}><Icon name="book" size={14} />{t("assistant.sources", { count: reply.citations.length })}<Icon name="chevron-down" size={12} /></summary>
      <ol>{reply.citations.map((citation, sourceIndex) => <li key={`${citation.pageId}-${sourceIndex}`}>
        <Link to="/projects/$projectId/wiki" params={{ projectId: citation.projectId }} search={{ page: citation.pageId }} className="assistant-source-link">
          <span className="assistant-source-number">[{sourceIndex + 1}]</span><span className="assistant-source-project">{citation.projectName}</span><span className="assistant-source-title">{citation.title}</span><Icon name="arrow" size={14} />
        </Link>
        {citation.headingPath && <p className="assistant-source-heading">{citation.headingPath}</p>}
        <p className="assistant-source-snippet">{citation.snippet}</p>
      </li>)}</ol>
    </details>}
  </>;
}
