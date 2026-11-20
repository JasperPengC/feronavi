import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * 项目列表（按原型 DESIGN-SPEC 第 3 节：标题行 + 紧凑指标 + 2/3 主列 + 1/3 辅列）
 *
 * 与旧版的差别（旧版是一个孤立表格 + 大片空白）：
 *   1 标题行带**紧凑指标**：项目数 / 工作项合计 / 状态分布 —— 全部来自接口真实字段，不编指标
 *   2 主列 2/3 是项目表（描述、状态、工作项数带相对量条），辅列 1/3 是**我的待办**
 *   3 行悬停、键盘焦点、进入动画（见 shell.css；尊重 prefers-reduced-motion）
 */
import { queryKeys } from "../lib/query-keys.ts";
import { t, useLocale } from "../i18n/index.ts";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { useCan } from "../lib/actor.ts";
import { relativeTime } from "../lib/time.ts";
import { Select } from "../components/Select.tsx";
import { apiPatch } from "../lib/api.ts";
import { Icon } from "../components/Icon.tsx";
import { PageHead } from "../components/Page.tsx";
import { Button } from "../components/ui/Button.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { Modal } from "../components/ui/Modal.tsx";
import { useSettingsDraft } from "../components/settings/SettingsDraft.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { ProjectMembersDrawer } from "../components/ProjectMembersDrawer.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";

interface ProjectItem {
  id: string; key: string; name: string; description: string | null;
  /** 接口**已返回**这两个字段（routes/projects.ts 的列表响应），此前客户端类型漏声明 —— 补齐以便用真实更新时间 */
  updatedAt: string | null; createdAt: string | null;
  /** 负责人（第 25 轮）：接口返回，可能为 null（该项目尚未指定负责人） */
  lead: { id: string; name: string } | null;
  status: { key: string; name: string; category: string; color: string } | null;
  archivedAt: string | null; workItemCount: number;
  departmentId?: string | null; departmentName?: string | null;
  insights?: { overdueMilestones: number; overdueWorkItems: number; urgentDefects: number; lastActivityAt: string | null; memberCount: number } | null;
}
/** 状态色 token → 原型状态标签类名。标签始终带文字，不依赖颜色单独传达信息。 */
function stateClass(color: string | undefined): string {
  switch (color) {
    case "info": return "state-cyan";
    case "warning": return "state-amber";
    case "success": return "state-cyan";
    case "danger": return "state-red";
    default: return "state-blue";
  }
}

function projectMarkClass(color: string | undefined): string {
  switch (color) {
    case "warning": return "mark-amber";
    case "success": return "mark-cyan";
    case "danger": return "mark-violet";
    default: return "mark-blue";
  }
}

export function ProjectListPage() {
  useLocale();   // 订阅语言，切换即时生效
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canCreate = useCan("project:create");
  const canManageMember = useCan("project:manage_member");
  const [memberProject, setMemberProject] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: "", name: "", description: "", departmentId: "" });
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiGet<{ departments: { id: string; name: string }[] }>("/api/v1/departments").then((r) => r.departments),
    enabled: canCreate && open,
    retry: false,
  });
  const templates = useQuery({
    queryKey: ["project-templates"],
    queryFn: () => apiGet<{ templates: { id: string; name: string; isBuiltin: boolean }[] }>("/api/v1/project-templates").then((r) => r.templates),
    enabled: canCreate && open,
    retry: false,
  });

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => apiGet<{ items: ProjectItem[]; total: number }>("/api/v1/projects"),
  });
  const create = useMutation({
    mutationFn: () => templateId
      ? apiPost<{ project: { id: string }; applied: { milestones: number; iterations: number; workItems: number } }>(
        "/api/v1/projects/from-template", {
          key: form.key.toUpperCase(), name: form.name, description: form.description || null, templateId,
        })
      : apiPost("/api/v1/projects", {
        key: form.key.toUpperCase(), name: form.name, description: form.description || null,
        departmentId: form.departmentId || null,
      }),
    onSuccess: async (result) => {
      setOpen(false);
      setForm({ key: "", name: "", description: "", departmentId: "" });
      setTemplateId("");
      setError(null);
      if (result && typeof result === "object" && "applied" in result) {
        const a = (result as { applied: { milestones: number; iterations: number; workItems: number } }).applied;
        toast.success(t("projects.templateApplied", { m: String(a.milestones), i: String(a.iterations), w: String(a.workItems) }));
      }
      await qc.invalidateQueries({ queryKey: queryKeys.projects() });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("projects.createFailed")),
  });

  const draft = useSettingsDraft(open, { form, templateId }, create.isPending);
  const requestClose = () => void draft.leave(() => {
    setOpen(false); setForm({ key: "", name: "", description: "", departmentId: "" }); setTemplateId(""); setError(null);
  });

  const keyOk = /^[A-Z][A-Z0-9]{1,9}$/.test(form.key.toUpperCase());

  const items = data?.items ?? [];
  const [kw, setKw] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "risk" | "done">("all");
  const [view, setView] = useState<"table" | "card">("table");
  const activeCount = items.filter((p) => /进行|评审/.test(p.status?.name ?? "") || p.status?.category === "IN_PROGRESS").length;
  const hasRisk = (p: ProjectItem) => !!p.insights && (p.insights.overdueMilestones > 0 || p.insights.overdueWorkItems > 0
    || p.insights.urgentDefects > 0 || (p.insights.lastActivityAt ? (Date.now() - new Date(p.insights.lastActivityAt).getTime()) > 14 * 86400_000 : false));
  const riskCount = items.filter((p) => hasRisk(p) || p.status?.color === "warning" || p.status?.color === "danger").length;
  const doneCount = items.filter((p) => /完成|归档/.test(p.status?.name ?? "") || p.status?.category === "DONE").length;
  const shown = items.filter((p) => {
    const okStatus = filter === "all"
      || (filter === "active" && (activeCount > 0 && (/进行|评审/.test(p.status?.name ?? "") || p.status?.category === "IN_PROGRESS")))
      || (filter === "risk" && (hasRisk(p) || p.status?.color === "warning" || p.status?.color === "danger"))
      || (filter === "done" && (/完成|归档/.test(p.status?.name ?? "") || p.status?.category === "DONE"));
    const k = kw.trim().toLowerCase();
    const okKw = !k || p.name.toLowerCase().includes(k) || p.key.toLowerCase().includes(k);
    return okStatus && okKw;
  });
  /** key 规则提示：正常时当 hint，key 不合法时当 error（同一段富文本，不写两份） */
  const keyRuleText = <>{t("pl.keyRule")}<strong>{t("pl.keyImmutable")}</strong>{t("pl.keyPrefix")}</>;


  return (
    <div className={`page project-list-page${view === "table" ? " data-page" : ""}`}>
      <PageHead
        title={t("projects.title")}
        actions={canCreate && (
          <Button variant="primary" onClick={() => setOpen(true)}><Icon name="plus" size={14} />{t("projects.new")}</Button>
        )}
      />
      {isLoading && <LoadingBlock />}
      {isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={loadError instanceof ApiError ? loadError.message : undefined}
        action={() => void refetch()} actionLabel={t("common.reload")} />}
      {!isLoading && !isError && items.length === 0 && (
        <StateBlock kind="empty" title={t("projects.empty")} description={t("projects.emptyHint")}
          action={canCreate ? () => setOpen(true) : undefined} actionLabel={canCreate ? t("projects.emptyCta") : undefined} />
      )}
      {!!items.length && (
        <section className="panel table-shell data-fill" data-view={view}>
          <div className="filter-bar">
            <div className="filter-tabs ui-segmented" role="group" aria-label={t("projects.filterLabel")}>
              <button type="button" className="ui-segmented-item" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("common.all")} {items.length}</button>
              <button type="button" className="ui-segmented-item" aria-pressed={filter === "active"} onClick={() => setFilter("active")}>{t("projects.filterActive")} {activeCount}</button>
              <button type="button" className="ui-segmented-item" aria-pressed={filter === "risk"} onClick={() => setFilter("risk")}>{t("projects.filterRisk")} {riskCount}</button>
              <button type="button" className="ui-segmented-item" aria-pressed={filter === "done"} onClick={() => setFilter("done")}>{t("projects.filterDone")} {doneCount}</button>
            </div>
            <div className="project-filter-actions">
              <div className="project-search-controls">
                <Icon name="search" size={15} />
                <TextInput type="search" inputClassName="project-search" value={kw} onChange={(e) => setKw(e.target.value)} placeholder={t("common.search")} aria-label={t("common.search")} />
              </div>
              <div className="project-view-controls ui-segmented" role="group" aria-label={t("nav.projects")}>
              <button type="button" className="ui-segmented-item ui-segmented-item--icon" aria-label={t("projects.cardView")} title={t("projects.cardView")} aria-pressed={view === "card"} onClick={() => setView("card")}><Icon name="grid" size={16} /></button>
              <button type="button" className="ui-segmented-item ui-segmented-item--icon" aria-label={t("projects.tableView")} title={t("projects.tableView")} aria-pressed={view === "table"} onClick={() => setView("table")}><Icon name="table" size={16} /></button>
              </div>
            </div>
          </div>
          {shown.length === 0 && <StateBlock kind="empty" title={t("common.noMatches")}
            action={() => { setKw(""); setFilter("all"); }} actionLabel={t("board.clearFilters")} />}
          {view === "card" && (
            <div className="project-card-grid" role="list">
              {shown.map((p) => (
                <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="project-card" role="listitem">
                  <div className="project-card-top">
                    <span className={`project-mark row-avatar ${projectMarkClass(p.status?.color)}`}>{(p.name || p.key).slice(0, 1).toUpperCase()}</span>
                    <span className="tag">{p.key}</span>
                    {p.status && <span className={`state-tag ${stateClass(p.status.color)}`}>{p.status.name}</span>}
                  </div>
                  <strong className="project-card-name">{p.name}</strong>
                  <p className="muted project-card-desc">{p.description ?? t("projects.noDescription")}</p>
                  <div className="project-risk-chips">
                    {p.insights?.overdueMilestones ? <span className="tag tag-warning">{t("projects.riskMilestone", { n: String(p.insights.overdueMilestones) })}</span> : null}
                    {p.insights?.overdueWorkItems ? <span className="tag tag-warning">{t("projects.riskItem", { n: String(p.insights.overdueWorkItems) })}</span> : null}
                    {p.insights?.urgentDefects ? <span className="tag tag-danger">{t("projects.riskDefect", { n: String(p.insights.urgentDefects) })}</span> : null}
                    {!p.insights || (!p.insights.overdueMilestones && !p.insights.overdueWorkItems && !p.insights.urgentDefects) ? <span className="tag tag-success">{t("projects.riskNone")}</span> : null}
                  </div>
                  <div className="project-card-meta">
                    <span><Icon name="users" size={13} />{p.insights?.memberCount ?? 0}</span>
                    <span><Icon name="list" size={13} />{p.workItemCount}</span>
                    <span className="muted">{relativeTime(p.updatedAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {view === "table" && (<TableScroll className="table-scroll" label={t("projects.title")} resetKey={JSON.stringify([filter, kw])}>
            <table className="data-table projects-table">
              <thead><tr><th>{t("projects.colName")}</th><th>{t("projects.colStatus")}</th><th>{t("projects.colProgress")}</th><th>{t("projects.colLeadShort")}</th><th>{t("projects.colUpdated")}</th><th className="table-actions">{t("common.actions")}</th></tr></thead>
              <tbody>
                {shown.map((p) => {
                  return (
                    <tr key={p.id} tabIndex={0}
                      onClick={(e) => {
                        // 整行可点进项目概览；但行内已有链接/下拉/按钮时让它们自己处理
                        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, [role='button'], [role='combobox']")) return;
                        void navigate({ to: "/projects/$projectId", params: { projectId: p.id } });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) void navigate({ to: "/projects/$projectId", params: { projectId: p.id } });
                      }}>
                      <td data-label={t("projects.colName")}>
                        <Link className="table-project" to="/projects/$projectId" params={{ projectId: p.id }}>
                          <span className={`project-mark row-avatar ${projectMarkClass(p.status?.color)}`}>{(p.name || p.key).slice(0, 1).toUpperCase()}</span>
                          <span className="row-name"><strong>{p.name}</strong><small>{p.key}{p.description ? ` · ${p.description}` : ""}</small>
                            {p.insights && (hasRisk(p)
                              ? <span className="project-risk-chips">
                                  {p.insights.overdueMilestones > 0 && <span className="tag tag-warning">{t("projects.riskMilestone", { n: String(p.insights.overdueMilestones) })}</span>}
                                  {p.insights.overdueWorkItems > 0 && <span className="tag tag-warning">{t("projects.riskItem", { n: String(p.insights.overdueWorkItems) })}</span>}
                                  {p.insights.urgentDefects > 0 && <span className="tag tag-danger">{t("projects.riskDefect", { n: String(p.insights.urgentDefects) })}</span>}
                                  {p.insights.lastActivityAt && (Date.now() - new Date(p.insights.lastActivityAt).getTime()) > 14 * 86400_000 && <span className="tag">{t("projects.riskStale")}</span>}
                                </span>
                              : <span className="project-risk-chips"><span className="tag tag-success">{t("projects.riskNone")}</span></span>)}
                          </span>
                        </Link>
                      </td>
                      <td data-label={t("projects.colStatus")}>{p.status ? <span className={`state-tag ${stateClass(p.status.color)}`}>{p.status.name}</span> : <span className="muted">—</span>}</td>
                      <td data-label={t("projects.colProgress")}><span className="project-progress" title={t("projects.progressHint", { n: String(p.workItemCount) })}><b>{p.workItemCount}<small>{t("projects.itemUnit")}</small></b></span></td>
                      <td data-label={t("projects.colLeadShort")}>
                        <span className="owner project-owner">
                          <i>{p.lead?.name?.slice(0, 1) ?? "—"}</i>
                          <span className="owner-name">{p.lead?.name ?? "—"}</span>
                          <span className="project-owner-control"><LeadSelect projectId={p.id} lead={p.lead} /></span>
                        </span>
                      </td>
                      <td data-label={t("projects.colUpdated")} className="muted">{relativeTime(p.updatedAt)}</td>
                      <td data-label={t("projects.colActions")} style={{ whiteSpace: "nowrap" }}>
                        <Link className="icon-button" to="/projects/$projectId/board" params={{ projectId: p.id }} aria-label={t("projects.openBoard")} title={t("projects.openBoard")}><Icon name="grid" size={15} /></Link>
                        {canManageMember && (
                          <Button size="sm" iconOnly variant="ghost" aria-label={`${t("pm.title")} ${p.name}`} title={t("pm.title")}
                            onClick={() => setMemberProject({ id: p.id, name: p.name })}><Icon name="users" size={15} /></Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>)}
        </section>
      )}

      {draft.guard}
      <Modal open={open} title={t("projects.new")} onClose={requestClose}
        footer={<div className="task-form-actions">
          <Button variant="ghost" onClick={requestClose} disabled={create.isPending}>{t("pl.cancel")}</Button>
          <Button variant="primary" loading={create.isPending} disabled={!keyOk || !form.name.trim() || create.isPending} onClick={() => { if (!create.isPending) { setError(null); create.mutate(); } }}>{t("projects.create")}</Button>
        </div>}>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <fieldset disabled={create.isPending} className="settings-form-fields" style={{ display: "grid", gap: 16 }}>
        <Select label={t("projects.template")} ariaLabel={t("projects.template")} value={templateId}
          onChange={setTemplateId}
          options={[{ value: "", label: t("projects.noTemplate") },
            ...(templates.data ?? []).map((x) => ({ value: x.id, label: `${x.name}${x.isBuiltin ? "（内置）" : ""}` }))]} />
        <TextInput id="p-key" label={t("pl.key")} inputClassName="mono" value={form.key} placeholder="DEMO"
          error={form.key && !keyOk ? keyRuleText : undefined}
          hint={form.key && !keyOk ? undefined : keyRuleText}
          onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })} />
        <TextInput id="p-name" label={t("pl.name")} value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextArea id="p-desc" label={t("pl.desc")} rows={3} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {!templateId && (
          <Select label={t("org.department")} ariaLabel={t("org.department")} value={form.departmentId}
            onChange={(v) => setForm({ ...form, departmentId: v })}
            options={[{ value: "", label: t("org.noDepartment") }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
        )}
        </fieldset>
      </Modal>

      <ProjectMembersDrawer project={memberProject} onClose={() => setMemberProject(null)} />
    </div>
  );
}

/**
 * 负责人下拉（第 27 轮）—— 「负责人」这条线的最后一步：让它在**界面上可指定**。
 *
 * 成员来自 `GET /api/v1/projects/:id/members`（负责人本就该是项目成员）；
 * 指定走 `PATCH /api/v1/projects/:id { leadMemberId }`，空选项表示**清空**（null）。
 * 复用已落库的 `Select`（键盘可达、样式统一），不另造控件。
 */
function LeadSelect({ projectId, lead }: { projectId: string; lead: { id: string; name: string } | null }) {
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: ["project-members", projectId],
    // ⚠️ 与 ProjectMembersDrawer 共用同一 queryKey：**缓存形状必须一致（数组）**。
    // 此前这里返回整个响应对象、抽屉返回数组 → 抽屉读到对象后列表永远为空（Round 55 复验踩到）。
    queryFn: () => apiGet<{ members: { id: string; name: string }[] }>(`/api/v1/projects/${projectId}/members`).then((r) => r.members),
    staleTime: 60_000,
  });
  const setLead = useMutation({
    mutationFn: (v: string) => apiPatch(`/api/v1/projects/${projectId}`, { leadMemberId: v || null }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: queryKeys.projects() }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("common.loadFailedShort")),
  });
  const opts = [{ value: "", label: "—" },
    ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))];
  return (
    <Select value={lead?.id ?? ""} options={opts} size="sm" ariaLabel={t("pl.colLead")}
      disabled={setLead.isPending || !members.isSuccess}
      onChange={(v) => setLead.mutate(v)} />
  );
}
