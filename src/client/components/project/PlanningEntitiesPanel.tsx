/**
 * 迭代 / 发布 / 模块管理。
 * 数据模型与接口早已存在，但此前只有里程碑有 UI；这里用同一套表单覆盖三种计划实体，
 * 默认展示迭代，避免把三个低频管理页塞满侧栏。
 */
import { queryKeys } from "../../lib/query-keys.ts";
import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { planning, type PlanEntity } from "../../lib/planning-api.ts";
import { apiGet, apiPut, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { PageTabs } from "../ui/PageTabs.tsx";
import { Button } from "../ui/Button.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { DatePicker } from "../DatePicker.tsx";
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
  const [capacityFor, setCapacityFor] = useState<PlanEntity | null>(null);
  const [capacityValues, setCapacityValues] = useState<Record<string, { points: string; hours: string }>>({});

  const q = useQuery({
    queryKey: queryKeys.planEntities(kind, projectId),
    queryFn: () => planning.list(kind, projectId),
  });

  useEffect(() => {
    if (!open) return;
    setForm(editing ? {
      name: editing.name, description: editing.description ?? "", startDate: editing.startDate ?? "",
      endDate: editing.endDate ?? "", versionTag: editing.versionTag ?? "", releaseDate: editing.releaseDate ?? "",
      notes: (editing as PlanEntity & { notes?: string | null }).notes ?? "",
    } : { ...EMPTY });
    setError(null);
  }, [open, editing]);

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

  async function archive(row: PlanEntity) {
    if (!(await confirmDialog(t("common.confirmArchive"), { danger: true }))) return;
    try {
      await planning.archive(kind, row.id);
      await qc.invalidateQueries({ queryKey: queryKeys.planEntities(kind, projectId) });
    } catch { /* 服务端错误由全局 toast/页面状态承接，避免静默 */ }
  }

  const rows = Array.isArray(q.data) ? q.data : [];
  const dateOf = (r: PlanEntity) => kind === "iteration" ? r.endDate : kind === "release" ? r.releaseDate : null;
  const canSave = form.name.trim().length > 0 && (kind !== "iteration" || (!!form.startDate && !!form.endDate));
  return (
    <section className="plan-entities">
      <div className="plan-entities-head">
        <strong>{t(showTabs ? "pe.title" : KIND_LABEL[kind])}</strong>
        {showTabs && <PageTabs id={tabsId} label={t("pe.title")} value={kind}
          tabs={KINDS.map(value => ({ value, label: t(KIND_LABEL[value]) }))}
          onChange={value => { setKind(value); setOpen(false); }} />}
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="primary" onClick={() => { setEditing(null); setOpen(true); }}>
          <Icon name="plus" size={14} />{t("pe.new")}
        </Button>
      </div>
      <div role={showTabs ? "tabpanel" : undefined} tabIndex={showTabs ? 0 : undefined}
        className={showTabs ? "page-tab-panel" : "plan-entity-body"}
        id={showTabs ? `${tabsId}-panel-${kind}` : undefined}
        aria-labelledby={showTabs ? `${tabsId}-tab-${kind}` : undefined}>
      {q.isLoading && <LoadingBlock />}
      {q.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={q.error instanceof ApiError ? q.error.message : undefined}
        action={() => void q.refetch()} actionLabel={t("common.reload")} />}
      {q.isSuccess && rows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t("pe.empty")}</p>}
      <ul className="plan-entity-list">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="row-avatar" aria-hidden="true"><Icon name={kind === "release" ? "file" : kind === "module" ? "package" : "timeline"} size={13} /></span>
            <span className="plan-entity-main">
              <span className="row-name">{r.name}</span>
              {kind === "release" && r.versionTag && <span className="tag mono">{r.versionTag}</span>}
              {r.description && <span className="row-sub">{r.description}</span>}
            </span>
            <div className="plan-entity-meta">
              <span className="muted plan-entity-date">{dateOf(r) ?? "—"}</span>
              <div className="plan-entity-actions">
                {kind === "iteration" && <Button size="sm" variant="ghost" onClick={() => { setError(null); setCapacityFor(r); }}>{t("pe.capacity")}</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}>{t("common.edit")}</Button>
                <Button size="sm" variant="ghost" onClick={() => void archive(r)}>{t("common.archive")}</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      </div>

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

      <Drawer open={open} title={`${editing ? t("common.edit") : t("pe.new")} · ${t(KIND_LABEL[kind])}`}
        onClose={() => !save.isPending && setOpen(false)} width="sm">
        <div style={{ display: "grid", gap: 12 }}>
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
          <div className="drawer-actions">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={save.isPending}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>{t("common.save")}</Button>
          </div>
        </div>
      </Drawer>
    </section>
  );
}
