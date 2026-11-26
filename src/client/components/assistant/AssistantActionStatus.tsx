import { useEffect, useState } from "react";
import type { RagActionProposal } from "../../../shared/rag.ts";
import { agentStepStatus, type AgentRunStatus } from "../../../shared/agent-execution.ts";
import { t } from "../../i18n/index.ts";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";

export function useActionExpiryRefresh(actions: readonly RagActionProposal[]) {
  const [tick, setTick] = useState(0);
  const nextExpiry = Math.min(...actions.filter(action => action.status === "pending").map(action => Date.parse(action.expiresAt)).filter(expiry => Number.isFinite(expiry) && expiry > Date.now()));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setTick(v => v + 1), Math.min(Math.max(0, nextExpiry - Date.now()) + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [nextExpiry, tick]);
}
export function useActionExpired(action: RagActionProposal) {
  useActionExpiryRefresh([action]);
  return action.status === "expired" || action.status === "pending" && (!Number.isFinite(Date.parse(action.expiresAt)) || Date.parse(action.expiresAt) <= Date.now());
}
export function AssistantRunTag({ status }: { status: AgentRunStatus }) {
  const running = status === "RUNNING" || status === "QUEUED";
  const waiting = ["AWAITING_CONFIRMATION", "WAITING_APPROVAL", "EXECUTED", "UNCERTAIN", "PARTIAL"].includes(status);
  return <WorkItemTag kind="status" value={status === "VERIFIED" ? "DONE" : running ? "IN_PROGRESS" : "INITIAL"}
    stateKey={status === "FAILED" ? "FAILED" : waiting ? "WAIT" : undefined} label={t(`assistant.run.status.${status}`)} />;
}
export function AssistantActionStatus({ action, busy = false }: { action: RagActionProposal; busy?: boolean }) {
  useActionExpired(action);
  return <span role="status"><AssistantRunTag status={busy ? "RUNNING" : agentStepStatus(action)} /></span>;
}
export function actionNeedsRevision(action: RagActionProposal) {
  return ["CONFLICT", "VERSION_CONFLICT"].includes(action.lastFailure?.code ?? "");
}
export function AssistantActionFailure({ action }: { action: RagActionProposal }) {
  if (!action.lastFailure || action.status !== "pending") return null;
  return <p role="alert" className="assistant-action-error">{t(actionNeedsRevision(action) ? "assistant.run.conflict" : "assistant.run.failure")}</p>;
}
