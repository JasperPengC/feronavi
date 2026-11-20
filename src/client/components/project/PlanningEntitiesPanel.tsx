/**
 * 迭代 / 发布 / 模块管理。
 * 数据模型与接口早已存在，但此前只有里程碑有 UI；这里用同一套表单覆盖三种计划实体，
 * 默认展示迭代，避免把三个低频管理页塞满侧栏。
 */
import { invalidateWorkItemQueries, queryKeys } from "../../lib/query-keys.ts";
import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { planning, type PlanEntity } from "../../lib/planning-api.ts";
import { apiGet, apiPut, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { PageTabs } from "../ui/PageTabs.tsx";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { Select } from "../Select.tsx";
import { confirmDialog } from "../Dialog.tsx";
import { Icon } from "../Icon.tsx";
import { LoadingBlock, StateBlock } from "../ui/StateBlock.tsx";

const KINDS = ["iteration", "release", "module"] as const;
type Kind = typeof KINDS[number];
const KIND_LABEL: Record<Kind, string> = {
  iteration: "ms.kindIteration", release: "ms.kindRelease", module: "ms.kindModule",
};
interface Form {
  name: string; description: string; startDate: string; endDate: string;
  versionTag: string; releaseDate: string; notes: string;
}
const EMPTY: Form = { name: "", description: "", startDate: "", endDate: "", versionTag: "", releaseDate: "", notes: "" };

export function PlanningEntitiesPanel({ projectId, initialKind = "iteration", showTabs = true }: { projectId: string; initialKind?: Kind; showTabs?: boolean }) {
  const qc = useQueryClient();
  const tabsId = useId();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlanEntity | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<PlanEntity | null>(null);
  const [targetIterationId, setTargetIterationId] = useState("");
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [capacityFor, setCapacityFor] = useState<PlanEntity | null>(null);
  const [capacityValues, setCapacityValues] = useState<Record<string, { points: string; hours: string }>>({});

  const q = useQuery({
    queryKey: queryKeys.planEntities(kind, projectId, archived),
    queryFn: () => planning.list(kind, projectId, archived),
  });

  const capacityQ = useQuery({
    queryKey: queryKeys.iterationCapacity(capacityFor?.id),
    enabled: !!capacityFor,
    queryFn: () => apiGet<{ members: { memberId: string; name: string; username: string; capacityPoints: number; capacityHours: number; loggedPoints: number }[] }>(`/api/v1/iterations/${capacityFor!.id}/capacity`),
  });
  useEffect(() => {
    if (!capacityFor) return;
    const rows = capacityQ.data?.members ?? [];
    const next: Record<string, { points: string; hours: string }> = {};
    for (const m of rows) next[m.memberId] = { points: m.capacityPoints == null ? "" : String(m.capacityPoints), hours: m.capacityHours == null ? "" : String(m.capacityHours) };
    setCapacityValues(next);
  }, [capacityFor, capacityQ.data]);
  const capacityInvalid = Object.values(capacityValues).some((v) => v.points !== "" && v.hours !== "");
  const saveCapacity = useMutation({
    mutationFn: () => Promise.all(Object.entries(capacityValues).filter(([, v]) => v.points !== "" || v.hours !== "").map(([memberId, v]) => apiPut(`/api/v1/iterations/${capacityFor!.id}/capacity/${memberId}`, {
      capacityPoints: v.points === "" ? null : Number(v.points),
      capacityHours: v.hours === "" ? null : Number(v.hours),
    }))),
    onSuccess: async () => { setCapacityFor(null); await qc.invalidateQueries({ queryKey: queryKeys.iterationCapacity() }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("pe.capacityFailed")),
  });

  const save = useMutation({
    mutationFn: async () => {
      const common: Record<string, unknown> = { name: form.name.trim() };
      if (kind === "iteration") {
        Object.assign(common, { startDate: form.startDate, endDate: form.endDate });
        if (!editing) common.description = form.description.trim() || null;
      } else if (kind === "release") {
        Object.assign(common, { versionTag: form.versionTag.trim() || null, releaseDate: form.releaseDate || null, notes: form.notes.trim() || null });
        if (!editing) common.description = form.description.trim() || null;
      } else {
        common.description = form.description.trim() || null;
      }
      return editing ? planning.update(kind, editing.id, common) : planning.create(kind, projectId, common);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.planEntities(kind, projectId) });
      await qc.invalidateQueries({ queryKey: ["changelog"] });
      setOpen(false); setEditing(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("pe.saveFailed")),
  });

  const refreshPlans = async () => {
    await invalidateWorkItemQueries(qc);
    await qc.invalidateQueries({ queryKey: ["changelog"] });
  };
  const draft = useSettingsDraft(open, form, save.isPending);
  const requestClose = () => void draft.leave(() => { setOpen(false); setEditing(null); setError(null); });
  const startForm = (row: PlanEntity | null) => {
    const next = row ? {
      name: row.name, description: row.description ?? "", startDate: row.startDate ?? "", endDate: row.endDate ?? "",
      versionTag: row.versionTag ?? "", releaseDate: row.releaseDate ?? "", notes: (row as PlanEntity & { notes?: string | null }).notes ?? "",
    } : { ...EMPTY };
    setEditing(row); setForm(next); draft.markSaved(next); setError(null); setOpen(true);
  };
  const archiveAction = useMutation({
    mutationFn: ({ row, restore }: { row: PlanEntity; restore: boolean }) => restore ? planning.unarchive(kind, row.id) : planning.archive(kind, row.id),
    onMutate: () => setLifecycleError(null),
    onSuccess: refreshPlans,
    onError: (cause) => setLifecycleError(cause instanceof Error ? cause.message : t("pe.lifecycleFailed")),
  });
  const complete = useMutation({
    mutationFn: () => planning.complete(kind as "iteration" | "release", completing!.id,
      kind === "iteration" && completing?.carryOver !== false && targetIterationId ? { targetIterationId } : {}),
    onMutate: () => setCompletionError(null),
    onSuccess: async () => { await refreshPlans(); setCompleting(null); setTargetIterationId(""); },
    onError: (cause) => setCompletionError(cause instanceof Error ? cause.message : t("pe.lifecycleFailed")),
  });
  async function archive(row: PlanEntity) {
    if (archiveAction.isPending || !(await confirmDialog(t("common.confirmArchive"), { danger: true }))) return;
    archiveAction.mutate({ row, restore: false });
  }
  const allRows = Array.isArray(q.data) ? q.data : [];
  const rows = allRows.filter(row => !!row.archivedAt === archived);
  const targets = allRows.filter(row => row.id !== completing?.id && !row.completedAt && !row.archivedAt && (!row.projectId || row.projectId === projectId));
  const carryOver = kind === "iteration" && completing?.carryOver !== false;
  const targetRequired = carryOver && (completing?.pendingWorkItemCount ?? 0) > 0;
  const validTarget = targets.some(row => row.id === targetIterationId);
  const completeLabel = t(kind === "iteration" ? "pe.lifecycleCompleteIteration" : "pe.lifecycleCompleteRelease");
  const dateOf = (r: PlanEntity) => kind === "iteration" ? r.endDate : kind === "release" ? r.releaseDate : null;
  const canSave = form.name.trim().length > 0 && (kind !== "iteration" || (!!form.startDate && !!form.endDate));
  return (
    <section className="plan-entities">
      <div className="plan-entities-head">
        <strong>{t(showTabs ? "pe.title" : KIND_LABEL[kind])}</strong>
        {showTabs && <PageTabs id={tabsId} label={t("pe.title")} value={kind}
          tabs={KINDS.map(value => ({ value, label: t(KIND_LABEL[value]) }))}
          onChange={value => { void draft.leave(() => { setKind(value); setOpen(false); setCompleting(null); setArchived(false); setLifecycleError(null); }); }} />}
        <span style={{ flex: 1 }} />
        <div className="ui-segmented" role="group" aria-label={t("pe.lifecycleList")}>
          <button type="button" className="ui-segmented-item" aria-pressed={!archived} onClick={() => { setArchived(false); setLifecycleError(null); }}>{t("pe.lifecycleCurrent")}</button>
          <button type="button" className="ui-segmented-item" aria-pressed={archived} onClick={() => { setArchived(true); setLifecycleError(null); }}>{t("pe.lifecycleArchived")}</button>
        </div>
        <Button size="sm" variant="primary" onClick={() => startForm(null)}>
          <Icon name="plus" size={14} />{t("pe.new")}
        </Button>
      </div>
      <div role={showTabs ? "tabpanel" : undefined} tabIndex={showTabs ? 0 : undefined}
        className={showTabs ? "page-tab-panel" : "plan-entity-body"}
        id={showTabs ? `${tabsId}-panel-${kind}` : undefined}
        aria-labelledby={showTabs ? `${tabsId}-tab-${kind}` : undefined}>
      {q.isLoading && <LoadingBlock />}
      {lifecycleError && <p className="field-error" role="alert">{lifecycleError}</p>}
      {q.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={q.error instanceof ApiError ? q.error.message : undefined}
        action={() => void q.refetch()} actionLabel={t("common.reload")} />}
      {q.isSuccess && rows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t("pe.empty")}</p>}
      {error && !open && !capacityFor && <p className="field-error" role="alert">{error}</p>}
      <ul className="plan-entity-list">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="row-avatar" aria-hidden="true"><Icon name={kind === "release" ? "file" : kind === "module" ? "package" : "timeline"} size={13} /></span>
            <span className="plan-entity-main">
              <span className="row-name">{r.name}</span>
              {kind === "release" && r.versionTag && <span className="tag mono">{r.versionTag}</span>}
              {r.completedAt && <span className="tag">{t("pe.lifecycleCompleted")}</span>}
              {r.description && <span className="row-sub">{r.description}</span>}
            </span>
            <div className="plan-entity-meta">
              <span className="muted plan-entity-date">{dateOf(r) ?? "—"}</span>
              <div className="plan-entity-actions">
                {r.archivedAt ? <Button size="sm" variant="ghost" disabled={archiveAction.isPending}
                  onClick={() => archiveAction.mutate({ row: r, restore: true })}>{t("pe.lifecycleRestore")}</Button> : <>
                  {kind === "iteration" && !r.completedAt && <Button size="sm" variant="ghost" onClick={() => { setError(null); setCapacityFor(r); }}>{t("pe.capacity")}</Button>}
                  {!r.completedAt && <Button size="sm" variant="ghost" onClick={() => startForm(r)}>{t("common.edit")}</Button>}
                  {kind !== "module" && !r.completedAt && <Button size="sm" variant="ghost" onClick={() => { setCompleting(r); setTargetIterationId(""); setCompletionError(null); }}>{completeLabel}</Button>}
                  <Button size="sm" variant="ghost" disabled={archiveAction.isPending} onClick={() => void archive(r)}>{t("common.archive")}</Button>
                </>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      </div>

      <Drawer open={!!completing} title={`${completeLabel} · ${completing?.name ?? ""}`}
        onClose={() => !complete.isPending && setCompleting(null)} width="sm">
        <div style={{ display: "grid", gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>{t(kind === "release" ? "pe.lifecycleReleaseHint" : carryOver ? "pe.lifecycleCarryHint" : "pe.lifecycleKeepHint")}</p>
          {completing?.pendingWorkItemCount !== undefined && <p style={{ margin: 0 }}>{t("pe.lifecyclePending", { n: completing.pendingWorkItemCount })}</p>}
          {carryOver && <Select label={t("pe.lifecycleTarget")} ariaLabel={t("pe.lifecycleTarget")} value={targetIterationId}
            disabled={complete.isPending} required={targetRequired} onChange={setTargetIterationId}
            options={[{ value: "", label: t("pe.lifecycleNoTarget") }, ...targets.map(row => ({ value: row.id, label: row.name }))]} />}
          {targetRequired && targets.length === 0 && <p className="field-error" role="alert">{t("pe.lifecycleNoTargets")}</p>}
          {completionError && <p className="field-error" role="alert">{completionError}</p>}
          <div className="drawer-actions">
            <Button variant="ghost" disabled={complete.isPending} onClick={() => setCompleting(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={complete.isPending} disabled={complete.isPending || (targetRequired && !validTarget) || (!!targetIterationId && !validTarget)}
              onClick={() => complete.mutate()}>{completeLabel}</Button>
          </div>
        </div>
      </Drawer>

      <Drawer open={!!capacityFor} title={`${t("pe.capacity")} · ${capacityFor?.name ?? ""}`} onClose={() => !saveCapacity.isPending && setCapacityFor(null)} width="md">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>{t("pe.capacityHint")}</p>
          {capacityQ.isLoading && <LoadingBlock />}
          {capacityQ.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={capacityQ.error instanceof ApiError ? capacityQ.error.message : undefined}
            action={() => void capacityQ.refetch()} actionLabel={t("common.reload")} />}
          {(capacityQ.data?.members ?? []).map((m) => (
            <div key={m.memberId} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px 100px", gap: 8, alignItems: "end" }}>
              <span>{m.name}<span className="muted"> @{m.username}</span></span>
              <TextInput aria-label={`${m.name} ${t("pe.capacityPoints")}`} type="number" min={0} placeholder={t("pe.capacityPoints")}
                value={capacityValues[m.memberId]?.points ?? ""} onChange={(e) => setCapacityValues({ ...capacityValues, [m.memberId]: { ...(capacityValues[m.memberId] ?? { hours: "" }), points: e.target.value } })} />
              <TextInput aria-label={`${m.name} ${t("pe.capacityHours")}`} type="number" min={0} placeholder={t("pe.capacityHours")}
                value={capacityValues[m.memberId]?.hours ?? ""} onChange={(e) => setCapacityValues({ ...capacityValues, [m.memberId]: { ...(capacityValues[m.memberId] ?? { points: "" }), hours: e.target.value } })} />
            </div>
          ))}
          {capacityInvalid && <p className="field-error" role="alert">{t("pe.capacityOneOf")}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="drawer-actions">
            <Button variant="ghost" onClick={() => setCapacityFor(null)} disabled={saveCapacity.isPending}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={saveCapacity.isPending} disabled={capacityInvalid || saveCapacity.isPending || !capacityQ.isSuccess} onClick={() => saveCapacity.mutate()}>{t("common.save")}</Button>
          </div>
        </div>
      </Drawer>

      {draft.guard}
      <Modal open={open} title={`${editing ? t("common.edit") : t("pe.new")} · ${t(KIND_LABEL[kind])}`}
        onClose={requestClose} width="sm"
        footer={<>
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!canSave || save.isPending} onClick={() => { if (canSave && !save.isPending) { setError(null); save.mutate(); } }}>{t("common.save")}</Button>
        </>}>
        <fieldset disabled={save.isPending} className="settings-form-fields" style={{ display: "grid", gap: 12 }}>
          <TextInput label={t("common.name")} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {kind !== "release" && <TextArea label={t("common.description")} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
          {kind === "iteration" && (
            <>
              <DatePicker label={t("common.startDate")} value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} ariaLabel={t("common.startDate")} placeholder={t("common.pickDate")} />
              <DatePicker label={t("common.endDate")} value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} ariaLabel={t("common.endDate")} placeholder={t("common.pickDate")} />
            </>
          )}
          {kind === "release" && (
            <>
              <TextInput label={t("pe.versionTag")} value={form.versionTag} onChange={(e) => setForm({ ...form, versionTag: e.target.value })} placeholder="v1.2.0" />
              <DatePicker label={t("pe.releaseDate")} value={form.releaseDate} onChange={(v) => setForm({ ...form, releaseDate: v })} ariaLabel={t("pe.releaseDate")} placeholder={t("common.pickDate")} />
              <TextArea label={t("pe.notes")} rows={5} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </fieldset>
      </Modal>
    </section>
  );
}
