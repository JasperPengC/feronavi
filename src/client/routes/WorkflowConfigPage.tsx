/**
 * 工作流可视化配置（W6）
 *
 * 形态：状态列表 + 每个状态的**出边**列表（文档 7 节明确"出边列表，非 N×N"）。
 * 刻意不做画布拖拽 —— 画布属演进项，出边列表已完整表达状态机。
 * 无障碍：状态与边都有完整文本（读屏可懂），不只靠连线。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from "../lib/api.ts";
import { t as tr, useLocale } from "../i18n/index.ts";   // ⚠️ t 另有含义，i18n 用别名 tr
import { Select } from "../components/Select.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ConfirmButton } from "../components/ui/ConfirmButton.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { InfoTip } from "../components/ui/InfoTip.tsx";
import { PageHead } from "../components/Page.tsx";
import { Checkbox } from "../components/Checkbox.tsx";

interface Wf { id: string; name: string; appliesToType: string; isDefault: boolean }
interface St { id: string; key: string; name: string; category: string; color: string; wipLimit?: number | null }
interface Tr { id: string; fromStateId: string; toStateId: string; requiresApproval?: boolean; approverRoleKeys?: string[] }

const CATEGORY_LABEL: Record<string, string> = {
  NOT_STARTED: "wf.catNotStarted2", IN_PROGRESS: "wf.catInProgress2", TERMINAL: "wf.catTerminal2",
};
const TYPE_LABEL: Record<string, string> = {
  REQUIREMENT: "wf.tRequirement", TASK: "wf.tTask", DEFECT: "wf.tBug", SUBTASK: "wf.tSubtask",
};

import { StateBlock } from "../components/ui/StateBlock.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { useCan } from "../lib/actor.ts";

export function WorkflowConfigPage() {
  useLocale();   // 订阅语言，切换即时生效
  const canManage = useCan("work_item:manage_workflow");
  const qc = useQueryClient();
  const { projectId } = useParams({ from: "/_app/projects/$projectId/workflow" });
  const [selected, setSelected] = useState<string | null>(null);
  const [newState, setNewState] = useState({ key: "", name: "", category: "IN_PROGRESS" });
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");

  const wfs = useQuery({
    queryKey: ["workflows", projectId],
    queryFn: () => apiGet<Wf[]>(`/api/v1/workflows?projectId=${projectId}`),
  });
  const currentId = selected ?? wfs.data?.[0]?.id ?? null;

  const states = useQuery({
    queryKey: ["wf-states", currentId],
    queryFn: () => apiGet<St[]>(`/api/v1/workflows/${currentId}/states`),
    enabled: !!currentId,
  });
  const transitions = useQuery({
    queryKey: ["wf-transitions", currentId],
    queryFn: () => apiGet<Tr[]>(`/api/v1/workflows/${currentId}/transitions`),
    enabled: !!currentId,
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["wf-states", currentId] });
    await qc.invalidateQueries({ queryKey: ["wf-transitions", currentId] });
  };

  const addState = useMutation({
    mutationFn: () => apiPost(`/api/v1/workflows/${currentId}/states`, newState),
    onSuccess: async () => { setNewState({ key: "", name: "", category: "IN_PROGRESS" }); await invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("wf.addStateFailed")),
  });
  const addEdge = useMutation({
    mutationFn: () => apiPost(`/api/v1/workflows/${currentId}/transitions`, { fromStateId: edgeFrom, toStateId: edgeTo }),
    onSuccess: async () => { setEdgeFrom(""); setEdgeTo(""); await invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("wf.addEdgeFailed")),
  });
  const archiveState = useMutation({
    mutationFn: (stateId: string) => apiPost(`/api/v1/workflows/${currentId}/states/${stateId}/archive`, {}),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("wf.archiveFailed")),
  });
  const setWip = useMutation({
    mutationFn: ({ stateId, wipLimit }: { stateId: string; wipLimit: number | null }) =>
      apiPatch(`/api/v1/workflows/${currentId}/states/${stateId}`, { wipLimit }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("wf.wipFailed")),
  });
  const updateEdge = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { requiresApproval?: boolean; approverRoleKeys?: string[] } }) =>
      apiPatch(`/api/v1/workflows/${currentId}/transitions/${id}`, patch),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "保存审批配置失败"),
  });
  const removeEdge = useMutation({
    mutationFn: (trId: string) => apiDelete(`/api/v1/workflows/${currentId}/transitions/${trId}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("wf.delEdgeFailed")),
  });

  const stById = new Map((states.data ?? []).map((s) => [s.id, s]));
  const outEdges = (transitions.data ?? []).filter((t) => t.fromStateId === currentId) ?? [];
  void outEdges;

  const dirty = !!(newState.key || newState.name || edgeFrom || edgeTo);
  const busy = addState.isPending || addEdge.isPending || archiveState.isPending || setWip.isPending || updateEdge.isPending || removeEdge.isPending;
  return (
    <div className="page workspace-page project-refinement workflow-page">
      <PageHead title={tr("wf.title")} />
      <DraftNavigationGuard dirty={dirty} saving={busy} message={tr("flows.discardDraft")} />
      {(wfs.isLoading || states.isLoading || transitions.isLoading) && <StateBlock kind="loading" title={tr("common.loading")} />}
      {(wfs.isError || states.isError || transitions.isError) && <StateBlock kind="error" title={tr("common.loadFailedShort")} action={() => { void wfs.refetch(); void states.refetch(); void transitions.refetch(); }} actionLabel={tr("common.reload")} />}

      {/* 工作流选择 */}
      <div className="ui-segmented workflow-switcher" role="group" aria-label={tr("wf.title")}>
        {(wfs.data ?? []).map((w) => (
          <button type="button" key={w.id} className="ui-segmented-item" aria-pressed={w.id === currentId}
            disabled={busy} onClick={async () => { if (dirty && !await confirmDialog(tr("flows.discardDraft"))) return; setNewState({ key: "", name: "", category: "IN_PROGRESS" }); setEdgeFrom(""); setEdgeTo(""); setSelected(w.id); }}>
            {TYPE_LABEL[w.appliesToType] ? tr(TYPE_LABEL[w.appliesToType]!) : w.appliesToType} · {w.name}
          </button>
        ))}
      </div>

      <fieldset disabled={!canManage || busy || !currentId || states.isError || transitions.isError} className="settings-form-fields">
      <div className="workflow-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* 状态列 */}
        <div className="card" style={{ padding: 16 }}>
          <div className="workflow-state-heading"><strong>{tr("wf.colStates")}</strong><span>{tr("wf.limitLabel")}<InfoTip text={tr("wf.limitHint")} /></span></div>
          <div style={{ marginTop: 12 }}>
            {(states.data ?? []).map((s) => (
              <div key={s.id} className="workflow-list-row workflow-state-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span className="dot" style={{ background: s.color }} aria-hidden="true" />
                <span className="workflow-state-name" style={{ fontSize: "var(--text-sm)", flex: 1 }}>
                  {s.name}
                  <span className="mono muted" style={{ fontSize: "var(--text-xs)", marginLeft: 6 }}>{s.key}</span>
                </span>
                <span className="muted workflow-state-category" style={{ fontSize: "var(--text-xs)" }}>{CATEGORY_LABEL[s.category] ? tr(CATEGORY_LABEL[s.category]!) : s.category}</span>
                <input className="input wf-wip-input" type="number" min={1} max={999}
                  aria-label={`${s.name} · ${tr("wf.wipLimit")}`} placeholder={tr("wf.unlimited")}
                  defaultValue={s.wipLimit ?? ""}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const next = raw === "" ? null : Number(raw);
                    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 999)) { e.target.value = String(s.wipLimit ?? ""); return; }
                    if (next !== (s.wipLimit ?? null)) setWip.mutate({ stateId: s.id, wipLimit: next });
                  }} />
                <ConfirmButton size="sm" confirmText={tr("common.confirmArchive")} onConfirm={() => archiveState.mutate(s.id)}>{tr("wf.archive")}</ConfirmButton>
              </div>
            ))}
            {states.isSuccess && (states.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{tr("wf.noStates")}</p>}
          </div>
          <div className="workflow-form-row" style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            <TextInput aria-label={tr("wf.stateKeyPlaceholder")} placeholder={tr("wf.stateKeyPlaceholder")} value={newState.key}
              style={{ width: 130 }} onChange={(e) => setNewState({ ...newState, key: e.target.value.toUpperCase() })} />
            <TextInput aria-label={tr("wf.stateNamePlaceholder")} placeholder={tr("wf.stateNamePlaceholder")} value={newState.name}
              style={{ width: 100 }} onChange={(e) => setNewState({ ...newState, name: e.target.value })} />
<Select value={newState.category} ariaLabel={tr("wf.colStates")} size="sm"
              onChange={(v) => setNewState({ ...newState, category: v })}
              options={[
                { value: "NOT_STARTED", label: tr("wf.catNotStarted") },
                { value: "IN_PROGRESS", label: tr("wf.catInProgress") },
                { value: "TERMINAL", label: tr("wf.catTerminal") },
              ]} />
            <Button size="sm" variant="primary" disabled={!newState.key || !newState.name || addState.isPending}
              onClick={() => addState.mutate()}>{tr("wf.addState")}</Button>
          </div>
        </div>

        {/* 迁移边列 */}
        <div className="card" style={{ padding: 16 }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>{tr("wf.edges")}</strong>
          <div style={{ marginTop: 12 }}>
            {(transitions.data ?? []).map((t) => (
              <div key={t.id} className="workflow-list-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: "var(--text-sm)", flex: 1 }}>
                  {stById.get(t.fromStateId)?.name ?? "?"}
                  <span className="muted"> → </span>
                  {stById.get(t.toStateId)?.name ?? "?"}
                </span>
                <Checkbox checked={!!t.requiresApproval} label="需审批"
                  onChange={(v) => updateEdge.mutate({ id: t.id, patch: { requiresApproval: v } })} />
                {t.requiresApproval && (
                  <TextInput aria-label="审批角色" defaultValue={(t.approverRoleKeys ?? []).join(",")} placeholder="审批角色，如 ADMIN"
                    style={{ width: 150 }}
                    onBlur={(e) => updateEdge.mutate({ id: t.id, patch: { approverRoleKeys: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} />
                )}
                <ConfirmButton size="sm" onConfirm={() => removeEdge.mutate(t.id)}>{tr("wf.del")}</ConfirmButton>
              </div>
            ))}
            {transitions.isSuccess && (transitions.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{tr("wf.noEdges")}</p>}
          </div>
          <div className="workflow-form-row" style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
<Select value={edgeFrom} ariaLabel={tr("wf.from")} size="sm" onChange={setEdgeFrom}
              options={[{ value: "", label: tr("wf.from") },
                ...(states.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
<Select value={edgeTo} ariaLabel={tr("wf.to")} size="sm" onChange={setEdgeTo}
              options={[{ value: "", label: tr("wf.to") },
                ...(states.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
            <Button size="sm" variant="primary" disabled={!edgeFrom || !edgeTo || addEdge.isPending}
              onClick={() => addEdge.mutate()}>{tr("wf.addEdge")}</Button>
          </div>
        </div>
      </div>
      </fieldset>
    </div>
  );
}
