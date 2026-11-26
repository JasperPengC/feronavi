import { useRef, useState, type ComponentType, type ReactNode } from "react";
import type { RagActionProposal, RagProject, RagResourceKind } from "../../../shared/rag.ts";
import { ApiError } from "../../lib/api.ts";
import { getLocale, t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { AssistantActionStatus, AssistantActionFailure, actionNeedsRevision, useActionExpired } from "./AssistantActionStatus.tsx";

type Resource = ComponentType<{ projectId: string | null; kind: RagResourceKind; id: string; children: ReactNode }>;
const fieldKeys: Record<string, string> = {
  title: "assistant.field.title", name: "assistant.field.name", description: "assistant.field.description", body: "assistant.field.body", content: "assistant.field.content",
  startDate: "assistant.field.startDate", dueDate: "assistant.field.dueDate", endDate: "assistant.field.endDate", releaseDate: "assistant.field.releaseDate",
  notes: "assistant.field.notes", note: "assistant.field.notes", progressMode: "assistant.field.progressMode", progressValue: "assistant.field.progressValue",
  key: "assistant.closure.fact.key", status: "assistant.closure.fact.status", statusName: "assistant.closure.fact.status", state: "assistant.closure.fact.status",
  total: "assistant.closure.fact.total", count: "assistant.closure.fact.total", items: "assistant.closure.fact.records", rows: "assistant.closure.fact.records", data: "assistant.closure.fact.records",
  workItem: "assistant.closure.fact.workItem", workItems: "assistant.closure.fact.workItems", source: "assistant.closure.fact.source", target: "assistant.closure.fact.target",
  sourceWorkItem: "assistant.closure.fact.source", targetWorkItem: "assistant.closure.fact.target", other: "assistant.closure.fact.related", relatedWorkItem: "assistant.closure.fact.related",
  relationType: "assistant.closure.fact.relation", type: "assistant.closure.fact.type", direction: "assistant.closure.fact.direction", relations: "assistant.closure.fact.relations",
  idea: "assistant.closure.fact.idea", votes: "assistant.closure.fact.votes", score: "assistant.closure.fact.score", voteCount: "assistant.closure.fact.votes", myVote: "assistant.closure.fact.myVote",
  collaborators: "assistant.closure.fact.collaborators", watchers: "assistant.closure.fact.watchers", member: "assistant.closure.fact.member", memberName: "assistant.closure.fact.member", username: "assistant.closure.fact.member",
  channels: "assistant.closure.fact.channels", minutes: "assistant.closure.fact.minutes", loggedDate: "assistant.closure.fact.loggedDate", timeLogs: "assistant.closure.fact.timeLogs",
  progressUpdates: "assistant.closure.fact.progressUpdates", summary: "assistant.closure.fact.summary", completed: "assistant.closure.fact.completed", completedAt: "assistant.closure.fact.completedAt",
  createdAt: "assistant.closure.fact.createdAt", updatedAt: "assistant.closure.fact.updatedAt", observedAt: "assistant.closure.fact.observedAt", restoredAt: "assistant.closure.fact.restoredAt",
  milestone: "assistant.closure.fact.milestone", milestones: "assistant.closure.fact.milestone", iteration: "assistant.closure.fact.iteration", iterations: "assistant.closure.fact.iteration", release: "assistant.closure.fact.release", releases: "assistant.closure.fact.release",
  page: "assistant.closure.fact.page", revisions: "assistant.closure.fact.revisions", revision: "assistant.closure.fact.revisions", changeSummary: "assistant.field.changeSummary",
  truncated: "assistant.closure.fact.truncated", pageSize: "assistant.closure.fact.pageSize", totalMinutes: "assistant.closure.fact.totalMinutes", percentage: "assistant.field.progressValue",
  blocks: "assistant.closure.fact.blocks", blockedBy: "assistant.closure.fact.blockedBy", others: "assistant.closure.fact.others",
  updates: "assistant.closure.fact.progressUpdates", nextSteps: "assistant.closure.fact.nextSteps", blockers: "assistant.closure.fact.blockers", authorName: "assistant.closure.fact.author",
  archivedAt: "assistant.closure.fact.archivedAt", carryOver: "assistant.field.carryOver", assigneeName: "assistant.closure.fact.assignee", transfers: "assistant.closure.fact.transfers",
  fromName: "assistant.closure.fact.fromMember", toName: "assistant.closure.fact.toMember", reason: "assistant.closure.fact.reason", weight: "assistant.closure.fact.weight",
  capacityHours: "assistant.closure.fact.capacity", capacities: "assistant.closure.fact.capacities", values: "assistant.closure.fact.values", definitions: "assistant.closure.fact.definitions",
  paused: "assistant.closure.fact.paused", pausedAt: "assistant.closure.fact.pausedAt", approvals: "assistant.closure.fact.approvals", requests: "assistant.closure.fact.approvals",
  sortOrder: "assistant.closure.fact.sortOrder", completionResult: "assistant.closure.fact.completionResult",
  carriedOverCount: "assistant.closure.fact.carriedOverCount", remainingCount: "assistant.closure.fact.remainingCount",
};
const readLabels: Record<string, string> = {
  "workitem.get": "assistant.closure.fact.workItem", "workitem.list": "assistant.closure.fact.workItems", "workitem.relations": "assistant.closure.fact.relations", "workitem.transfers": "assistant.closure.fact.transfers",
  "workitem.collaborators": "assistant.closure.fact.collaborators", "workitem.progressUpdates": "assistant.closure.fact.progressUpdates", "workitem.watchers": "assistant.closure.fact.watchers",
  "page.get": "assistant.closure.fact.page", "idea.get": "assistant.closure.fact.idea", "idea.list": "assistant.closure.fact.idea", "timeLog.list": "assistant.closure.fact.timeLogs",
  "plan.getIteration": "assistant.closure.fact.iteration", "plan.getRelease": "assistant.closure.fact.release", "plan.getMilestone": "assistant.closure.fact.milestone", "plan.milestoneDetail": "assistant.closure.fact.milestone",
  "plan.iterationCapacity": "assistant.closure.fact.capacities", "customField.getValues": "assistant.closure.fact.values", "customField.definitions": "assistant.closure.fact.definitions", "approval.list": "assistant.closure.fact.approvals",
};
const valueKeys: Record<string, string> = {
  MANUAL: "assistant.value.progressMode.MANUAL", COUNT: "assistant.value.progressMode.COUNT", ESTIMATE_WEIGHTED: "assistant.value.progressMode.ESTIMATE_WEIGHTED",
  NEW: "ideas.stNew", UNDER_REVIEW: "ideas.stReview", PLANNED: "ideas.stPlanned", REJECTED: "ideas.stRejected",
  BLOCKS: "assistant.closure.value.blocks", BLOCKED_BY: "assistant.closure.value.blockedBy", RELATES_TO: "assistant.closure.value.relatesTo", DUPLICATES: "assistant.closure.value.duplicates",
  IN_APP: "assistant.closure.value.inApp", EMAIL: "assistant.closure.value.email", ACTIVE: "assistant.closure.value.active", COMPLETED: "assistant.closure.value.completed", ARCHIVED: "assistant.closure.value.archived",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const internal = (key: string) => key === "id" || /Ids?$/.test(key) || ["fingerprint", "version", "expectedVersion", "allowedTransitions", "idempotencyKey"].includes(key);
function stamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getLocale());
}
function Text({ value }: { value: string }) {
  if (value.length <= 280 && value.split("\n").length <= 5) return <>{value}</>;
  return <details className="assistant-action-content"><summary>{value.slice(0, 180)}… <span>{t("assistant.action.fullContent")}</span></summary><p>{value}</p></details>;
}

/** 复读可能返回集合、包装对象或统计值，不能假定它是写入对象。 */
function Facts({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <>{t("assistant.value.empty")}</>;
  if (typeof value === "boolean") return <>{t(value ? "assistant.closure.value.yes" : "assistant.closure.value.no")}</>;
  if (typeof value === "number") return <>{value.toLocaleString(getLocale())}</>;
  if (typeof value === "string") return <Text value={uuid.test(value) ? t("assistant.closure.reference") : valueKeys[value] ? t(valueKeys[value]) : value} />;
  if (Array.isArray(value)) return <div><p className="assistant-action-expiry">{t("assistant.closure.recordCount", { count: value.length })}</p>{value.length > 0 && <ol>{value.map((item, index) => <li key={index}><Facts value={item} /></li>)}</ol>}</div>;
  if (typeof value !== "object") return null;
  const fields = Object.entries(value).filter(([key]) => !internal(key));
  return fields.length ? <dl className="assistant-action-changes">{fields.map(([key, item]) => <div key={key}><dt>{t(key === "page" && typeof item === "number" ? "assistant.closure.fact.pageNumber" : fieldKeys[key] ?? "assistant.closure.fact.other")}</dt><dd><Facts value={key.endsWith("At") && typeof item === "string" ? stamp(item) : item} /></dd></div>)}</dl> : <>{t("assistant.closure.reference")}</>;
}

export function ClosureAssistantAction({ action, projects, canAct, onDecide, ResourceLink }: {
  action: RagActionProposal; accountId: string; projects: RagProject[]; canAct: boolean;
  onDecide: (id: string, decision: "confirm" | "reject") => Promise<void>; ResourceLink: Resource;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<{ message: string; blocked: boolean }>();
  const expired = useActionExpired(action);
  const pending = action.status === "pending" && !expired;
  const presentation = action.presentation!;
  const preview = action.target?.preview;
  const targetName = [preview?.title, preview?.name, preview?.body].find((value): value is string => typeof value === "string" && !!value.trim());
  const targetKey = typeof preview?.key === "string" ? preview.key : undefined;
  const observed = action.result?.value.observations;
  const observations = Array.isArray(observed) ? observed.filter((value): value is { toolName: string; value: unknown } => !!value && typeof value === "object" && typeof value.toolName === "string" && "value" in value) : [];
  async function decide(decision: "confirm" | "reject") {
    if (lock.current || !canAct || !pending || decision === "confirm" && error?.blocked || actionNeedsRevision(action) || Date.parse(action.expiresAt) <= Date.now()) return;
    lock.current = true; setBusy(true); setError(undefined);
    try { await onDecide(action.id, decision); }
    catch (cause) { setError({ message: cause instanceof ApiError ? cause.message : t("assistant.action.retryHint"), blocked: cause instanceof ApiError && ([401, 403, 404, 409, 410].includes(cause.status) || ["CONFLICT", "VERSION_CONFLICT", "NOT_FOUND", "FORBIDDEN", "EXPIRED"].includes(cause.code)) }); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="assistant-action" aria-label={presentation.title}>
    <div className="assistant-action-heading"><h3>{presentation.title}</h3><AssistantActionStatus action={action} busy={busy} /></div>
    <AssistantActionFailure action={action} />
    <p className="assistant-action-project">{action.projectId ? projects.find(project => project.id === action.projectId)?.name ?? t("assistant.project") : t(`assistant.scope.${action.scope?.kind ?? "account"}`)}</p>
    {action.target && targetName && <p className="assistant-action-target"><ResourceLink projectId={action.projectId} kind={action.target.kind} id={action.target.id}>{targetKey ? `${targetKey} · ${targetName}` : targetName}</ResourceLink></p>}
    <dl className="assistant-action-changes">{presentation.fields.map((field, index) => <div key={index}><dt>{field.label}</dt><dd><Text value={field.value} /></dd></div>)}</dl>
    {pending && <p className="assistant-action-expiry">{t("assistant.action.serverRecheck")}</p>}
    {!action.lastFailure && error?.blocked && <p className="assistant-action-error" role="alert">{t("assistant.action.changed")}</p>}
    {!action.lastFailure && error && <p className="assistant-action-error" role="alert">{error.message}</p>}
    {pending && <div className="assistant-action-controls"><Button size="sm" disabled={!canAct || busy || error?.blocked || actionNeedsRevision(action)} onClick={() => void decide("confirm")}>{error && !error.blocked ? t("assistant.action.retry") : t("assistant.action.confirm")}</Button><Button size="sm" variant="ghost" disabled={!canAct || busy} onClick={() => void decide("reject")}>{t("assistant.action.reject")}</Button></div>}
    {pending && <p className="assistant-action-expiry">{t("assistant.action.expires", { time: stamp(action.expiresAt) })}</p>}
    {action.result && <section className="assistant-action-facts" aria-label={t("assistant.closure.result")}><h4>{t("assistant.closure.result")}</h4><p className="assistant-action-expiry">{t("assistant.observedAt", { time: stamp(action.result.observedAt) })}</p>
      {observations.length ? observations.map((observation, index) => {
        const label = readLabels[observation.toolName];
        return <div className="assistant-action-observation" key={`${observation.toolName}:${index}`}><h5>{label ? t(label) : t("assistant.closure.observation", { index: index + 1 })}</h5><Facts value={observation.value} /></div>;
      }) : <Facts value={action.result.value} />}
    </section>}
    <details className="assistant-error-details"><summary>{t("assistant.errorDetails")}</summary><p>{action.toolName} · {action.id}</p><pre>{JSON.stringify({ parameters: action.parameters, result: action.result }, null, 2)}</pre></details>
  </section>;
}
