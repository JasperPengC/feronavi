import { useRef, useState } from "react";
import type { RagMessage } from "../../../shared/rag-conversations.ts";
import { projectAgentExecution } from "../../../shared/agent-execution.ts";
import { getLocale, t } from "../../i18n/index.ts";
import { ApiError } from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../Icon.tsx";
import { AssistantRunTag, useActionExpiryRefresh } from "./AssistantActionStatus.tsx";
function stepTitle(toolName: string, title: string) {
  if (title !== toolName) return title;
  const work = /^workitem\.(create|update|assign|transition)$/.exec(toolName);
  if (work) return t(`assistant.action.${work[1]}`);
  if (toolName === "workitem.comment") return t("assistant.action.create.comment");
  const content = /^(page|comment)\.(create|update)$/.exec(toolName);
  if (content) return t(`assistant.action.${content[2]}.${content[1]}`);
  const plan = /^plan\.(create|update)(Milestone|Iteration|Release|Module)$/.exec(toolName);
  if (plan) return t(`assistant.action.${plan[1]}.${plan[2]!.toLowerCase()}`);
  return t("assistant.run.operation");
}

export function AssistantExecution({ message, onRefresh }: { message: RagMessage; onRefresh?: () => Promise<void> }) {
  useActionExpiryRefresh(message.reply?.actions ?? []);
  const run = projectAgentExecution(message);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const lock = useRef(false);
  if (!run.steps.length) return null;
  async function refresh() {
    if (!onRefresh || lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    try { await onRefresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : t("assistant.run.readFailed")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="assistant-execution" aria-label={t("assistant.run.title")}>
    <div className="assistant-execution-heading"><strong>{t("assistant.run.title")}</strong><AssistantRunTag status={run.status} />
      <span className="assistant-execution-count">{t("assistant.run.count", { verified: run.verifiedCount, remaining: run.remainingCount })}</span>
      {onRefresh && <Button size="sm" variant="ghost" loading={busy} onClick={() => void refresh()}><Icon name="refresh" size={13} />{t("assistant.run.refresh")}</Button>}
    </div>
    {error && <p role="alert" className="assistant-action-error">{error}</p>}
    <details className="assistant-execution-details"><summary>{t("assistant.run.steps", { count: run.steps.length })}</summary>
      <ol>{run.steps.map((step, index) => <li key={step.stepId}>
        <a href={`#assistant-action-${step.stepId}`}>{t("assistant.run.step", { index: index + 1 })} · {stepTitle(step.toolName, step.title)}</a><AssistantRunTag status={step.status} />
      </li>)}</ol>
      <p>{t("assistant.run.id")} <code>{run.runId}</code></p>
      <p>{t("assistant.run.updated", { time: new Date(run.updatedAt).toLocaleString(getLocale()) })}</p>
      <p>{t("assistant.run.historyHint")}</p>
    </details>
  </section>;
}
