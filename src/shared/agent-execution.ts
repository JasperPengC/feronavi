import type { RagActionProposal } from "./rag.ts";
import type { RagMessage } from "./rag-conversations.ts";

export type AgentStepStatus = "AWAITING_CONFIRMATION" | "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "VERIFIED" | "EXECUTED" | "FAILED" | "UNCERTAIN" | "CANCELLED" | "EXPIRED" | "SUPERSEDED";
export type AgentRunStatus = AgentStepStatus | "PARTIAL" | "EMPTY" | "UNAVAILABLE";
export interface AgentExecutionStep {
  stepId: string; toolName: string; title: string; status: AgentStepStatus;
  jobId: string | null; observedAt: string | null; resources: NonNullable<RagActionProposal["result"]>["resources"];
}
export interface AgentExecutionSummary {
  runId: string; status: AgentRunStatus; verifiedCount: number; remainingCount: number;
  createdAt: string; updatedAt: string; steps: AgentExecutionStep[];
}
export function agentStepStatus(action: RagActionProposal, now = Date.now()): AgentStepStatus {
  if (action.status === "rejected" && action.supersededById) return "SUPERSEDED";
  if (action.status === "confirmed") {
    if (action.result?.outcome === "approval_pending") return "WAITING_APPROVAL";
    return action.result && Number.isFinite(Date.parse(action.result.observedAt)) ? "VERIFIED" : "EXECUTED";
  }
  if (action.status === "pending") {
    const expiry = Date.parse(action.expiresAt);
    return !Number.isFinite(expiry) || expiry <= now ? "EXPIRED" : action.lastFailure ? "FAILED" : "AWAITING_CONFIRMATION";
  }
  return ({ queued: "QUEUED", running: "RUNNING", failed: "FAILED", uncertain: "UNCERTAIN", rejected: "CANCELLED", expired: "EXPIRED" } as const)[action.status];
}
/** 只投影已授权的持久消息，不根据模型正文猜测执行是否成功。 */
export function projectAgentExecution(message: RagMessage, now = Date.now()): AgentExecutionSummary {
  const steps = message.status === "unavailable" ? [] : (message.reply?.actions ?? []).map(action => ({
    stepId: action.id, toolName: action.toolName, title: action.presentation?.title ?? action.toolName,
    status: agentStepStatus(action, now),
    jobId: typeof action.result?.value.jobId === "string" ? action.result.value.jobId : null,
    observedAt: action.result?.observedAt ?? null, resources: action.result?.resources ?? [],
  }));
  const verifiedCount = steps.filter(s => s.status === "VERIFIED").length;
  const remainingCount = steps.filter(s => !["VERIFIED", "CANCELLED", "SUPERSEDED"].includes(s.status)).length;
  let status: AgentRunStatus = "EMPTY";
  if (message.status === "unavailable") status = "UNAVAILABLE";
  else if (message.status === "pending") status = "RUNNING";
  else if (message.status === "cancelled") status = "CANCELLED";
  else if (message.status === "failed" && !steps.length) status = "FAILED";
  else if (steps.length) {
    const active = (["RUNNING", "QUEUED", "UNCERTAIN", "WAITING_APPROVAL"] as const).find(s => steps.some(step => step.status === s));
    if (active) status = active;
    else if (verifiedCount && steps.every(s => ["VERIFIED", "SUPERSEDED"].includes(s.status))) status = "VERIFIED";
    else if (verifiedCount) status = "PARTIAL";
    else status = (["FAILED", "AWAITING_CONFIRMATION", "EXPIRED", "EXECUTED", "CANCELLED"] as const).find(s => steps.some(step => step.status === s)) ?? "EMPTY";
  }
  return { runId: message.requestId, status, verifiedCount, remainingCount, createdAt: message.createdAt, updatedAt: message.updatedAt, steps };
}
