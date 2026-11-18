/**
 * 里程碑详情（Round 62 · 对标 YouQu P1）
 *
 * 聚合里程碑本体、关联工作项、结构化进展记录（summary/next/blockers）、项目参与人。
 * 进展记录写权限 `milestone:manage`（与里程碑编辑一致）；评论暂未挂里程碑（评论服务仅对 WORK_ITEM
 * 做可见性判定，不为了详情页绕过它）——如实登记为后续项。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { t, useLocale } from "../i18n/index.ts";
import { apiDelete, apiGet, apiPost, ApiError } from "../lib/api.ts";
import { useCan } from "../lib/actor.ts";
import { relativeTime } from "../lib/time.ts";
import { PageHead } from "../components/Page.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { AttachmentsPanel } from "../components/work-item/AttachmentsPanel.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";

interface MilestoneRow {
  id: string; projectId: string; name: string; description: string | null;
  startDate: string | null; dueDate: string | null; progressMode: string;
  progressValue: string | null; completedAt: string | null; archivedAt: string | null;
}
interface RelatedWorkItem { id: string; key: string; title: string; type: string; statusName: string | null; statusCategory: string | null; priority: string | null; dueDate: string | null }
interface ProgressRow { id: string; summary: string; nextSteps: string | null; blockers: string | null; createdAt: string; authorName: string | null }
interface Detail {
  milestone: MilestoneRow;
  project: { id: string; key: string; name: string } | null;
  relatedWorkItems: RelatedWorkItem[];
  progressUpdates: ProgressRow[];
}
interface MemberRow { id: string; name: string; username: string; role_name: string | null }

export function MilestoneDetailPage() {
  useLocale();
  const qc = useQueryClient();
  const { projectId, milestoneId } = useParams({ from: "/_app/projects/$projectId/milestones/$milestoneId" });
  const canManage = useCan("milestone:manage");
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [blockers, setBlockers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const detail = useQuery({
    queryKey: queryKeys.milestoneDetail(milestoneId),
    queryFn: () => apiGet<Detail>(`/api/v1/milestones/${milestoneId}/detail`),
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => apiGet<{ members: MemberRow[] }>(`/api/v1/projects/${projectId}/members`).then((r) => r.members),
  });
  const ms = detail.data?.milestone;
  const add = async () => {
    if (saving || !summary.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/v1/milestones/${milestoneId}/progress-updates`, {
        summary: summary.trim(), nextSteps: nextSteps.trim() || null, blockers: blockers.trim() || null,
      });
      setSummary(""); setNextSteps(""); setBlockers(""); setOpen(false);
      await qc.invalidateQueries({ queryKey: queryKeys.milestoneDetail(milestoneId) });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("md.saveFailed")); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    try {
      await apiDelete(`/api/v1/milestone-progress-updates/${id}`);
      await qc.invalidateQueries({ queryKey: queryKeys.milestoneDetail(milestoneId) });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("md.saveFailed")); }
  };
  // COUNT 自动汇总：已进入 DONE 分类的关联工作项 / 总数（真实数据，不画假百分比）
  const related = detail.data?.relatedWorkItems ?? [];
  const doneCount = related.filter((w) => w.statusCategory === "DONE").length;
  const autoPercent = related.length > 0 ? Math.round((doneCount / related.length) * 100) : 0;
  const progress = ms?.progressMode === "MANUAL" && ms.progressValue !== null
    ? `${Number(ms.progressValue)}%`
    : ms?.progressMode === "COUNT" && related.length > 0
      ? `${autoPercent}%`
      : ms?.progressMode === "COUNT" ? "—" : ms?.progressMode ?? "—";
  const progressHint = ms?.progressMode === "MANUAL" ? "MANUAL" : ms?.progressMode === "COUNT" ? `${doneCount}/${related.length} 完成` : (ms?.progressMode ?? "");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="page project-refinement milestone-detail-page">
      <PageHead title={ms?.name ?? t("md.title")}
        sub={detail.data?.project ? `${detail.data.project.key} · ${detail.data.project.name}` : undefined}
        actions={
          <Link className="btn btn-sm btn-ghost" to="/projects/$projectId/milestones" params={{ projectId }}>{t("md.back")}</Link>
        } />
      {detail.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
      {detail.isError && <StateBlock kind="error" title={t("md.loadFailed")} description={detail.error instanceof ApiError ? detail.error.message : undefined}
        action={() => void detail.refetch()} actionLabel={t("common.reload")} />}
      {ms && (
        <>
          <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
            <MetricCard label={t("md.progress")} value={progress} detail={progressHint} tone="primary" />
            <MetricCard label={t("md.related")} value={detail.data?.relatedWorkItems.length ?? 0} detail={t("po.workItems")} />
            <MetricCard label={t("md.updates")} value={detail.data?.progressUpdates.length ?? 0} detail={t("md.progressLog")} />
            <MetricCard className="project-date-metric" label={t("md.due")} value={ms.dueDate ?? "—"} detail={ms.dueDate && ms.dueDate < today ? t("md.overdue") : ms.startDate ? `${ms.startDate} 起` : ""} tone={ms.dueDate && ms.dueDate < today ? "warning" : "neutral"} />
          </div>

          <div className="dashboard-grid">
            <div>
              <Panel>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <strong style={{ fontSize: "var(--text-sm)" }}>{t("md.progressLog")}</strong>
                  <span style={{ flex: 1 }} />
                  {canManage && <Button size="sm" disabled={saving} onClick={() => setOpen(!open)}>{open ? t("md.cancel") : t("md.add")}</Button>}
                </div>
                {error && <p className="field-error" role="alert">{error}</p>}
                {open && canManage && (
                  <div className="md-form">
                    <TextArea label={t("md.summary")} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
                    <TextArea label={t("md.nextSteps")} rows={2} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} />
                    <TextArea label={t("md.blockers")} rows={2} value={blockers} onChange={(e) => setBlockers(e.target.value)} />
                    <Button variant="primary" loading={saving} disabled={saving || !summary.trim()} onClick={() => void add()}>{t("md.submit")}</Button>
                  </div>
                )}
                {(detail.data?.progressUpdates ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("md.noUpdates")}</p>}
                <ul className="md-timeline">
                  {(detail.data?.progressUpdates ?? []).map((u) => (
                    <li key={u.id}>
                      <div className="md-timeline-head">
                        <strong>{u.authorName ?? t("md.unknownAuthor")}</strong>
                        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{relativeTime(u.createdAt)}</span>
                        {(canManage) && <Button size="sm" variant="ghost" onClick={async () => { if (await confirmDialog(t("md.deleteUpdateConfirm"), { danger: true })) await remove(u.id); }}>{t("common.delete")}</Button>}
                      </div>
                      <p className="md-summary">{u.summary}</p>
                      {u.nextSteps && <p className="md-line"><span className="muted">{t("md.nextSteps")}：</span>{u.nextSteps}</p>}
                      {u.blockers && <p className="md-line"><span className="muted">{t("md.blockers")}：</span>{u.blockers}</p>}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <div>
              <Panel>
                <strong style={{ fontSize: "var(--text-sm)" }}>{t("md.info")}</strong>
                <dl className="po-info-grid">
                  <dt>{t("md.start")}</dt><dd>{ms.startDate ?? "—"}</dd>
                  <dt>{t("md.due")}</dt><dd>{ms.dueDate ?? "—"}</dd>
                  <dt>{t("md.completed")}</dt><dd>{ms.completedAt ? new Date(ms.completedAt).toLocaleString() : "—"}</dd>
                  <dt>{t("md.status")}</dt><dd>{ms.archivedAt ? t("md.archived") : ms.completedAt ? t("md.done") : t("md.active")}</dd>
                </dl>
                {ms.description && <p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: 10 }}>{ms.description}</p>}
              </Panel>

              <Panel style={{ marginTop: 12 }}>
                <strong style={{ fontSize: "var(--text-sm)" }}>{t("md.related")}</strong>
                {(detail.data?.relatedWorkItems ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("md.noRelated")}</p>}
                <ul className="po-activity">
                  {(detail.data?.relatedWorkItems ?? []).map((w) => (
                    <li key={w.id}>
                      <span className="mono" style={{ fontSize: "var(--text-xs)" }}>{w.key}</span>
                      <button type="button" className="btn-link" style={{ flex: 1, textAlign: "left" }} onClick={() => setOpenItemId(w.id)}>{w.title}</button>
                      <span className="tag">{w.statusName ?? w.type}</span>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel style={{ marginTop: 12 }}>
                <strong style={{ fontSize: "var(--text-sm)" }}>{t("md.participants")}</strong>
                {members.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
                {members.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void members.refetch()} actionLabel={t("common.reload")} />}
                {members.isSuccess && (members.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("pm.empty")}</p>}
                <ul className="po-activity">
                  {(members.data ?? []).slice(0, 10).map((m) => (
                    <li key={m.id}>
                      <span className="row-avatar" aria-hidden="true" style={{ width: 22, height: 22, fontSize: 11 }}>{(m.name || m.username).slice(0, 1)}</span>
                      <span style={{ flex: 1 }}>{m.name}<span className="muted"> @{m.username}</span></span>
                      <span className="tag">{m.role_name ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <AttachmentsPanel targetType="MILESTONE" targetId={ms.id} />
            <CommentsPanel targetType="MILESTONE" targetId={ms.id} />
          </div>
        </>
      )}
      <WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} />
    </div>
  );
}
