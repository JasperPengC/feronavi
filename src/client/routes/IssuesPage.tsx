import { TableScroll } from "../components/ui/TableScroll.tsx";
import { WorkItemTag } from "../components/work-item/WorkItemTag.tsx";
/**
 * 问题追踪（Round 64 · 对标 YouQu P1）
 *
 * 复用工作项（type=DEFECT）：真实聚合统计卡 + 状态分类/严重度/优先级/关键字筛选 +
 * 列表（点行打开工作项抽屉，缺陷抽屉内含「处理进展」结构化时间线）。
 * 导出当前全部筛选结果，列表保留分页。
 */
import { invalidateWorkItemQueries, queryKeys } from "../lib/query-keys.ts";
import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { t, useLocale } from "../i18n/index.ts";
import { apiGet, apiUpload } from "../lib/api.ts";
import { useMarkdownImages } from "../lib/useMarkdownImages.ts";
import { saveNewWorkItem, type CreatedWorkItemDraft } from "../lib/save-work-item.ts";
import { useCan } from "../lib/actor.ts";
import { PageHead } from "../components/Page.tsx";
import { IssueInsights } from "../components/IssueInsights.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Select } from "../components/Select.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { Drawer } from "../components/ui/Drawer.tsx";
import { MarkdownEditor } from "../components/ui/MarkdownEditor.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { PagePagination } from "../components/ui/PagePagination.tsx";
import { DatePicker } from "../components/DatePicker.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";

interface Stats {
  total: number; open: number; done: number; cancelled: number; p0: number; overdue: number; donePercent: number;
  trend: { date: string; created: number; resolved: number }[];
  severity: Record<string, number>;
}
interface IssueRow {
  id: string; key: string; title: string; type?: string; severity: string | null; priority: string | null;
  statusName: string | null; statusCategory: string | null; statusKey?: string | null; assigneeName: string | null; reporterName: string | null;
  dueDate: string | null; createdAt: string;
  projectId?: string; projectKey?: string; projectName?: string;
}
type QuickFilter = "" | "ASSIGNED" | "REPORTED" | "WATCHING" | "COLLABORATING";
type IssueSort = "NEWEST" | "OLDEST" | "SEVERITY" | "DUE";
const SEVERITIES = ["S1", "S2", "S3", "S4"];
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"];

export function IssuesPage() {
  useLocale();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projectId: string | null = pathname.match(/^\/projects\/([0-9a-f-]{36})/)?.[1] ?? null;
  const isGlobal = !projectId;
  const canCreate = useCan("work_item:create");
  const [statusCategory, setStatusCategory] = useState<"" | "OPEN" | "DONE" | "CANCELLED">("");
  const [severity, setSeverity] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("");
  const [sort, setSort] = useState<IssueSort>("NEWEST");
  const [page, setPage] = useState(1);
  const [projectFilter, setProjectFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createSeverity, setCreateSeverity] = useState("S3");
  const [createAssignee, setCreateAssignee] = useState("");
  const [createDueDate, setCreateDueDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [createPriority, setCreatePriority] = useState("MEDIUM");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const confirming = useRef(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const formId = useId();
  const targetProject = projectId ?? createProjectId;
  const draftDirty = !!(title.trim() || desc.trim() || createAssignee || createDueDate || files.length || createSeverity !== "S3" || createPriority !== "MEDIUM");
  const images = useMarkdownImages({ newWorkItem: true });
  const createdDraft = useRef<CreatedWorkItemDraft | null>(null);
  const uploadedFiles = useRef(new Set<File>());

  const stats = useQuery({
    queryKey: queryKeys.issueStats(projectId ?? "global"),
    queryFn: () => apiGet<Stats>(projectId ? `/api/v1/projects/${projectId}/issues/stats` : "/api/v1/issues/stats"),
  });
  const projectOptions = useQuery({
    queryKey: ["issues-project-options"],
    enabled: isGlobal,
    queryFn: () => apiGet<{ items: { id: string; key: string; name: string }[] }>("/api/v1/projects").then((r) => r.items),
  });
  const members = useQuery({
    queryKey: ["project-members", targetProject],
    enabled: creating && !!targetProject,
    queryFn: () => apiGet<{ members: { id: string; name: string; username: string }[] }>(`/api/v1/projects/${targetProject}/members`).then((r) => r.members ?? []),
  });
  const list = useQuery({
    queryKey: queryKeys.issues(projectId ?? "global", statusCategory, severity, priority, q, page, projectFilter, quick, sort),
    queryFn: () => apiGet<{ items: IssueRow[]; total: number }>(projectId ? `/api/v1/projects/${projectId}/issues` : "/api/v1/issues", {
      ...(isGlobal && projectFilter ? { projectId: projectFilter } : {}),
      statusCategory: statusCategory || undefined,
      severity: severity || undefined,
      priority: priority || undefined,
      quick: quick || undefined,
      sort,
      q: q.trim() || undefined,
      page, pageSize: 50,
    }),
  });
  const items = list.data?.items ?? [];
  const today = new Date().toLocaleDateString("en-CA");
  const extraFilterCount = [projectFilter, quick, severity, priority, sort !== "NEWEST"].filter(Boolean).length;
  const hasFilters = !!(statusCategory || severity || priority || q.trim() || quick || projectFilter);
  const clearFilters = () => { setStatusCategory(""); setSeverity(""); setPriority(""); setQ(""); setQuick(""); setProjectFilter(""); setPage(1); };
  const pageCount = Math.max(1, Math.ceil((list.data?.total ?? 0) / 50));
  /** 导出**全部匹配筛选**（服务端生成完整 CSV，不是当前页 200 条） */
  const exportAll = () => {
    const params = new URLSearchParams();
    if (isGlobal && projectFilter) params.set("projectId", projectFilter);
    if (projectId) params.set("type", "DEFECT");
    if (statusCategory) params.set("statusCategory", statusCategory);
    if (severity) params.set("severity", severity);
    if (priority) params.set("priority", priority);
    if (quick) params.set("quick", quick);
    if (q.trim()) params.set("q", q.trim());
    const base = projectId
      ? `/api/v1/projects/${projectId}/work-items/export`
      : "/api/v1/issues/export";
    const a = document.createElement("a");
    a.href = `${base}?${params.toString()}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const create = async () => {
    if (submittingRef.current || !title.trim() || !targetProject) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const created = await saveNewWorkItem(createdDraft, targetProject, {
        type: "DEFECT", title: title.trim(), description: desc.trim() || null,
        severity: createSeverity, priority: createPriority,
        assigneeId: createAssignee || null, dueDate: createDueDate || null,
      }, images.persist);
      for (const file of files) {
        if (uploadedFiles.current.has(file)) continue;
        const form = new FormData();
        form.append("targetType", "WORK_ITEM");
        form.append("targetId", created.id);
        form.append("file", file);
        try { await apiUpload("/api/v1/uploads", form); uploadedFiles.current.add(file); }
        catch (cause) { throw new Error(t("md.uploadFailed", { name: file.name, error: cause instanceof Error ? cause.message : t("att.uploadFailed") }), { cause }); }
      }
      setCreating(false); resetDraft(); setPage(1);
      toast.success(t("flows.issueCreated"));
      await invalidateWorkItemQueries(qc, created.id);
    } catch (e) { setError(e instanceof Error ? e.message : t("issues.saveFailed")); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };
  const resetDraft = () => {
    setTitle(""); setDesc(""); setCreateAssignee(""); setCreateDueDate(""); setFiles([]);
    setCreateSeverity("S3"); setCreatePriority("MEDIUM"); setError(null);
    createdDraft.current = null; uploadedFiles.current.clear(); images.reset();
  };
  const requestClose = async () => {
    if (submittingRef.current || confirming.current) return;
    confirming.current = true;
    try {
      if (draftDirty && !await confirmDialog(t(createdDraft.current ? "md.closeCreated" : "flows.discardDraft"))) return;
      if (createdDraft.current) {
        await invalidateWorkItemQueries(qc, createdDraft.current.id);
      }
      setCreating(false); resetDraft();
    } finally { confirming.current = false; }
  };
  const addFiles = (added: File[]) => {
    if (submittingRef.current) return;
    if (added.some((file) => file.size > 20 * 1024 * 1024)) setError(t("flows.fileTooLarge"));
    setFiles((current) => [...current, ...added.filter((file, index) => file.size <= 20 * 1024 * 1024 &&
      ![...current, ...added.slice(0, index)].some((other) => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified))]);
  };
  const statsCards = stats.data;
  const tabs: { key: "" | "OPEN" | "DONE" | "CANCELLED"; label: string }[] = [
    { key: "", label: t("issues.all") },
    { key: "OPEN", label: t("issues.open") },
    { key: "DONE", label: t("issues.done") },
    { key: "CANCELLED", label: t("issues.cancelled") },
  ];

  return (
    <div className="page issues-page data-page">
      <PageHead title={isGlobal ? t("issues.title") : t("issues.projectTitle")}
        actions={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t("issues.create")}</Button> : undefined} />
      {stats.isError && <StateBlock kind="error" title={t("issues.loadFailed")} action={() => void stats.refetch()} actionLabel={t("common.reload")} />}
      <section className="issues-overview-section">
        <div className="issues-overview-bar">
        <dl className="issues-summary" aria-label={t("issues.overviewTitle")}>
          <div><dt>{t("issues.total")}</dt><dd>{statsCards?.total ?? "—"}</dd></div>
          <div><dt>{t("issues.open")}</dt><dd data-active={!!statsCards?.open}>{statsCards?.open ?? "—"}</dd></div>
          <div><dt>{t("issues.p0")}</dt><dd data-attention={!!statsCards?.p0}>{statsCards?.p0 ?? "—"}</dd></div>
          <div><dt>{t("issues.overdue")}</dt><dd data-attention={!!statsCards?.overdue}>{statsCards?.overdue ?? "—"}</dd></div>
          <div><dt>{t("issues.doneRate")}</dt><dd>{statsCards ? `${statsCards.donePercent}%` : "—"}</dd></div>
        </dl>
        <Button size="sm" variant="ghost" className="issues-insights-toggle" aria-haspopup="dialog" aria-controls="issues-insights"
          onClick={() => setShowInsights(true)}><Icon name="chart" size={16} />{t("flows.showInsights")}<Icon name="chevron-right" size={14} /></Button>
        </div>

      {statsCards && <Drawer open={showInsights} onClose={() => setShowInsights(false)} title={t("issues.overviewTitle")} width="lg">
        <IssueInsights trend={statsCards.trend} severity={statsCards.severity} isGlobal={isGlobal} />
      </Drawer>}

      </section>

      <section className="issues-list-section data-fill" aria-labelledby="issues-list-title">
        <div className="issues-list-head">
          <div><h2 id="issues-list-title">{t("issues.listTitle")}</h2><span aria-live="polite">{t("flows.resultCount", { n: list.data?.total ?? 0 })}</span></div>
          <Button size="sm" variant="ghost" onClick={exportAll} disabled={items.length === 0}><Icon name="download" size={15} />{t("issues.exportAll")}</Button>
        </div>
        <div className="issues-filterbar">
          <div className="issues-filter-row ui-segmented" role="group" aria-label={t("common.status")}>
            {tabs.map((x) => (
              <button type="button" key={x.key} className="ui-segmented-item"
                aria-pressed={statusCategory === x.key} onClick={() => { setStatusCategory(x.key); setPage(1); }}>{x.label}</button>
            ))}
          </div>
          <div className="issues-search-row">
            <div className="issues-search-field">
              <Icon name="search" size={16} />
              <TextInput type="search" aria-label={t("issues.search")} placeholder={t("issues.search")} value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
            <Button className="issues-filter-toggle" data-active={extraFilterCount > 0} aria-expanded={showFilters} aria-controls="issues-extra-filters" onClick={() => setShowFilters(!showFilters)}>
              <Icon name="filter" size={16} />{t("flows.filters")}{extraFilterCount > 0 && <span className="issues-filter-count">{extraFilterCount}</span>}
            </Button>
          </div>
          {showFilters && <div id="issues-extra-filters" className="issues-extra-filters">
            {isGlobal && (
              <Select ariaLabel={t("issues.projectFilter")} value={projectFilter} searchable
                onChange={(v) => { setProjectFilter(v); setPage(1); }}
                options={[{ value: "", label: t("issues.allProjects") }, ...(projectOptions.data ?? []).map((p) => ({ value: p.id, label: `${p.key} ${p.name}` }))]} />
            )}
            <Select ariaLabel={t("issues.quickFilters")} value={quick} onChange={(v) => { setQuick(v as QuickFilter); setPage(1); }}
              options={[
                { value: "", label: t("issues.quickAll") },
                { value: "ASSIGNED", label: t("issues.quickAssigned") },
                { value: "REPORTED", label: t("issues.quickReported") },
                { value: "WATCHING", label: t("issues.quickWatching") },
                { value: "COLLABORATING", label: t("issues.quickCollaborating") },
              ]} />
            <Select ariaLabel={t("common.severity")} value={severity} onChange={(v) => { setSeverity(v); setPage(1); }}
              options={[{ value: "", label: t("common.severity") }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]} />
            <Select ariaLabel={t("common.priority")} value={priority} onChange={(v) => { setPriority(v); setPage(1); }}
              options={[{ value: "", label: t("common.priority") }, ...PRIORITIES.map((p) => ({ value: p, label: t(`prio.${p}`) }))]} />
            <Select ariaLabel={t("issues.sort")} value={sort} onChange={(v) => { setSort(v as IssueSort); setPage(1); }} options={[
              { value: "NEWEST", label: t("issues.sortNewest") },
              { value: "OLDEST", label: t("issues.sortOldest") },
              { value: "SEVERITY", label: t("issues.sortSeverity") },
              { value: "DUE", label: t("issues.sortDue") },
            ]} />
          </div>}
        </div>

      {list.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
      {list.isError && <StateBlock kind="error" title={t("issues.loadFailed")} action={() => void list.refetch()} actionLabel={t("common.reload")} />}
      {!list.isLoading && !list.isError && items.length === 0 && (
        <StateBlock kind="empty" title={t(hasFilters ? "issues.empty" : "issues.noIssues")}
          description={hasFilters ? undefined : canCreate ? t("issues.noIssuesHint") : undefined}
          action={hasFilters ? clearFilters : canCreate ? () => setCreating(true) : undefined}
          actionLabel={hasFilters ? t("issues.clearFilters") : canCreate ? t("issues.create") : undefined} />
      )}
      {items.length > 0 && (
        <TableScroll className="issues-table-wrap" label={t("issues.listTitle")} resetKey={JSON.stringify([projectId, page, statusCategory, severity, priority, q, projectFilter, quick, sort])}>
          <table className="issues-table" aria-label={t("issues.listTitle")}>
            <colgroup><col className="issues-col-subject" /><col className="issues-col-status" /><col className="issues-col-severity" /><col className="issues-col-priority" /><col className="issues-col-person" /><col className="issues-col-person" /><col className="issues-col-date" /></colgroup>
            <thead><tr>
              <th>{t("common.title")}</th><th>{t("common.status")}</th>
              <th>{t("common.severity")}</th><th>{t("common.priority")}</th>
              <th>{t("issues.assignee")}</th><th>{t("issues.reporter")}</th><th>{t("common.dueDate")}</th>
            </tr></thead>
            <tbody>{items.map((r) => {
              const overdue = !!r.dueDate && r.dueDate < today && !!r.statusCategory && !["DONE", "TERMINAL", "CANCELLED"].includes(r.statusCategory);
              return (
              <tr key={r.id}>
                <td className="issues-table-subject">
                  <button className="issues-item-open" onClick={() => setOpenId(r.id)}>
                    <strong>{r.title}</strong>
                    <span className="issues-item-meta"><span>{r.key}</span>{isGlobal && r.projectName && <span>{r.projectName}</span>}<span>{t(`type.${r.type ?? "DEFECT"}`)}</span></span>
                  </button>
                </td>
                <td data-label={t("common.status")}><WorkItemTag kind="status" value={r.statusCategory} stateKey={r.statusKey} label={r.statusName} /></td>
                <td data-label={t("common.severity")}><WorkItemTag kind="severity" value={r.severity} /></td>
                <td data-label={t("common.priority")}><WorkItemTag kind="priority" value={r.priority} /></td>
                <td data-label={t("issues.assignee")}><span className="issue-assignee">{r.assigneeName && <span className="issue-avatar" aria-hidden="true">{Array.from(r.assigneeName)[0]}</span>}<span>{r.assigneeName ?? t("wie.unassigned")}</span></span></td>
                <td data-label={t("issues.reporter")} className="muted">{r.reporterName ?? "—"}</td>
                <td data-label={t("common.dueDate")}><span className="issue-due" data-overdue={overdue}>{r.dueDate ? <time dateTime={r.dueDate}>{r.dueDate}</time> : "—"}{overdue && <small>{t("common.overdue")}</small>}</span></td>
              </tr>
            ); })}</tbody>
          </table>
        </TableScroll>
      )}
      <PagePagination page={page} pages={pageCount} total={list.data?.total} onPage={setPage} />
      </section>

      <Drawer open={creating} onClose={() => void requestClose()} title={t("issues.create")} width="lg" className="task-editor-drawer"
        footer={<div className="task-form-actions">
          <span className="task-form-shortcut">{t("flows.submitShortcut")}</span>
          <Button variant="ghost" onClick={() => void requestClose()} disabled={submitting}>{t("common.cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting} disabled={!title.trim() || !targetProject}>{t(createdDraft.current ? "md.continueSave" : "common.create")}</Button>
        </div>}>
        <DraftNavigationGuard dirty={draftDirty} saving={submitting} message={t(createdDraft.current ? "md.closeCreated" : "flows.discardDraft")} />
        <form id={formId} className="issue-create-form task-form" aria-busy={submitting}
          onSubmit={(event) => { event.preventDefault(); void create(); }}
          onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void create(); } }}>
          <fieldset className="task-form-fields" disabled={submitting}>
          <div className="issue-create-section">
            <div className="issue-create-grid">
              {isGlobal && (
                <Select label={t("issues.projectColumn")} ariaLabel={t("issues.projectColumn")} value={createProjectId} disabled={!!createdDraft.current} onChange={(value) => { setCreateProjectId(value); setCreateAssignee(""); }} searchable
                  options={[{ value: "", label: t("issues.selectProject") }, ...(projectOptions.data ?? []).map((p) => ({ value: p.id, label: `${p.key} ${p.name}` }))]} />
              )}
              <TextInput label={t("common.title")} value={title} onChange={(e) => setTitle(e.target.value)} required
                placeholder={t("flows.issueTitleHint")} autoFocus />
              <MarkdownEditor label={t("common.description")} rows={5} value={desc} onChange={setDesc} images={images} disabled={submitting}
                placeholder={t("flows.issueDescriptionHint")} />
            </div>
          </div>

          <div className="issue-create-section">
            <h3 className="issue-create-heading">{t("flows.assignment")}</h3>
            <div className="issue-create-grid issue-create-grid--two">
              <Select label={t("common.severity")} ariaLabel={t("common.severity")} value={createSeverity} onChange={setCreateSeverity}
                options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
              <Select label={t("common.priority")} ariaLabel={t("common.priority")} value={createPriority} onChange={setCreatePriority}
                options={PRIORITIES.map((p) => ({ value: p, label: t(`prio.${p}`) }))} />
              <Select label={t("common.assignee")} ariaLabel={t("common.assignee")} value={createAssignee} onChange={setCreateAssignee} searchable
                options={[{ value: "", label: t("wie.unassigned") }, ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name || m.username, secondaryLabel: `@${m.username}` }))]} />
              <label className="issue-create-date">
                <span className="issue-create-label">{t("common.dueDate")}</span>
                <DatePicker value={createDueDate} onChange={setCreateDueDate} ariaLabel={t("common.dueDate")} placeholder={t("common.pickDate")} />
              </label>
            </div>
          </div>

          <div className="issue-create-section">
            <h3 className="issue-create-heading">{t("flows.attachments")}</h3>
            <input ref={fileInput} type="file" multiple hidden aria-label={t("flows.addAttachments")}
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            <button type="button" className="issue-attach-drop" onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}>
              <span><Icon name="upload" size={16} />{t("flows.dropFiles")}</span>
              <small>{t("flows.fileHint")}</small>
            </button>
            {files.length > 0 && (
              <ul className="issue-attach-list">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <span>{file.name}</span><small>{(file.size / 1024).toFixed(0)} KB</small>
                    <button type="button" className="chip" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>{t("wiDetail.remove")}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          </fieldset>
          {error && createdDraft.current && <p className="muted" role="status">{t("md.createdRetry")}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}

        </form>
      </Drawer>
      <WorkItemDrawer workItemId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
