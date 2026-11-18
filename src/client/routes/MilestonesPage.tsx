import { TableScroll } from "../components/ui/TableScroll.tsx";
/** 里程碑页：列表 + 新建/编辑弹窗 + 归档 */
import { queryKeys } from "../lib/query-keys.ts";
import { t, useLocale } from "../i18n/index.ts";
import { useState } from "react";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { planning, type PlanEntity } from "../lib/planning-api.ts";
import { ApiError } from "../lib/api.ts";
import { PageHead } from "../components/Page.tsx";
import { DatePicker } from "../components/DatePicker.tsx";
import { Icon } from "../components/Icon.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ConfirmButton } from "../components/ui/ConfirmButton.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { PlanningEntitiesPanel } from "../components/project/PlanningEntitiesPanel.tsx";
import { Modal } from "../components/ui/Modal.tsx";
import { useSettingsDraft } from "../components/settings/SettingsDraft.tsx";

const KIND_LABEL: Record<string, string> = {
  milestone: t("ms.kindMilestone"), iteration: t("ms.kindIteration"), release: t("ms.kindRelease"), module: t("ms.kindModule"),
};

export function MilestonesPage() {
  useLocale();   // 订阅语言
  const { projectId } = useParams({ from: "/_app/projects/$projectId/milestones" });
  const qc = useQueryClient();
  const [section, setSection] = useState("milestones");
  const [editing, setEditing] = useState<PlanEntity | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", dueDate: "" });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: queryKeys.milestones(projectId),
    queryFn: () => planning.list("milestone", projectId!),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        description: form.description || null,
        dueDate: form.dueDate || null,
      };
      return editing
        ? planning.update("milestone", editing.id, body)
        : planning.create("milestone", projectId!, body);
    },
    onSuccess: async () => {
      setCreating(false); setEditing(null); setError(null);
      await qc.invalidateQueries({ queryKey: queryKeys.milestones(projectId) });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("ms.saveFailed")),
  });
  const draft = useSettingsDraft(creating, form, save.isPending);
  const closeForm = () => { void draft.leave(() => { setCreating(false); setEditing(null); }); };

  const archive = useMutation({
    mutationFn: (id: string) => planning.archive("milestone", id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.milestones(projectId) });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("ms.archiveFailed")),
  });

  function openCreate() { setEditing(null); setCreating(true); setForm({ name: "", description: "", dueDate: "" }); setError(null); }
  function openEdit(m: PlanEntity) {
    setEditing(m); setCreating(true);
    setForm({ name: m.name, description: m.description ?? "", dueDate: m.dueDate ?? "" });
    setError(null);
  }

  return (
    <div className={`page project-refinement milestones-page${section === "milestones" ? " data-page" : ""}`}>
      <PageHead title={t("ms.title")}
        actions={section === "milestones" && (data?.length ?? 0) > 0 ? <Button variant="primary" onClick={openCreate}><Icon name="plus" size={14} />{t("ms.new")}</Button> : undefined} />

      <PageTabs id="planning" label={t("ms.title")} value={section} onChange={setSection} tabs={[
        { value: "milestones", label: t("ms.title") },
        ...(["iteration", "release", "module"] as const).map(value => ({ value, label: t({ iteration: "ms.kindIteration", release: "ms.kindRelease", module: "ms.kindModule" }[value]) })),
      ]} />
      <TabPanel tabsId="planning" value="milestones" activeValue={section}>
      {!!data?.length && (() => {
        const rows = data ?? [];
        const today = new Date().toISOString().slice(0, 10);
        const overdue = rows.filter((m) => m.dueDate && m.dueDate < today).length;
        const upcoming = rows.filter((m) => m.dueDate && m.dueDate >= today)
          .sort((a, b) => (String(a.dueDate) < String(b.dueDate) ? -1 : 1))[0];
        return (
          <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
            <MetricCard label={t("ms.title")} value={rows.length} tone="primary" />
            <MetricCard label={t("common.overdue")} value={overdue} tone={overdue > 0 ? "warning" : "neutral"} />
            <MetricCard className="project-date-metric" label={t("ms.nextDue")} value={upcoming?.dueDate ?? "—"} detail={upcoming?.name} />
          </div>
        );
      })()}

      {isLoading && <LoadingBlock />}
      {isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={loadError instanceof ApiError ? loadError.message : undefined}
        action={() => void refetch()} actionLabel={t("common.reload")} />}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <div className="card milestone-empty">
          <span className="empty-mark" aria-hidden="true"><Icon name="flag" size={18} /></span>
          <strong>{t("ms.empty")}</strong>
          <p className="muted">{t("ms.sub")}</p>
          <div className="milestone-empty-meta" aria-hidden="true">
            <span><Icon name="flag" size={14} />{t("ms.title")}</span>
            <span><Icon name="calendar" size={14} />{t("common.dueDate")}</span>
            <span><Icon name="file" size={14} />{t("common.name")}</span>
          </div>
          <Button variant="primary" onClick={openCreate}><Icon name="plus" size={14} />{t("ms.emptyCta")}</Button>
        </div>
      )}

      {!!data?.length && (
            <div className="dashboard-grid milestone-data-layout">
              <div className="data-fill">
        <TableScroll label={t("ms.title")} resetKey={projectId}>
        <table className="card milestone-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.dueDate")}</th>
              <th className="table-actions">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr className="row-hover" key={m.id}>
                {/* 与项目/工作项/令牌/公告/项目集/想法同一套行样式（第 40 轮） */}
                <td data-label={t("common.name")}>
                  <div className="row-title">
                    <span className="row-avatar" aria-hidden="true"><Icon name="flag" size={13} /></span>
                    <Link className="row-name" to="/projects/$projectId/milestones/$milestoneId" params={{ projectId, milestoneId: m.id }}>{m.name}</Link>
                  </div>
                  {m.description && <div className="row-sub">{m.description}</div>}
                </td>
                <td data-label={t("common.dueDate")} className="muted">
                  {/* 逾期徽标：同时有图标与文字，不只靠颜色 */}
                  {m.dueDate && m.dueDate < new Date().toISOString().slice(0, 10) ? (
                    <span className="status-pill dot-red status-pill-icon" title={t("common.overdue")}><Icon name="info" size={12} />{m.dueDate}</span>
                  ) : (m.dueDate ?? "—")}
                </td>
                <td data-label={t("common.actions")} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button size="sm" onClick={() => openEdit(m)}><Icon name="pencil" size={13} />{t("common.edit")}</Button>{" "}
                  <ConfirmButton size="sm" disabled={archive.isPending} confirmText={t("common.confirmArchive")}
                    onConfirm={() => archive.mutate(m.id)}><Icon name="archive" size={13} />{t("common.archive")}</ConfirmButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
              </div>
              <aside className="card" style={{ padding: 15 }}>
                <strong style={{ fontSize: "var(--text-sm)" }}>{t("common.overdue")}</strong>
                <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 8 }}>
                  {(data ?? []).filter((m) => m.dueDate && m.dueDate < new Date().toISOString().slice(0, 10))
                    .map((m) => (
                      <li key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}>
                        <span className="status-pill dot-red">{m.dueDate}</span>
                        <Link className="row-name" to="/projects/$projectId/milestones/$milestoneId" params={{ projectId, milestoneId: m.id }}>{m.name}</Link>
                      </li>
                    ))}
                </ul>
              {/* 同一份数据的另一视角：即将到期（真实数据，非占位） */}
              <strong style={{ fontSize: "var(--text-sm)", display: "block", marginTop: 14 }}>{t("common.dueDate")}</strong>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 8 }}>
                {(data ?? [])
                  .filter((m) => m.dueDate && m.dueDate >= new Date().toISOString().slice(0, 10))
                  .sort((a, b) => (String(a.dueDate) < String(b.dueDate) ? -1 : 1))
                  .slice(0, 6)
                  .map((m) => (
                    <li key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}>
                      <span className="status-pill">{m.dueDate}</span>
                      <Link className="row-name" to="/projects/$projectId/milestones/$milestoneId" params={{ projectId, milestoneId: m.id }}>{m.name}</Link>
                    </li>
                  ))}
              </ul>
              </aside>
            </div>
      )}

      </TabPanel>
      {(["iteration", "release", "module"] as const).map(kind => <TabPanel key={kind} tabsId="planning" value={kind} activeValue={section}>
        <PlanningEntitiesPanel projectId={projectId!} initialKind={kind} showTabs={false} />
      </TabPanel>)}

      {draft.guard}
      <Modal open={creating} title={editing ? t("ms.edit") : t("ms.new")} onClose={closeForm} width="sm"
        footer={<>
          <Button onClick={closeForm} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" form="milestone-form" variant="primary" loading={save.isPending} disabled={!form.name.trim() || save.isPending}>
            {save.isPending ? t("ms.saving") : t("ms.save")}
          </Button>
        </>}>
        <form id="milestone-form" onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending && form.name.trim()) save.mutate();
        }}>
          {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
          <fieldset className="milestone-form-fields" disabled={save.isPending}>
            <TextInput id="m-name" label={t("common.name")} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextArea id="m-desc" label={t("common.description")} rows={3} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <DatePicker label={t("common.dueDate")} value={form.dueDate}
              onChange={(v) => setForm({ ...form, dueDate: v })} ariaLabel={t("common.dueDate")}
              placeholder={t("common.pickDate")} />
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}

void KIND_LABEL;
