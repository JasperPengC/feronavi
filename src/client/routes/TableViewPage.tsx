import { TableScroll } from "../components/ui/TableScroll.tsx";
/** 表格视图（T6）：与看板同源、按列排平，支持排序与分页 */
import { invalidateWorkItemQueries, queryKeys } from "../lib/query-keys.ts";
import { t, useLocale } from "../i18n/index.ts";
import { useState } from "react";
import { useParams, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tableView } from "../lib/planning-api.ts";
import { WorkItemViewHeader } from "../components/project/WorkItemViewHeader.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Select } from "../components/Select.tsx";
import { Modal } from "../components/ui/Modal.tsx";
import { useSettingsDraft } from "../components/settings/SettingsDraft.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { apiDelete, apiGet, apiPost, ApiError } from "../lib/api.ts";
import { PagePagination } from "../components/ui/PagePagination.tsx";
import { Checkbox } from "../components/Checkbox.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { WorkItemEditor } from "../components/work-item/WorkItemEditor.tsx";

const TYPE_LABEL: Record<string, string> = {
  REQUIREMENT: "type.REQUIREMENT", TASK: "type.TASK", DEFECT: "type.DEFECT", SUBTASK: "type.SUBTASK",
};
const PRIORITY_LABEL: Record<string, string> = {
  LOWEST: "prio.LOWEST", LOW: "prio.LOW", MEDIUM: "prio.MEDIUM", HIGH: "prio.HIGH", URGENT: "prio.URGENT",
};

/**
 * 列定义与**行结构一致**（外壳重做第 21 轮）：
 * 编号/标题/类型已合并进第一列（字母头像 + 标题 + 编号·类型两行），因此这里只剩三列。
 * ⚠️ 行与表头必须同步改，否则表头与内容会错位 —— 这类错位 tsc 不会报，只能靠肉眼或几何断言发现。
 */
const COLUMNS: { key: "number" | "title" | "type" | "priority" | "dueDate"; label: string; sortable: boolean }[] = [
  { key: "number", label: "table.colKey", sortable: true },
  { key: "priority", label: "table.colPriority", sortable: true },
  { key: "dueDate", label: "common.dueShort", sortable: true },
];

interface SavedViewRow { id: string; name: string; scope: "PERSONAL" | "PROJECT_SHARED"; filters: unknown; sortOrder: number }

export function TableViewPage() {
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchPriority, setBatchPriority] = useState("");
  const [batchAssignee, setBatchAssignee] = useState("");
  const [batchStatus, setBatchStatus] = useState("");
  const searchParams = useSearch({ strict: false }) as { item?: string };
  useEffect(() => { if (searchParams.item) setOpenItemId(searchParams.item); }, [searchParams.item]);
  useLocale();   // 订阅语言
  const { projectId } = useParams({ from: "/_app/projects/$projectId/table" });
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [typeF, setTypeF] = useState<string | null>(null);
  const [prioF, setPrioF] = useState<string | null>(null);

  const qc = useQueryClient();
  const boardStates = useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: () => apiGet<{ columns: { stateKey: string; name: string }[] }>(`/api/v1/projects/${projectId}/work-items/board`),
    staleTime: 30_000,
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => apiGet<{ members: { id: string; name: string; username: string }[] }>(`/api/v1/projects/${projectId}/members`).then((r) => r.members ?? []),
    staleTime: 60_000,
  });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.table(projectId, page, sortBy, sortDir, typeF, prioF),
    queryFn: () => tableView(projectId!, { page, pageSize: 20, sortBy, sortDir, type: typeF ?? undefined, priority: prioF ?? undefined }),
  });
  const batchPriorityUpdate = useMutation({
    mutationFn: () => apiPost<{ succeeded?: number }>("/api/v1/work-items/batch", { op: "update", itemIds: [...selected], patch: { priority: batchPriority } }),
    onSuccess: async () => {
      setSelected(new Set()); setBatchPriority("");
      await invalidateWorkItemQueries(qc);
    },
  });
  const batchAssign = useMutation({
    mutationFn: () => apiPost("/api/v1/work-items/batch", { op: "assign", itemIds: [...selected], patch: { assigneeId: batchAssignee || null } }),
    onSuccess: async () => {
      setSelected(new Set()); setBatchAssignee("");
      await invalidateWorkItemQueries(qc);
    },
  });
  const batchStatusUpdate = useMutation({
    mutationFn: () => apiPost("/api/v1/work-items/batch", { op: "transition", itemIds: [...selected], patch: { toStateKey: batchStatus } }),
    onSuccess: async () => {
      setSelected(new Set()); setBatchStatus("");
      await invalidateWorkItemQueries(qc);
    },
  });
  // 筛选（第 40 轮）：本页副标题写着「按类型/状态/优先级筛选；列可读、可排序」，
  // 但此前**页面上根本没有筛选控件** —— 副标题承诺了不存在的能力。这里把能力补上（真实数据）。
  const batchDelete = useMutation({
    mutationFn: () => apiPost<{ ok?: boolean; results?: unknown[] }>("/api/v1/work-items/batch", { op: "delete", itemIds: [...selected] }),
    onSuccess: async () => {
      setSelected(new Set());
      await invalidateWorkItemQueries(qc);
    },
  });
  const [selectedViewId, setSelectedViewId] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveScope, setSaveScope] = useState<"PERSONAL" | "PROJECT_SHARED">("PERSONAL");
  const [viewMessage, setViewMessage] = useState<string | null>(null);
  const sharedViews = useQuery({
    queryKey: ["saved-views", "shared", projectId],
    queryFn: () => apiGet<SavedViewRow[]>("/api/v1/saved-views", { projectId }),
    retry: false,
  });
  const personalViews = useQuery({
    queryKey: ["saved-views", "personal"],
    queryFn: () => apiGet<SavedViewRow[]>("/api/v1/saved-views"),
    retry: false,
  });
  const views = [...(personalViews.data ?? []), ...(sharedViews.data ?? [])];
  const applyView = (id: string) => {
    setSelectedViewId(id);
    const view = views.find((v) => v.id === id);
    if (!view) return;
    setPage(1); setSelected(new Set());
    const f = (view.filters ?? {}) as Record<string, unknown>;
    setTypeF(typeof f.typeF === "string" ? f.typeF : null);
    setPrioF(typeof f.prioF === "string" ? f.prioF : null);
    if (typeof f.sortBy === "string") setSortBy(f.sortBy);
    if (f.sortDir === "asc" || f.sortDir === "desc") setSortDir(f.sortDir);
  };
  const saveView = async () => {
    if (savingView || !saveName.trim()) return;
    setSavingView(true); setSaveError(null);
    try {
      await apiPost("/api/v1/saved-views", {
        name: saveName.trim(), viewType: "TABLE", scope: saveScope,
        projectId: saveScope === "PROJECT_SHARED" ? projectId : null,
        filters: { typeF: typeF ?? undefined, prioF: prioF ?? undefined, sortBy, sortDir },
      });
      setSaveOpen(false); setSaveName(""); setViewMessage(t("sv.saved"));
      await Promise.all([sharedViews.refetch(), personalViews.refetch()]);
    } catch (e) { setSaveError(e instanceof ApiError ? e.message : t("sv.failed")); } finally { setSavingView(false); }
  };
  const viewDraft = useSettingsDraft(saveOpen, { saveName, saveScope }, savingView);
  const closeSaveView = () => void viewDraft.leave(() => { setSaveOpen(false); setSaveName(""); setSaveScope("PERSONAL"); setSaveError(null); });
  const selectedView = views.find((v) => v.id === selectedViewId);
  const moveView = async (dir: -1 | 1) => {
    if (!selectedView || selectedView.scope !== "PERSONAL") return;
    const personal = personalViews.data ?? [];
    const idx = personal.findIndex((v) => v.id === selectedView.id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= personal.length) return;
    const ids = personal.map((v) => v.id);
    [ids[idx], ids[swap]] = [ids[swap]!, ids[idx]!];
    try {
      await apiPost("/api/v1/saved-views/reorder", { ids });
      await personalViews.refetch();
    } catch (e) { setViewMessage(e instanceof ApiError ? e.message : t("sv.failed")); }
  };
  const deleteView = async () => {
    if (!selectedViewId) return;
    if (!(await confirmDialog(t("sv.deleteConfirm"), { danger: true }))) return;
    try {
      await apiDelete(`/api/v1/saved-views/${selectedViewId}`);
      setSelectedViewId(""); setViewMessage(t("sv.deleted"));
      await Promise.all([sharedViews.refetch(), personalViews.refetch()]);
    } catch (e) { setViewMessage(e instanceof ApiError ? e.message : t("sv.failed")); }
  };
  const shownRows = data?.rows ?? [];
  useEffect(() => { setSelected(new Set()); }, [projectId, page, sortBy, sortDir, typeF, prioF]);


  const today = new Date().toISOString().slice(0, 10);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 20)));

  function clickSort(col: string) {
    setPage(1);
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  }

  return (
    <div className="page project-refinement paginated-page work-items-page table-page data-page">
      <WorkItemViewHeader projectId={projectId!} active="table"
        onCreate={() => setCreateOpen(true)}
        onRefresh={() => { void qc.invalidateQueries({ queryKey: queryKeys.table(projectId) }); void qc.invalidateQueries({ queryKey: queryKeys.board(projectId) }); }} />
      <p className="muted work-items-help">{t("wiv.tableHelp")}</p>
      <div className="table-view-toolbar">
        {/* 筛选先于服务端分页；选择项不依赖当前页恰好有什么。 */}
        <div className="toolbar table-view-filters" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span className="toolbar-label">{t("table.filterLabel")}</span>
          <Select size="sm" ariaLabel={t("wiDetail.type")} value={typeF ?? ""}
            onChange={(next) => { setTypeF(next || null); setPage(1); }}
            options={[{ value: "", label: t("wiDetail.type") }, ...Object.keys(TYPE_LABEL).map((type) => ({ value: type, label: t(TYPE_LABEL[type]!) }))]} />
          <Select size="sm" ariaLabel={t("common.priority")} value={prioF ?? ""}
            onChange={(next) => { setPrioF(next || null); setPage(1); }}
            options={[{ value: "", label: t("common.priority") }, ...Object.keys(PRIORITY_LABEL).map((priority) => ({ value: priority, label: t(PRIORITY_LABEL[priority]!) }))]} />
          {(typeF || prioF) && <Button size="sm" variant="ghost"
            onClick={() => { setTypeF(null); setPrioF(null); setPage(1); }}>{t("common.all")}</Button>}
        </div>

        {/* 保存视图（Spec V8 / REST 7b）：后端早就有，此前前端零消费 */}
        <div className="toolbar" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span className="toolbar-label">{t("sv.savedViews")}</span>
          <Select size="sm" ariaLabel={t("sv.savedViews")} value={selectedViewId}
            onChange={(v) => (v ? applyView(v) : setSelectedViewId(""))}
            options={[{ value: "", label: views.length ? t("sv.pick") : t("sv.empty") },
              ...views.map((v) => ({ value: v.id, label: `${v.name}（${v.scope === "PROJECT_SHARED" ? t("sv.shared") : t("sv.personal")}）` }))]} />
          <Button size="sm" onClick={() => { setSaveOpen(true); setViewMessage(null); }}>{t("sv.saveCurrent")}</Button>
          {selectedViewId && <>
            <Button size="sm" variant="ghost" disabled={selectedView?.scope !== "PERSONAL"}
              onClick={() => void moveView(-1)}>{t("sv.moveUp")}</Button>
            <Button size="sm" variant="ghost" disabled={selectedView?.scope !== "PERSONAL"}
              onClick={() => void moveView(1)}>{t("sv.moveDown")}</Button>
            <Button size="sm" variant="ghost" onClick={() => void deleteView()}>{t("sv.delete")}</Button>
          </>}
          {viewMessage && <span className="muted" style={{ fontSize: "var(--text-xs)" }} role="status">{viewMessage}</span>}
        </div>
      </div>

      {viewDraft.guard}
      <Modal open={saveOpen} title={t("sv.saveCurrent")} onClose={closeSaveView} width="sm" footer={<>
          <Button onClick={closeSaveView} disabled={savingView}>{t("sv.cancel")}</Button>
          <Button variant="primary" loading={savingView} disabled={!saveName.trim() || savingView} onClick={() => void saveView()}>{t("sv.save")}</Button>
        </>}>
        {saveError && <p className="field-error" role="alert">{saveError}</p>}
        <fieldset disabled={savingView} className="settings-form-fields" style={{ display: "grid", gap: 12 }}>
          <TextInput label={t("sv.name")} aria-label={t("sv.name")} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          <Select label={t("sv.scope")} ariaLabel={t("sv.scope")} value={saveScope}
            onChange={(v) => setSaveScope(v as "PERSONAL" | "PROJECT_SHARED")}
            options={[{ value: "PERSONAL", label: t("sv.personal") }, { value: "PROJECT_SHARED", label: t("sv.shared") }]} />
        </fieldset>
      </Modal>

      {isLoading && <StateBlock kind="loading" title={t("common.loading")} />}

      {selected.size > 0 && (
        <div className="table-batch-bar" data-custom-scroll role="region" aria-label={t("table.batch")}>
          <strong>{t("table.selected", { n: String(selected.size) })}</strong>
          <div className="table-batch-group">
          <Select ariaLabel={t("common.priority")} value={batchPriority} onChange={setBatchPriority}
            options={[{ value: "", label: t("common.priority") }, ...Object.entries(PRIORITY_LABEL).map(([v, l]) => ({ value: v, label: t(l) }))]} />
          <Button disabled={!batchPriority || batchPriorityUpdate.isPending} onClick={() => batchPriorityUpdate.mutate()}>{t("common.save")}</Button>
          </div>
          <div className="table-batch-group">
          <Select ariaLabel={t("common.assignee")} value={batchAssignee} onChange={setBatchAssignee}
            options={[{ value: "", label: t("common.assignee") }, ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
          <Button disabled={batchAssignee === "" || batchAssign.isPending} onClick={() => batchAssign.mutate()}>{t("common.assignee")}</Button>
          </div>
          <div className="table-batch-group">
          <Select ariaLabel={t("po.status")} value={batchStatus} onChange={setBatchStatus}
            options={[{ value: "", label: t("po.status") }, ...(boardStates.data?.columns ?? []).map((s) => ({ value: s.stateKey, label: s.name }))]} />
          <Button disabled={!batchStatus || batchStatusUpdate.isPending} onClick={() => batchStatusUpdate.mutate()}>{t("po.status")}</Button>
          </div>
          <Button className="table-batch-delete" variant="danger" disabled={batchDelete.isPending}
            onClick={async () => { if (await confirmDialog(t("table.batchDeleteConfirm", { n: String(selected.size) }), { danger: true })) batchDelete.mutate(); }}>
            {batchDelete.isPending ? t("common.loading") : t("common.delete")}
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="table-view-surface data-fill">
          <TableScroll className="table-view-scroll" label={t("table.title")} resetKey={JSON.stringify([projectId, page, sortBy, sortDir, typeF, prioF])}>
        <table className="card table-view-table" aria-label={t("table.title")} style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col">
                <Checkbox ariaLabel={t("common.selectAll")} checked={shownRows.length > 0 && shownRows.every((r) => selected.has(r.id))}
                  onChange={(checked) => setSelected(checked ? new Set(shownRows.map((r) => r.id)) : new Set())} />
                <span className="table-select-all-label" aria-hidden="true">{t("common.selectAll")}</span>
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={c.sortable ? (sortBy === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}>
                  {c.sortable ? (
                    <button type="button" className="sort-button" data-active={sortBy === c.key ? "true" : "false"} onClick={() => clickSort(c.key)} aria-label={`按${t(c.label)}排序`}>
                      {t(c.label)}{sortBy === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr className="row-hover" key={r.id}
                onClick={() => setOpenItemId(r.id)}
                style={{ cursor: "pointer" }}>
                <td onClick={(e) => e.stopPropagation()}>
                  <Checkbox ariaLabel={`${t("common.select")} ${r.key}`} checked={selected.has(r.id)}
                    onChange={(checked) => setSelected((prev) => { const n = new Set(prev); if (checked) n.add(r.id); else n.delete(r.id); return n; })} />
                </td>
                {/* 与项目列表同一套行样式（外壳重做第 21 轮）：字母头像 + 两行 + 药丸 */}
                <td>
                  <div className="row-title">
                    <span className="row-avatar" aria-hidden="true">{(TYPE_LABEL[r.type] ? t(TYPE_LABEL[r.type]!) : r.type ?? "?").slice(0, 1)}</span>
                    <button type="button" className="issues-item-open row-name" onClick={(event) => { event.stopPropagation(); setOpenItemId(r.id); }}>{r.title}</button>
                  </div>
                  <div className="row-sub"><span className="mono">{r.key}</span> · {TYPE_LABEL[r.type] ? t(TYPE_LABEL[r.type]!) : r.type}</div>
                </td>
                <td data-label={t("table.colPriority")}><span className={`status-pill ${r.priority === "HIGH" || r.priority === "URGENT" ? "dot-red" : r.priority === "MEDIUM" ? "dot-blue" : r.priority === "LOW" || r.priority === "LOWEST" ? "dot-green" : ""}`}>
                  {r.priority ? (PRIORITY_LABEL[r.priority] ? t(PRIORITY_LABEL[r.priority]!) : r.priority) : "—"}
                </span></td>
                <td data-label={t("common.dueShort")}>
                  {r.dueDate && r.dueDate < today
                    ? <span className="status-pill dot-red" title={t("common.overdue")}>{r.dueDate}</span>
                    : (r.dueDate ?? "—")}
                </td>
              </tr>
            ))}
            {(data?.rows ?? []).length === 0 && (
              <tr><td colSpan={4}><StateBlock kind="empty" title={t("table.empty")} /></td></tr>
            )}
          </tbody>
        </table>
          </TableScroll>
        </div>
      )}

      {isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => { void refetch(); }} actionLabel={t("common.reload")} />}
      {!isError && <PagePagination page={page} pages={pages} total={total} onPage={setPage} showSingle />}

      <WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} />
      <WorkItemEditor open={createOpen} projectId={projectId!} onClose={() => setCreateOpen(false)}
        onSaved={(item) => { setCreateOpen(false); setSortBy("number"); setSortDir("desc"); setPage(1); setOpenItemId(item.id); }} />
    </div>
  );
}
