/**
 * 项目详情/概览页（Round 62 · 对标 YouQu 的 P0 差距）
 *
 * 对标发现：Feronavi 从项目列表直接跳看板，**没有项目落地页** —— 项目信息、成员、实体计数、
 * 最近活动、临期里程碑无处查看。本页复用现有 API 聚合，作为项目内所有视图的入口。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { t, useLocale } from "../i18n/index.ts";
import { apiGet } from "../lib/api.ts";
import { relativeTime } from "../lib/time.ts";
import { PageHead } from "../components/Page.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { LinkButton } from "../components/ui/LinkButton.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ArrowLink } from "../components/ui/ArrowLink.tsx";
import { WorkItemEditor } from "../components/work-item/WorkItemEditor.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { ProjectMembersDrawer } from "../components/ProjectMembersDrawer.tsx";
import { firstGrapheme } from "../lib/first-grapheme.ts";
import { ProjectSettingsDrawer } from "../components/project/ProjectSettingsDrawer.tsx";
import { useCan } from "../lib/actor.ts";

interface ProjectItem {
  id: string; key: string; name: string; description: string | null;
  status: { key: string; name: string; category: string; color: string } | null;
  lead: { id: string; name: string } | null;
  archivedAt: string | null; workItemCount: number;
  createdAt: string | null; updatedAt: string | null;
  departmentId?: string | null; departmentName?: string | null;
}
interface BoardColumn { stateKey: string; name: string; category: string; items: unknown[]; count: number }
interface MilestoneRow { id: string; name: string; dueDate: string | null; archivedAt: string | null }
interface IterationRow { id: string; name: string; startDate: string | null; endDate: string | null }
interface MemberRow { id: string; name: string; username: string; role_name: string | null }
interface ActivityItem { id: string; action: string; summary: string; createdAt: string }


export function ProjectOverviewPage() {
  useLocale();
  const canManage = useCan("project:update");
  const canManageMembers = useCan("project:manage_member");
  const canCreate = useCan("work_item:create");
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  // ⚠️ queryKey 不能用 ["projects"]：项目列表页同 key 缓存的是 {items,total}（对象），
  //    从列表 SPA 点进来时 `.find` 会炸（Round 62 浏览器验收踩到）。用独立 key + 数组形状。
  const projects = useQuery({
    queryKey: queryKeys.projectOverview(projectId),
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects").then((r) => (Array.isArray(r.items) ? r.items : [])),
  });
  const project = (Array.isArray(projects.data) ? projects.data : []).find((p) => p.id === projectId) ?? null;
  const board = useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: () => apiGet<{ columns: BoardColumn[] }>(`/api/v1/projects/${projectId}/work-items/board`),
  });
  const milestones = useQuery({
    queryKey: queryKeys.milestones(projectId),
    queryFn: () => apiGet<MilestoneRow[]>(`/api/v1/projects/${projectId}/milestones`),
  });
  const iterations = useQuery({
    queryKey: queryKeys.iterations(projectId),
    queryFn: () => apiGet<IterationRow[]>(`/api/v1/projects/${projectId}/iterations`),
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => apiGet<{ members: MemberRow[] }>(`/api/v1/projects/${projectId}/members`).then((r) => r.members),
  });
  const activity = useQuery({
    queryKey: queryKeys.projectActivity(projectId),
    queryFn: () => apiGet<{ items: ActivityItem[] }>(`/api/v1/projects/${projectId}/activity?pageSize=8`).then((r) => r.items),
  });

  const totalWorkItems = project?.workItemCount ?? 0;
  const openWorkItems = (board.data?.columns ?? []).filter((c) => !["TERMINAL", "DONE", "CANCELLED"].includes(c.category))
    .reduce((n, c) => n + c.count, 0);
  const milestoneCount = (milestones.data ?? []).filter((m) => !m.archivedAt).length;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (milestones.data ?? [])
    .filter((m) => !m.archivedAt && m.dueDate)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 5);

  const [createOpen, setCreateOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const loading = projects.isLoading;
  return (
    <div className="page project-refinement project-overview-page">
      <PageHead title={project ? `${project.name}` : t("po.title")}
        sub={project ? <span className="po-header-meta"><span>{project.key}</span>{project.status && <span>{project.status.name}</span>}</span> : undefined}
        actions={
          <div className="project-overview-actions">
            {canManage && <Button variant="ghost" onClick={() => setSettingsOpen(true)}>{t("po.settings")}</Button>}
            {canCreate && <Button variant="primary" onClick={() => setCreateOpen(true)}>{t("wie.create")}</Button>}
          </div>
        } />

      {loading && <StateBlock kind="loading" title={t("common.loading")} />}
      {projects.isError && <StateBlock kind="error" title={t("po.loadFailed")} action={() => void projects.refetch()} actionLabel={t("common.reload")} />}
      {projects.isSuccess && !project && <StateBlock kind="restricted" title={t("po.unavailable")} />}

      {project && (
        <>

          <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
            <MetricCard label={t("po.workItems")} value={totalWorkItems} tone="primary" />
            <MetricCard label={t("po.openWorkItems")} value={board.isSuccess ? openWorkItems : "—"} />
            <MetricCard label={t("nav.milestones")} value={milestones.isSuccess ? milestoneCount : "—"} />
            <MetricCard label={t("po.members")} value={members.isSuccess ? members.data?.length ?? 0 : "—"} />
          </div>
          {board.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void board.refetch()} actionLabel={t("common.reload")} />}

          <div className="dashboard-grid">
            <div>
              <Panel>
                <strong style={{ fontSize: "var(--text-sm)" }}>{t("po.info")}</strong>
                <dl className="po-info-grid">
                  <dt>{t("po.status")}</dt><dd>{project.status?.name ?? "—"}</dd>
                  <dt>{t("po.lead")}</dt><dd>{project.lead?.name ?? "—"}</dd>
                  <dt>{t("org.department")}</dt><dd>{project.departmentName ?? t("org.noDepartment")}</dd>
                  <dt>{t("po.key")}</dt><dd className="mono">{project.key}</dd>
                  <dt>{t("po.created")}</dt><dd>{project.createdAt ? new Date(project.createdAt).toLocaleString() : "—"}</dd>
                  <dt>{t("po.updated")}</dt><dd>{project.updatedAt ? relativeTime(project.updatedAt) : "—"}</dd>
                  <dt>{t("po.iterations")}</dt><dd>{(iterations.data ?? []).length}</dd>
                </dl>
                {project.description && <details className="po-description">
                  <summary>{t("po.description")}</summary>
                  <p>{project.description}</p>
                </details>}
              </Panel>

              <Panel style={{ marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <strong style={{ fontSize: "var(--text-sm)" }}>{t("po.activity")}</strong>
                  <span style={{ flex: 1 }} />
                  <ArrowLink to="/projects/$projectId/activity" params={{ projectId }}>{t("po.viewAll")}</ArrowLink>
                </div>
                {activity.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
                {activity.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void activity.refetch()} actionLabel={t("common.reload")} />}
                {activity.isSuccess && (activity.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("po.noActivity")}</p>}
                <ul className="po-activity">
                  {(activity.data ?? []).map((a) => (
                    <li key={a.id}>
                      <span>{a.summary}</span>
                      <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{relativeTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <div>
              <Panel>
                <strong style={{ fontSize: "var(--text-sm)" }}>{t("po.upcoming")}</strong>
                {milestones.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
                {milestones.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void milestones.refetch()} actionLabel={t("common.reload")} />}
                {milestones.isSuccess && upcoming.length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("po.noMilestones")}</p>}
                <ul className="po-activity">
                  {upcoming.map((m) => (
                    <li key={m.id}>
                      <LinkButton size="sm" variant="ghost" to="/projects/$projectId/milestones/$milestoneId" params={{ projectId, milestoneId: m.id }}>{m.name}</LinkButton>
                      <span className={m.dueDate && m.dueDate < today ? "tag tag-danger" : "muted"} style={{ fontSize: "var(--text-xs)" }}>{m.dueDate}</span>
                    </li>
                  ))}
                </ul>
                <ArrowLink to="/projects/$projectId/milestones" params={{ projectId }}>{t("po.viewAll")}</ArrowLink>
              </Panel>

              <Panel style={{ marginTop: 12 }}>
                <div className="po-members-head">
                  <strong style={{ fontSize: "var(--text-sm)" }}>{t("po.membersTitle")}</strong>
                  {canManageMembers && <Button size="sm" variant="ghost" onClick={() => setMembersOpen(true)}>{t("pm.title")}</Button>}
                </div>
                {members.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
                {members.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void members.refetch()} actionLabel={t("common.reload")} />}
                {members.isSuccess && (members.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("pm.empty")}</p>}
                <ul className="project-member-list">
                  {(members.data ?? []).slice(0, 8).map((m) => (
                    <li key={m.id}>
                      <span className="row-avatar" aria-hidden="true">{firstGrapheme(m.name, m.username)}</span>
                      <span className="pm-name"><span title={m.name}>{m.name || m.username}</span><small title={`@${m.username}`}>@{m.username}</small></span>
                      <span className="tag pm-member-role" title={m.role_name ?? undefined}>{m.role_name ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </>
      )}
      <WorkItemEditor open={createOpen} projectId={projectId} onClose={() => setCreateOpen(false)}
        onSaved={(item) => { setCreateOpen(false); setCreatedId(item.id); }} />
      <WorkItemDrawer workItemId={createdId} onClose={() => setCreatedId(null)} />
      <ProjectMembersDrawer project={project && membersOpen ? project : null} onClose={() => setMembersOpen(false)} />
      {project && <ProjectSettingsDrawer open={settingsOpen} project={project} onClose={() => setSettingsOpen(false)} onSaved={() => void projects.refetch()} />}
    </div>
  );
}
