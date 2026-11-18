/** 项目集详情：汇总、项目进度、风险、里程碑、最近活动（P1-5） */
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "../lib/api.ts";
import { PageHead } from "../components/Page.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { Icon } from "../components/Icon.tsx";
import { currentLocale, t, useLocale } from "../i18n/index.ts";
import { StateBlock } from "../components/ui/StateBlock.tsx";

interface Summary {
  portfolio: { id: string; name: string; createdAt: string };
  projects: { id: string; key: string; name: string; status: { name: string } | null; total: number; done: number; overdue: number; progress: number; insights: { overdueMilestones: number; overdueWorkItems: number; urgentDefects: number; lastActivityAt: string | null; memberCount: number } | null }[];
  totals: { projectCount: number; workItemCount: number; doneCount: number; overdueCount: number; completionPercent: number };
  risks: { projectId: string; projectName: string; type: string; count: number }[];
  milestones: { id: string; projectId: string; projectName: string; name: string; dueDate: string | null; completedAt: string | null }[];
  activity: { id: string; projectId: string | null; projectName: string; summary: string; createdAt: string }[];
}

const RISK_LABEL: Record<string, string> = { OVERDUE_ITEM: "pf.riskOverdueItem", OVERDUE_MILESTONE: "pf.riskOverdueMilestone", URGENT_DEFECT: "pf.riskUrgentDefect" };

export function PortfolioDetailPage() {
  useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useQuery({ queryKey: ["portfolio-summary", id], queryFn: () => apiGet<Summary>(`/api/v1/portfolios/${id}/summary`), enabled: !!id });
  if (q.isLoading) return <div className="page"><PageHead title={t("pf.title")} /><p className="muted">{t("common.loading")}</p></div>;
  if (q.isError || !q.data) return <div className="page"><PageHead title={t("pf.title")} />
    <StateBlock kind={q.error instanceof ApiError && q.error.status === 403 ? "restricted" : "error"}
      title={t(q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) ? "pf.unavailable" : "common.loadFailedShort")}
      action={() => void q.refetch()} actionLabel={t("common.reload")} />
    <Link className="btn btn-sm" to="/portfolios">{t("pf.back")}</Link></div>;
  const d = q.data;
  return (
    <div className="page collection-page portfolio-detail-page">
      <PageHead title={d.portfolio.name} hint={t("pf.scopeHint")}
        actions={<Link className="btn btn-sm" to="/portfolios">{t("pf.back")}</Link>} />
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <MetricCard label={t("pf.colProjects")} value={d.totals.projectCount} tone="primary" />
        <MetricCard label={t("po.workItems")} value={d.totals.workItemCount} />
        <MetricCard label={t("pf.completionRate")} value={`${d.totals.completionPercent}%`} detail={t("pf.completedCount", { n: d.totals.doneCount })} tone="success" />
        <MetricCard label={t("pf.overdue")} value={d.totals.overdueCount} tone={d.totals.overdueCount > 0 ? "warning" : "neutral"} />
      </div>

      <div className="portfolio-detail-grid">
        <section className="panel" style={{ padding: 18 }}>
          <h2 className="section-title">{t("pf.valueRhythm")}</h2>
          {d.projects.length === 0 && <p className="muted">{t("pf.noVisibleProjects")}</p>}
          <div className="portfolio-project-list">
            {d.projects.map((p) => (
              <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="portfolio-project-row">
                <span className="row-avatar"><Icon name="folder" size={13} /></span>
                <span className="portfolio-project-main"><strong>{p.name}</strong><small>{p.key}{p.status ? ` · ${p.status.name}` : ""}</small></span>
                <span className="portfolio-progress-wrap"><span className="portfolio-progress"><i style={{ width: `${p.progress}%` }} /></span><small>{p.progress}% · {p.done}/{p.total}</small></span>
                <span className={`tag ${p.overdue > 0 ? "tag-warning" : "tag-success"}`}>{p.overdue > 0 ? t("pf.overdueCount", { n: p.overdue }) : t("pf.noOverdue")}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="panel" style={{ padding: 18 }}>
          <h2 className="section-title">{t("pf.risks")}</h2>
          {d.risks.length === 0 && <p className="muted">{t("pf.noRisks")}</p>}
          <ul className="portfolio-risk-list">
            {d.risks.map((r) => (
              <li key={`${r.projectId}:${r.type}`}>
                <span className={`tag ${r.type === "URGENT_DEFECT" ? "tag-danger" : "tag-warning"}`}>{RISK_LABEL[r.type] ? t(RISK_LABEL[r.type]!) : r.type}</span>
                <Link to="/projects/$projectId" params={{ projectId: r.projectId }}>{r.projectName}</Link>
                <strong>{r.count}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="portfolio-detail-grid" style={{ marginTop: 16 }}>
        <section className="panel" style={{ padding: 18 }}>
          <h2 className="section-title">{t("nav.milestones")}</h2>
          {d.milestones.length === 0 && <p className="muted">{t("pf.noMilestones")}</p>}
          <ul className="portfolio-milestone-list">
            {d.milestones.slice(0, 12).map((m) => {
              const overdue = m.dueDate && new Date(m.dueDate) < new Date() && !m.completedAt;
              return <li key={m.id}><span className={`status-pill ${overdue ? "tag-warning" : ""}`}>{overdue ? t("pf.overdue") : m.completedAt ? t("pf.completed") : t("pf.inProgress")}</span><Link to="/projects/$projectId/milestones/$milestoneId" params={{ projectId: m.projectId, milestoneId: m.id }} className="portfolio-ms-name">{m.name}</Link><small>{m.projectName} · {m.dueDate ?? t("pf.noDueDate")}</small></li>;
            })}
          </ul>
        </section>
        <section className="panel" style={{ padding: 18 }}>
          <h2 className="section-title">{t("pf.recentActivity")}</h2>
          {d.activity.length === 0 && <p className="muted">{t("pf.noActivity")}</p>}
          <ul className="portfolio-activity-list">
            {d.activity.map((a) => <li key={a.id}><span>{a.summary}</span><small>{a.projectName} · {new Date(a.createdAt).toLocaleString(currentLocale())}</small></li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
