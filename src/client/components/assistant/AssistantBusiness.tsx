import { useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "../../lib/api.ts";
import { useActor } from "../../lib/actor.ts";
import { t, getLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { AssistantActionStatus, AssistantActionFailure, actionNeedsRevision, useActionExpired } from "./AssistantActionStatus.tsx";
import { Icon } from "../Icon.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { GenericAssistantAction, AssistantActionText } from "./GenericAssistantAction.tsx";
import { ClosureAssistantAction } from "./ClosureAssistantAction.tsx";
import { WorkItemDrawer } from "../work-item/DeferredWorkItemDrawer.tsx";
import type { RagActionProposal, RagBusinessEvidence, RagProject } from "../../../shared/rag.ts";

const readTools: Record<string, string> = { "project.get": "project", "project.members": "members", "workitem.list": "list", "workitem.get": "item", "plan.listMilestones": "milestones", "plan.getMilestone": "milestones", "plan.listIterations": "iterations", "plan.listReleases": "releases", "meta.workflow": "workflow", "knowledge.search": "knowledge", "page.get": "page" };
export function toolLabel(tool?: string) { return t(`assistant.tool.${readTools[tool ?? ""] ?? "query"}`); }
function projectLabel(projects: RagProject[], id: string | null) { return id ? projects.find(project => project.id === id)?.name ?? t("assistant.project") : t("assistant.scope.account"); }
function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getLocale());
}
function resourceHref(projectId: string | null, kind: RagBusinessEvidence["resources"][number]["kind"], id: string) {
  if (!projectId) return undefined;
  const project = `/projects/${encodeURIComponent(projectId)}`;
  if (kind === "page") return `${project}/wiki?page=${encodeURIComponent(id)}`;
  if (kind === "milestone") return `${project}/milestones/${encodeURIComponent(id)}`;
  if (kind === "idea") return `${project}/ideas`;
  return undefined;
}
function ResourceLink({ projectId, kind, id, children }: { projectId: string | null; kind: RagBusinessEvidence["resources"][number]["kind"]; id: string; children: ReactNode }) {
  const accountId = useActor().memberId;
  const [open, setOpen] = useState(false);
  const preview = useQuery({ queryKey: ["assistant-resource", accountId, projectId, kind, id], enabled: open && (kind === "iteration" || kind === "release" || kind === "module"), retry: false,
    queryFn: () => apiGet<{ name: string; description?: string | null; startDate?: string | null; endDate?: string | null; releaseDate?: string | null }>(`/api/v1/${kind}s/${encodeURIComponent(id)}`) });
  const inline = kind === "workItem" || kind === "iteration" || kind === "release" || kind === "module";
  return <>{kind === "comment" ? <span>{children}</span> : inline ? <button type="button" className="assistant-resource-button" onClick={() => setOpen(true)}>{children}</button> : <a href={resourceHref(projectId, kind, id)}>{children}</a>}
    {kind === "workItem" && open && <WorkItemDrawer workItemId={id} onClose={() => setOpen(false)} />}
    {(kind === "iteration" || kind === "release" || kind === "module") && open && <Drawer open onClose={() => setOpen(false)} title={t(`assistant.resource.${kind}`)}>
      {preview.isPending && <p role="status">{t("assistant.loading")}</p>}
      {preview.isError && <div role="alert"><p>{preview.error instanceof ApiError ? preview.error.message : t("assistant.actionFailed")}</p><Button onClick={() => void preview.refetch()}>{t("kn.retry")}</Button></div>}
      {preview.isSuccess && <><h3>{preview.data.name}</h3><p>{preview.data.description}</p><p>{[preview.data.startDate, preview.data.endDate, preview.data.releaseDate].filter(Boolean).join(" · ")}</p></>}
    </Drawer>}
  </>;
}
export function BusinessEvidence({ evidence, projects }: { evidence: RagBusinessEvidence[]; projects: RagProject[] }) {
  if (!evidence.length) return null;
  const groups = new Map<string | null, RagBusinessEvidence[]>();
  for (const row of evidence) groups.set(row.projectId, [...(groups.get(row.projectId) ?? []), row]);
  const latest = evidence.map(row => row.observedAt).sort().at(-1)!;
  return <details className="assistant-sources assistant-evidence">
    <summary><Icon name="layers" size={14} />{t("assistant.evidence", { count: evidence.length })}<Icon name="chevron-down" size={12} /></summary>
    <p className="assistant-evidence-time">{t("assistant.observedAt", { time: timeLabel(latest) })}</p>
    {[...groups].map(([projectId, rows]) => <div className="assistant-evidence-group" key={projectId}>
      <h3>{projectId ? projectLabel(projects, projectId) : t(`assistant.scope.${rows[0]?.scope?.kind ?? "account"}`)}</h3>
      <ul>{rows.map(row => <li key={row.id}><span className="assistant-evidence-source">{toolLabel(row.toolName)}</span><p>{row.summary}</p>
        {row.resources.map(resource => <ResourceLink key={`${resource.kind}:${resource.id}`} projectId={projectId} kind={resource.kind} id={resource.id}>{t(`assistant.resource.${resource.kind}`)}<Icon name="arrow" size={12} /></ResourceLink>)}
        <details className="assistant-error-details"><summary>{t("assistant.errorDetails")}</summary><p>{row.toolName} · {timeLabel(row.observedAt)}</p></details>
      </li>)}</ul>
    </div>)}
  </details>;
}

interface Target extends Record<string, unknown> { id: string; key: string; title: string; projectId: string; version: number; statusName?: string; allowedTransitions?: { toStateKey: string; toName: string }[] }
interface Member { id: string; name: string; username: string }
type RelationKind = "workItem" | "milestone" | "iteration" | "release" | "module";
interface RelationResource { id: string; projectId: string; name?: string; key?: string; title?: string; description?: string | null }
const relationFields: Record<string, RelationKind> = { parentId: "workItem", milestoneId: "milestone", iterationId: "iteration", releaseId: "release", moduleId: "module" };
function RelationName({ resource, kind, label }: { resource: RelationResource; kind: RelationKind; label: string }) {
  const [open, setOpen] = useState(false);
  return <><Button size="sm" variant="ghost" className="assistant-relation-link" onClick={() => setOpen(true)}>{label}<Icon name="arrow" size={12} /></Button>
    {open && kind === "workItem" && <WorkItemDrawer workItemId={resource.id} onClose={() => setOpen(false)} />}
    {open && kind !== "workItem" && <Drawer open onClose={() => setOpen(false)} title={t(`assistant.resource.${kind}`)}><h3>{resource.name}</h3>{resource.description && <p>{resource.description}</p>}</Drawer>}
  </>;
}
const internalFields = new Set(["workItemId", "projectId", "expectedVersion", "version", "idempotencyKey"]);
const fields = new Set(["title", "description", "assigneeId", "priority", "severity", "estimatePoints", "estimateHours", "startDate", "dueDate", "parentId", "milestoneId", "iterationId", "releaseId", "moduleId", "type", "toStateKey", "comment"]);
function WorkItemAction({ action, accountId, projects, canAct, onDecide }: {
  action: RagActionProposal; accountId: string; projects: RagProject[]; canAct: boolean;
  onDecide: (actionId: string, decision: "confirm" | "reject") => Promise<void>;
}) {
  const target = useQuery({ queryKey: ["assistant-action-target", accountId, action.projectId, action.targetId], enabled: !!action.targetId,
    queryFn: () => apiGet<Target>(`/api/v1/work-items/${encodeURIComponent(action.targetId!)}`), retry: false });
  // assign 缺省 assigneeId 的服务端语义是解除指派；仅补全展示，不改变原参数。
  const displayParameters = action.toolName === "workitem.assign" ? { ...action.parameters, assigneeId: action.parameters.assigneeId ?? null } : action.parameters;
  const needsMembers = "assigneeId" in displayParameters;
  const members = useQuery({ queryKey: ["assistant-action-members", accountId, action.projectId], enabled: needsMembers,
    queryFn: () => apiGet<{ members: Member[] }>(`/api/v1/projects/${encodeURIComponent(action.projectId!)}/members`), retry: false });
  // 名称补全只用项目业务读取；工作流管理权限不应成为合法流转的门槛。
  const statusName = useQuery({ queryKey: ["assistant-action-status", accountId, action.projectId, action.targetId, target.data?.version], enabled: action.toolName === "workitem.transition" && target.isSuccess,
    queryFn: async () => {
      const board = await apiGet<{ columns: { stateKey: string; name: string; items: { id: string; version: number }[] }[] }>(`/api/v1/projects/${encodeURIComponent(action.projectId!)}/work-items/board`, { q: target.data!.key, pageSizePerColumn: 100 });
      const column = board.columns.find(column => column.items.some(item => item.id === action.targetId && item.version === target.data!.version));
      return column ? { name: column.name, stateKey: column.stateKey } : null;
    }, retry: false });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<{ message: string; blocked: boolean }>();
  const current = target.isSuccess && target.data.projectId === action.projectId ? target.data : undefined;
  const referenceIds = new Map<string, { kind: RelationKind; id: string }>();
  for (const [field, next] of Object.entries(displayParameters)) {
    const kind = relationFields[field];
    if (!kind) continue;
    for (const id of [next, ...(action.status !== "confirmed" ? [current?.[field]] : [])]) {
      if (typeof id === "string" && id) referenceIds.set(`${kind}:${id}`, { kind, id });
    }
  }
  const references = [...referenceIds.values()];
  const referenceQueries = useQueries({ queries: references.map(({ kind, id }) => ({
    queryKey: ["assistant-action-reference", accountId, action.projectId, kind, id], retry: false,
    queryFn: async () => {
      const segment = kind === "workItem" ? "work-items" : `${kind}s`;
      const row = await apiGet<RelationResource>(`/api/v1/${segment}/${encodeURIComponent(id)}`);
      // API可读不代表建议关联合法；也核对项目与可识别名称，绝不拿ID替代业务名称。
      const label = kind === "workItem" ? row.key && row.title ? `${row.key} · ${row.title}` : undefined : row.name;
      if (row.projectId !== action.projectId || row.id !== id || !label?.trim()) throw new Error("Related resource unavailable");
      return { row, label };
    },
  })) });
  const referencesLoading = referenceQueries.some(query => query.isPending);
  const referencesFailed = referenceQueries.some(query => query.isError);
  const transitionAllowed = action.toolName !== "workitem.transition" || current?.allowedTransitions?.some(state => state.toStateKey === action.parameters.toStateKey);
  const inaccessible = !!action.targetId && (target.isError || (target.isSuccess && !current));
  const loading = !!action.targetId && target.isPending;
  const changed = !!current && action.expectedVersion !== null && current.version !== action.expectedVersion;
  const expired = useActionExpired(action);
  const pending = action.status === "pending" && !expired;
  const approvalSubmitted = action.result?.outcome === "approval_pending";
  const name = t(`assistant.action.${action.toolName.split(".").at(-1)}`);
  function value(field: string, input: unknown) {
    if (field === "assigneeId" && (input === null || input === undefined || input === "")) return t("assistant.value.unassigned");
    if (input === null || input === undefined || input === "") return t("assistant.value.empty");
    if (field === "description" || field === "comment") return <AssistantActionText text={String(input)} />;
    const kind = relationFields[field];
    if (kind && typeof input === "string") {
      const index = references.findIndex(ref => ref.kind === kind && ref.id === input);
      const query = referenceQueries[index];
      return query?.isSuccess ? <RelationName resource={query.data.row} kind={kind} label={query.data.label} /> : t(query?.isError ? "assistant.value.referenceUnavailable" : "assistant.value.referenceLoading");
    }
    if (field === "priority" || field === "severity") return <WorkItemTag kind={field} value={String(input)} />;
    if (field === "type") return t(`type.${String(input)}`);
    if (field === "assigneeId") return members.data?.members.find(member => member.id === input)?.name ?? t("assistant.value.memberUnknown");
    if (field === "toStateKey") return current?.allowedTransitions?.find(state => state.toStateKey === input)?.toName ?? (action.status === "confirmed" && statusName.data && statusName.data.stateKey === input ? statusName.data.name : t("assistant.value.stateUnavailable"));
    return typeof input === "object" ? JSON.stringify(input) : String(input);
  }
  async function decide(decision: "confirm" | "reject") {
    if (lock.current || !canAct) return;
    lock.current = true; setBusy(true); setError(undefined);
    try { await onDecide(action.id, decision); }
    catch (cause) { setError({ message: cause instanceof ApiError ? cause.message : t("assistant.action.retryHint"), blocked: cause instanceof ApiError && ["CONFLICT", "VERSION_CONFLICT", "NOT_FOUND", "FORBIDDEN"].includes(cause.code) }); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="assistant-action" aria-label={name}>
    <div className="assistant-action-heading"><h3>{name}</h3><AssistantActionStatus action={action} busy={busy} /></div>
    <AssistantActionFailure action={action} />
    <p className="assistant-action-project">{projectLabel(projects, action.projectId)}</p>
    {loading ? <p role="status">{t("assistant.action.loadingTarget")}</p> : inaccessible ? <p role="alert">{t("assistant.action.unavailable")}</p> : <>
      {current && <p className="assistant-action-target"><ResourceLink projectId={action.projectId} kind="workItem" id={current.id}>{current.key}</ResourceLink><span>{current.title}</span></p>}
      <dl className="assistant-action-changes">{Object.entries(displayParameters).filter(([field]) => !internalFields.has(field)).map(([field, next]) => <div key={field}>
        <dt>{approvalSubmitted && field === "toStateKey" ? t("assistant.action.requestedState") : fields.has(field) ? t(`assistant.field.${field}`) : field}</dt><dd>
          {current && action.status !== "confirmed" && <><span className="assistant-action-old">{field === "toStateKey" ? current.statusName ?? statusName.data?.name ?? t("assistant.value.stateUnavailable") : value(field, current[field])}</span><span aria-label={t("assistant.action.changesTo")} className="assistant-change-arrow">→</span></>}
          <span>{value(field, next)}</span>
        </dd>
      </div>)}</dl>
      {approvalSubmitted && <p className="assistant-action-expiry" role="status">{t("assistant.action.approvalUnchanged", { state: current?.statusName ?? statusName.data?.name ?? t("assistant.value.stateUnavailable") })}</p>}
      {!action.lastFailure && (changed && pending || error?.blocked) && <p className="assistant-action-error" role="alert">{t("assistant.action.changed")}</p>}
      {pending && referencesLoading && <p role="status">{t("assistant.action.referencesLoading")}</p>}
      {pending && referencesFailed && <p className="assistant-action-error" role="alert">{t("assistant.action.referencesUnavailable")}</p>}
      {!action.lastFailure && error && <p className="assistant-action-error" role="alert">{error.message}</p>}
      {pending && <div className="assistant-action-controls"><Button size="sm" disabled={!canAct || busy || changed || error?.blocked || actionNeedsRevision(action) || (needsMembers && !members.isSuccess) || !transitionAllowed || referencesLoading || referencesFailed} onClick={() => void decide("confirm")}>{error && !error.blocked ? t("assistant.action.retry") : t("assistant.action.confirm")}</Button>
        <Button size="sm" variant="ghost" disabled={!canAct || busy} onClick={() => void decide("reject")}>{t("assistant.action.reject")}</Button></div>}
      {pending && <p className="assistant-action-expiry">{t("assistant.action.expires", { time: timeLabel(action.expiresAt) })}</p>}
      <details className="assistant-error-details"><summary>{t("assistant.errorDetails")}</summary><p>{action.toolName} · {action.id}</p><pre>{JSON.stringify(action.parameters, null, 2)}</pre></details>
    </>}
  </section>;
}

export function AssistantAction(props: { action: RagActionProposal; accountId: string; projects: RagProject[]; canAct: boolean; onDecide: (actionId: string, decision: "confirm" | "reject") => Promise<void> }) {
  if (props.action.presentation) return <ClosureAssistantAction {...props} ResourceLink={ResourceLink} />;
  return props.action.toolName.startsWith("workitem.") && props.action.toolName !== "workitem.comment" && (!props.action.target || props.action.target.kind === "workItem")
    ? <WorkItemAction {...props} /> : <GenericAssistantAction {...props} ResourceLink={ResourceLink} />;
}
