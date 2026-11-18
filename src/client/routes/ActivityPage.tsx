import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * 项目活动（Round 25 长任务第 4 项）
 *
 * 数据来自 `GET /api/v1/projects/:id/activity`（分页，接口早已就绪、此前前端零消费）。
 * 活动摘要是**服务端预渲染的文案**（audit.service 纪律：前端不拼装），本页只负责呈现：
 *   · 命中哪类对象 → 对应图标（工作项/里程碑/项目/公告/角色…）
 *   · 摘要 + 事件代码（mono 小字，便于排障对齐审计）
 *   · 相对时间（悬停看绝对时间）
 * 空态明确告诉用户"什么操作会产生活动"，而不是一句"暂无数据"。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api.ts";
import { Chip, EmptyState, PageHead } from "../components/Page.tsx";
import { Button } from "../components/ui/Button.tsx";
import { PagePagination } from "../components/ui/PagePagination.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { t as tr, useLocale, currentLocale } from "../i18n/index.ts";
import { relativeTime } from "../lib/time.ts";
import { toast } from "../components/ui/Toast.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";

interface ActivityItem {
  id: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  action: string;
  summary: string;
  createdAt: string;
}

const PAGE_SIZE = 30;

/** 筛选项：value 是 action 前缀（空 = 全部），label 走 i18n */
const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "activity.catAll" },
  { value: "work_item", label: "activity.catWorkItem" },
  { value: "comment", label: "activity.catComment" },
  { value: "wiki", label: "activity.catWiki" },
  { value: "attachment", label: "activity.catAttachment" },
  { value: "plan", label: "activity.catPlan" },
  { value: "project", label: "activity.catProject" },
  { value: "announcement", label: "activity.catAnnouncement" },
  { value: "role", label: "activity.catRole" },
  { value: "workflow", label: "activity.catWorkflow" },
  { value: "field", label: "activity.catField" },
  { value: "import", label: "activity.catImport" },
  { value: "intake", label: "activity.catIntake" },
  { value: "insight", label: "activity.catInsight" },
  { value: "idea", label: "activity.catIdea" },
];

/** 对象类型 → 图标（与项目内导航/行图标同一套语义） */
const TARGET_ICON: Record<string, IconName> = {
  WORK_ITEM: "list",
  MILESTONE: "flag",
  ITERATION: "chart",
  RELEASE: "package",
  MODULE: "grid",
  PROJECT: "layers",
  ANNOUNCEMENT: "megaphone",
  ROLE: "shield",
  ROLE_ASSIGNMENT: "shield",
  IDEA: "spark",
  WORKFLOW: "workflow",
  WORKFLOW_STATE: "workflow",
  WORKFLOW_TRANSITION: "workflow",
  CUSTOM_FIELD: "sliders",
  IMPORT_BATCH: "upload",
  INTAKE_FORM: "inbox",
  INTAKE_SUBMISSION: "inbox",
  DASHBOARD: "chart",
  DASHBOARD_WIDGET: "chart",
  PAGE: "book",
  ATTACHMENT: "file",
};

export function ActivityPage() {
  useLocale();
  const { projectId } = useParams({ from: "/_app/projects/$projectId/activity" });
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  // 输入防抖：避免每敲一个字都打一次接口
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(qDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [qDraft]);
  // 筛选条件变化时回到第 1 页
  useEffect(() => { setPage(1); }, [category, keyword, mineOnly, fromDate, toDate]);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (category) query.set("category", category);
  if (keyword) query.set("q", keyword);
  if (mineOnly) query.set("mine", "1");
  if (fromDate) query.set("from", fromDate);
  if (toDate) query.set("to", toDate);

  const q = useQuery({
    queryKey: queryKeys.projectActivity(projectId, category, keyword, mineOnly, fromDate, toDate, page),
    queryFn: () => apiGet<{ items: ActivityItem[]; total: number; page: number; pageSize: number }>(
      `/api/v1/projects/${projectId}/activity?${query.toString()}`),
    retry: false,
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** 导出当前筛选结果为 CSV（cookie 鉴权 + Blob 下载，不新开页面） */
  async function exportCsv() {
    const filters = new URLSearchParams();
    if (category) filters.set("category", category);
    if (keyword) filters.set("q", keyword);
    if (mineOnly) filters.set("mine", "1");
    if (fromDate) filters.set("from", fromDate);
    if (toDate) filters.set("to", toDate);
    setExporting(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/activity/export?${filters.toString()}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-${projectId.slice(0, 8)}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(tr("activity.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page project-refinement activity-page paginated-page data-page">
      <PageHead
        title={tr("activity.title")}
        actions={<span className="muted" style={{ fontSize: "var(--text-xs)" }}>{tr("activity.total", { n: String(total) })}</span>}
      />

      <div className="project-activity-controls">
      <div className="toolbar activity-filter-controls">
        <TextInput inputClassName="activity-search" style={{ width: 240 }} placeholder={tr("activity.searchPlaceholder")}
          aria-label={tr("activity.searchPlaceholder")} value={qDraft} onChange={(e) => setQDraft(e.target.value)} />
        <Chip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>{tr("activity.mineOnly")}</Chip>
        <label className="date-filter"><span>{tr("activity.from")}</span><TextInput inputClassName="activity-date" type="date"
          value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label className="date-filter"><span>{tr("activity.to")}</span><TextInput inputClassName="activity-date" type="date"
          value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        {(fromDate || toDate) && (
          <Button size="sm" variant="ghost" onClick={() => { setFromDate(""); setToDate(""); }}>{tr("activity.clearDates")}</Button>
        )}
        <Button size="sm" loading={exporting} disabled={exporting || items.length === 0} onClick={() => void exportCsv()}>
          <Icon name="download" size={14} />{tr("activity.exportCsv")}
        </Button>
      </div>
      <div className="ui-segmented activity-category-controls" role="group" aria-label={tr("activity.title")}>
        {CATEGORIES.map((c) => (
          <button type="button" className="ui-segmented-item" key={c.value || "all"} aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
            {tr(c.label)}
          </button>
        ))}
      </div>

      </div>

      {q.isLoading && <StateBlock kind="loading" title={tr("common.loading")} />}
      {q.isError && <StateBlock kind="error" title={tr("activity.loadFailed")} action={() => void q.refetch()} actionLabel={tr("common.reload")} />}

      {!q.isLoading && !q.isError && items.length === 0 && (
        category || keyword || mineOnly || fromDate || toDate
          ? <EmptyState title={tr("activity.noMatch")} hint={tr("activity.noMatchHint")} />
          : <EmptyState title={tr("activity.empty")} hint={tr("activity.emptyHint")} />
      )}

      {items.length > 0 && (
        <TableScroll className="panel activity-list-scroll" label={tr("activity.title")} resetKey={JSON.stringify([page, category, keyword, mineOnly, fromDate, toDate])}>
          <ul className="activity-list">
            {items.map((a) => (
              <li key={a.id} className="activity-row">
                <span className="row-avatar" aria-hidden="true"><Icon name={TARGET_ICON[a.targetType] ?? "activity"} size={13} /></span>
                <span className="activity-main">
                  {a.targetId && a.targetType === "WORK_ITEM" ? <button type="button" className="activity-summary btn-link" style={{ textAlign: "left" }} onClick={() => setOpenItemId(a.targetId)}>{a.summary}</button>
                    : a.targetId && a.targetType === "MILESTONE" ? <Link className="activity-summary" to="/projects/$projectId/milestones/$milestoneId" params={{ projectId, milestoneId: a.targetId }}>{a.summary}</Link>
                    : a.targetId && a.targetType === "PAGE" ? <Link className="activity-summary" to="/projects/$projectId/wiki" params={{ projectId }} search={{ page: a.targetId }}>{a.summary}</Link>
                    : <span className="activity-summary">{a.summary}</span>}
                  <span className="activity-action mono"><span className="tag">{a.action}</span></span>
                </span>
                <time className="activity-time" dateTime={a.createdAt}
                  title={new Date(a.createdAt).toLocaleString(currentLocale())}>
                  {relativeTime(a.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        </TableScroll>
      )}

      <PagePagination page={page} pages={pages} total={total} onPage={setPage} />
      <WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} />
    </div>
  );
}
