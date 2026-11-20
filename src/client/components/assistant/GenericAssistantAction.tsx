import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { RagActionProposal, RagProject, RagResourceKind } from "../../../shared/rag.ts";
import { apiGet, ApiError } from "../../lib/api.ts";
import { getLocale, t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";

type Resource = ComponentType<{ projectId: string | null; kind: RagResourceKind; id: string; children: ReactNode }>;
type Row = Record<string, unknown> & { id: string; projectId: string; name?: string; title?: string; key?: string; body?: string };
const kinds: Record<string, RagResourceKind> = { Milestone: "milestone", Iteration: "iteration", Release: "release", Module: "module" };
const editable = new Set(["name", "title", "description", "content", "body", "startDate", "dueDate", "endDate", "releaseDate", "versionTag", "notes", "parentId", "changeSummary", "visibility", "progressMode", "progressValue", "carryOver"]);
function resultKind(action: RagActionProposal): RagResourceKind {
  if (action.toolName === "workitem.comment" || action.toolName === "comment.update") return "comment";
  if (action.toolName.startsWith("page.")) return "page";
  return Object.entries(kinds).find(([suffix]) => action.toolName.endsWith(suffix))?.[1] ?? "workItem";
}
function stamp(date: string) { return new Date(date).toLocaleString(getLocale()); }
function readable(row: Row | undefined) { return row?.name || row?.title || row?.body; }
function ActionText({ text }: { text: string }) {
  if (text.length <= 280 && text.split("\n").length <= 5) return <>{text}</>;
  return <details className="assistant-action-content"><summary>{text.slice(0, 180)}… <span>{t("assistant.action.fullContent")}</span></summary><p>{text}</p></details>;
}

/** 确认卡仅展示可读领域字段；指纹由服务器在确认事务内重新核对。 */
export function GenericAssistantAction({ action, accountId, projects, canAct, onDecide, ResourceLink }: {
  action: RagActionProposal; accountId: string; projects: RagProject[]; canAct: boolean;
  onDecide: (id: string, decision: "confirm" | "reject") => Promise<void>; ResourceLink: Resource;
}) {
  const kind = resultKind(action);
  const target = action.target ?? (action.targetId ? { kind: "workItem" as const, id: action.targetId } : undefined);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<{ message: string; blocked: boolean }>();
  const saved = action.status === "confirmed" && action.result?.value && typeof action.result.value === "object" ? action.result.value as Row : undefined;
  const preview = action.target?.preview ? { ...action.target.preview, id: action.target.id, projectId: action.projectId } as Row : undefined;
  const targetQuery = useQuery({ queryKey: ["assistant-generic-target", accountId, action.projectId, target?.kind, target?.id],
    enabled: !!target && target.kind !== "comment" && !saved, retry: false,
    queryFn: () => apiGet<Row>(`/api/v1/${target!.kind === "workItem" ? "work-items" : `${target!.kind}s`}/${encodeURIComponent(target!.id)}`) });
  const current = saved ?? (targetQuery.isSuccess && targetQuery.data.projectId === action.projectId ? targetQuery.data : target?.kind === "comment" ? preview : undefined);
  const loading = !!target && target.kind !== "comment" && !saved && targetQuery.isPending;
  const inaccessible = !!target && !saved && (target.kind === "comment" ? !preview : targetQuery.isError || targetQuery.isSuccess && !current);
  const expired = action.status === "expired" || action.status === "pending" && Date.parse(action.expiresAt) <= Date.now();
  const pending = action.status === "pending" && !expired;
  const changed = action.parameters.expectedRevisionId !== undefined && current && current.currentRevisionId !== action.parameters.expectedRevisionId;
  const parentKind = kind === "page" ? "page" : kind === "comment" ? "comment" : "module";
  const parentIds = [...new Set([action.parameters.parentId, ...(pending ? [current?.parentId] : [])].filter((id): id is string => typeof id === "string" && !!id))];
  const parents = useQueries({ queries: parentIds.map(id => ({ queryKey: ["assistant-generic-reference", accountId, action.projectId, parentKind, id], enabled: parentKind !== "comment", retry: false,
    queryFn: async () => {
      const row = await apiGet<Row>(`/api/v1/${parentKind}s/${encodeURIComponent(id)}`);
      if (row.projectId !== action.projectId || row.id !== id || !readable(row)) throw new Error("Related resource unavailable");
      return row;
    } })) });
  const refsLoading = parentKind !== "comment" && parents.some(query => query.isPending);
  const refsFailed = parentKind !== "comment" && parents.some(query => query.isError);
  const verb = action.toolName.includes(".create") || action.toolName === "workitem.comment" ? "create" : "update";
  const name = t(`assistant.action.${verb}.${kind}`);
  function value(field: string, input: unknown): ReactNode {
    if (input === null || input === undefined || input === "") return t("assistant.value.empty");
    if (field === "parentId") {
      if (parentKind === "comment") return t("assistant.value.parentComment");
      const query = parents[parentIds.indexOf(String(input))];
      return query?.isSuccess ? <ResourceLink projectId={action.projectId} kind={parentKind} id={query.data.id}>{readable(query.data)}</ResourceLink> : t(query?.isError ? "assistant.value.referenceUnavailable" : "assistant.value.referenceLoading");
    }
    if (field === "visibility") return t(`assistant.value.visibility.${input}`);
    if (field === "progressMode") return t(`assistant.value.progressMode.${input}`);
    if (typeof input === "boolean") return t(input ? "assistant.value.enabled" : "assistant.value.disabled");
    if (typeof input === "object") return t("assistant.value.structured");
    return <ActionText text={String(input)} />;
  }
  async function decide(decision: "confirm" | "reject") {
    if (lock.current || !canAct) return;
    lock.current = true; setBusy(true); setError(undefined);
    try { await onDecide(action.id, decision); }
    catch (cause) { setError({ message: cause instanceof ApiError ? cause.message : t("assistant.action.retryHint"), blocked: cause instanceof ApiError && ["CONFLICT", "VERSION_CONFLICT", "NOT_FOUND", "FORBIDDEN"].includes(cause.code) }); }
    finally { lock.current = false; setBusy(false); }
  }
  const targetName = readable(current);
  const resultFields = Object.entries(action.parameters).filter(([field]) => editable.has(field));
  return <section className="assistant-action" aria-label={name}>
    <div className="assistant-action-heading"><h3>{name}</h3><span role="status">{busy ? t("assistant.action.executing") : t(`assistant.action.status.${expired ? "expired" : action.status}`)}</span></div>
    <p className="assistant-action-project">{action.projectId ? projects.find(project => project.id === action.projectId)?.name ?? t("assistant.project") : t(`assistant.scope.${action.scope?.kind ?? "account"}`)}</p>
    {loading ? <p role="status">{t("assistant.action.loadingTarget")}</p> : inaccessible ? <p role="alert">{t("assistant.action.unavailable")}</p> : <>
      {current && targetName && <p className="assistant-action-target">{target?.kind === "comment" || saved && kind === "comment" ? <span>{t("assistant.resource.comment")}</span> : <ResourceLink projectId={action.projectId} kind={saved ? kind : target!.kind} id={current.id}>{current.key ? `${current.key} · ${targetName}` : targetName}</ResourceLink>}</p>}
      {kind === "comment" && target?.kind !== "workItem" && typeof (current?.targetId ?? action.parameters.workItemId) === "string" && <p className="assistant-action-target"><ResourceLink projectId={action.projectId} kind="workItem" id={String(current?.targetId ?? action.parameters.workItemId)}>{t("assistant.resource.workItem")}</ResourceLink></p>}
      <dl className="assistant-action-changes">{resultFields.map(([field, next]) => <div key={field}><dt>{t(`assistant.field.${field === "parentId" ? "parentResource" : field}`)}</dt><dd>
        {pending && current && verb === "update" && <><span className="assistant-action-old">{value(field, current[field])}</span><span className="assistant-change-arrow" aria-label={t("assistant.action.changesTo")}>→</span></>}
        <span>{value(field, saved && field in saved ? saved[field] : next)}</span>
      </dd></div>)}</dl>
      {pending && <p className="assistant-action-expiry">{t("assistant.action.serverRecheck")}</p>}
      {(pending && changed || error?.blocked) && <p className="assistant-action-error" role="alert">{t("assistant.action.changed")}</p>}
      {pending && refsLoading && <p role="status">{t("assistant.action.referencesLoading")}</p>}
      {pending && refsFailed && <p className="assistant-action-error" role="alert">{t("assistant.action.referencesUnavailable")}</p>}
      {error && <p className="assistant-action-error" role="alert">{error.message}</p>}
      {pending && <div className="assistant-action-controls"><Button size="sm" disabled={!canAct || busy || !!changed || error?.blocked || refsLoading || refsFailed} onClick={() => void decide("confirm")}>{error && !error.blocked ? t("assistant.action.retry") : t("assistant.action.confirm")}</Button><Button size="sm" variant="ghost" disabled={!canAct || busy} onClick={() => void decide("reject")}>{t("assistant.action.reject")}</Button></div>}
      {pending && <p className="assistant-action-expiry">{t("assistant.action.expires", { time: stamp(action.expiresAt) })}</p>}
      {saved && action.result && <p className="assistant-action-expiry">{t("assistant.observedAt", { time: stamp(action.result.observedAt) })}</p>}
      <details className="assistant-error-details"><summary>{t("assistant.errorDetails")}</summary><p>{action.toolName} · {action.id}</p><pre>{JSON.stringify(action.parameters, null, 2)}</pre></details>
    </>}
  </section>;
}
