/**
 * 工作项详情抽屉（Round 25 长任务第 35 项）
 *
 * 此前全站没有"工作项详情"入口：看板只能拖、表格只能看列 ——
 * 描述、关联（work_item_link）、评论（CommentsPanel 早已实现但**没有任何挂载点**）都无处可看。
 *
 * 本组件把三块接起来：基本信息 + 跨域关联（搜索可选目标，不要求用户记 UUID）+ 评论面板。
 */
import { queryKeys } from "../../lib/query-keys.ts";
import { useEffect, useMemo, useState } from "react";
import { TextInput } from "../ui/TextInput.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";
import { CommentsPanel } from "../../routes/CommentsPanel.tsx";
import { DefectProgressPanel } from "./DefectProgressPanel.tsx";
import { WorkItemEditor, type EditableWorkItem } from "./WorkItemEditor.tsx";
import { AttachmentsPanel } from "./AttachmentsPanel.tsx";
import { MarkdownView } from "../ui/MarkdownView.tsx";
import { TransferWatchersPanel } from "./TransferWatchersPanel.tsx";
import { RelationsPanel } from "./RelationsPanel.tsx";
import { TimeLogsPanel } from "./TimeLogsPanel.tsx";
import { CollaboratorsPanel } from "./CollaboratorsPanel.tsx";

interface WorkItemDetail {
  id: string; key: string; title: string; description: string | null;
  type: string; priority: string | null; dueDate: string | null; assigneeId: string | null; reporterId?: string | null; parentId?: string | null; projectId: string; version: number;
}
interface LinkTarget { type: "WORK_ITEM" | "IDEA" | "PAGE" | "MILESTONE" | "ITERATION"; id: string; title: string; key: string | null }
interface LinkRow { id: string; direction: string; target: LinkTarget }

const TYPES: { value: LinkTarget["type"]; label: string }[] = [
  { value: "WORK_ITEM", label: "工作项" },
  { value: "IDEA", label: "想法" },
  { value: "PAGE", label: "文档" },
  { value: "MILESTONE", label: "里程碑" },
  { value: "ITERATION", label: "迭代" },
];

type Option = { id: string; label: string };

/** 目标候选：按类型懒加载，避免一次拉五个列表（且选项来自真实项目数据，不让用户抄 UUID） */
function useTargetOptions(projectId: string | null, type: LinkTarget["type"] | "") {
  return useQuery({
    queryKey: ["link-target-options", projectId, type],
    enabled: !!projectId && !!type,
    retry: false,
    queryFn: async (): Promise<Option[]> => {
      if (!projectId || !type) return [];
      if (type === "WORK_ITEM") {
        const r = await apiGet<{ rows?: { id: string; key: string; title: string }[] }>(`/api/v1/projects/${projectId}/work-items`, { view: "table", pageSize: 100 });
        return (r.rows ?? []).map((x) => ({ id: x.id, label: `${x.key} ${x.title}` }));
      }
      if (type === "IDEA") {
        const r = await apiGet<{ items?: { id: string; title: string }[] }>(`/api/v1/projects/${projectId}/ideas`, { pageSize: 100 });
        return (r.items ?? []).map((x) => ({ id: x.id, label: x.title }));
      }
      if (type === "PAGE") {
        const r = await apiGet<{ pages?: { id: string; title: string }[] }>(`/api/v1/projects/${projectId}/pages`);
        return (r.pages ?? []).map((x) => ({ id: x.id, label: x.title }));
      }
      const path = type === "MILESTONE" ? "milestones" : "iterations";
      const rows = await apiGet<{ id: string; name: string }[]>(`/api/v1/projects/${projectId}/${path}`);
      return (rows ?? []).map((x) => ({ id: x.id, label: x.name }));
    },
  });
}

export function WorkItemDrawer({ workItemId, onClose }: { workItemId: string | null; onClose: () => void }) {
  useLocale();
  const qc = useQueryClient();
  const open = !!workItemId;
  const detail = useQuery({
    queryKey: queryKeys.workItemDetail(workItemId),
    enabled: open,
    retry: false,
    queryFn: () => apiGet<WorkItemDetail>(`/api/v1/work-items/${workItemId}`),
  });
  const links = useQuery({
    queryKey: ["work-item-links", workItemId],
    enabled: open,
    retry: false,
    queryFn: () => apiGet<{ links: LinkRow[] }>(`/api/v1/work-items/${workItemId}/links`).then((r) => r.links ?? []),
  });
  const [type, setType] = useState<"" | LinkTarget["type"]>("");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [approvalComment, setApprovalComment] = useState("");
  useEffect(() => { setEditing(false); setType(""); setTargetId(""); setError(null); setApprovalComment(""); }, [workItemId]);
  const options = useTargetOptions(detail.data?.projectId ?? null, type);
  const parent = useQuery({
    queryKey: queryKeys.workItemParent(detail.data?.parentId),
    enabled: open && !!detail.data?.parentId,
    retry: false,
    queryFn: () => apiGet<{ id: string; key: string; title: string }>(`/api/v1/work-items/${detail.data!.parentId}`),
  });
  const sla = useQuery({
    queryKey: queryKeys.workItemSla(workItemId),
    enabled: open && !!workItemId,
    retry: false,
    queryFn: () => apiGet<{ sla: { state: string; responseDueAt: string; resolveDueAt: string; firstResponseAt: string | null; breachedAt: string | null; pausedAt: string | null; pausedMs: number; policy?: { name: string } | null } | null }>(`/api/v1/work-items/${workItemId}/sla`),
  });
  const approvals = useQuery({
    queryKey: queryKeys.workItemApprovals(workItemId),
    enabled: open && !!workItemId,
    retry: false,
    queryFn: () => apiGet<{ approvals: { id: string; status: string; createdAt: string }[] }>(`/api/v1/work-items/${workItemId}/approvals`).then((r) => r.approvals.filter((a) => a.status === "PENDING")),
  });
  const decideApproval = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => apiPost(`/api/v1/approvals/${id}/${action}`, { comment: approvalComment || undefined }),
    onSuccess: async () => {
      setApprovalComment("");
      await qc.invalidateQueries({ queryKey: queryKeys.workItemApprovals(workItemId) });
      await qc.invalidateQueries({ queryKey: queryKeys.workItemDetail(workItemId) });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "审批操作失败"),
  });
  const children = useQuery({
    queryKey: queryKeys.workItemChildren(workItemId),
    enabled: open && !!workItemId,
    retry: false,
    queryFn: () => apiGet<{ children: { id: string; key: string; title: string; type: string }[] }>(`/api/v1/work-items/${workItemId}/children`).then((r) => r.children ?? []),
  });

  const slaClock = useMutation({
    mutationFn: (action: "pause" | "resume") => apiPost(`/api/v1/work-items/${workItemId}/sla/${action}`, {}),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: queryKeys.workItemSla(workItemId) }); },
  });

  const add = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-items/${workItemId}/links`, { targetType: type, targetId }),
    onSuccess: async () => {
      setTargetId(""); setError(null);
      await qc.invalidateQueries({ queryKey: ["work-item-links", workItemId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiDetail.linkFailed")),
  });
  const remove = useMutation({
    mutationFn: (linkId: string) => apiDelete(`/api/v1/work-item-links/${linkId}`),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["work-item-links", workItemId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiDetail.linkFailed")),
  });
  const targetOptions = useMemo(() => (options.data ?? []).map((o) => ({ value: o.id, label: o.label })), [options.data]);

  const wi = detail.data;
  return (
    <Drawer open={open} title={wi?.key ?? t("wiDetail.title")} onClose={onClose} width="lg" className="work-item-detail">
      {detail.isLoading && <p className="muted">{t("common.loading")}</p>}
      {detail.isError && <p className="muted">{t("wiDetail.loadFailed")}</p>}
      {wi && (
        <div className="wi-drawer">
          <section>
            <div className="wi-detail-heading">
              <h3>{wi.title}</h3>
              <Button size="sm" onClick={() => setEditing(true)}>{t("wie.edit")}</Button>
            </div>
            <dl className="wi-detail-properties">
              <div><dt>{t("wiDetail.type")}</dt><dd>{t(`type.${wi.type}`)}</dd></div>
              <div><dt>{t("wiDetail.priority")}</dt><dd data-priority={wi.priority}>{wi.priority ? t(`prio.${wi.priority}`) : "—"}</dd></div>
              <div><dt>{t("wiDetail.due")}</dt><dd>{wi.dueDate ?? "—"}</dd></div>
              {parent.data && <div className="is-wide"><dt>{t("wie.parent")}</dt><dd>{parent.data.key} {parent.data.title}</dd></div>}
              {sla.data?.sla && <div className="is-wide"><dt>SLA</dt><dd>
                {(() => {
                  const x = sla.data?.sla;
                  if (!x) return "—";
                  const state = x.pausedAt ? "已暂停" : x.state === "BREACHED" ? "已违约" : x.state === "MET" ? "已达成" : x.state === "CANCELLED" ? "已取消" : "进行中";
                  const due = x.state === "ACTIVE" && !x.pausedAt ? new Date(x.resolveDueAt) : null;
                  return <span className="wi-sla-status">
                    <span className={`tag ${x.state === "BREACHED" ? "tag-danger" : x.state === "MET" ? "tag-success" : ""}`}>{x.policy?.name ?? "SLA"} · {state}{due ? ` · 解决剩余 ${Math.max(0, Math.round((due.getTime() - Date.now()) / 60000))} 分钟` : ""}</span>
                    {x.state === "ACTIVE" && <button type="button" className="chip" disabled={slaClock.isPending}
                      onClick={() => slaClock.mutate(x.pausedAt ? "resume" : "pause")}>
                      {x.pausedAt ? "继续计时" : "暂停计时"}
                    </button>}
                  </span>;
                })()}
              </dd></div>}
            </dl>
            <div className={`wi-drawer__desc${wi.description ? "" : " muted"}`}>{wi.description ? <MarkdownView text={wi.description} /> : t("wiDetail.noDescription")}</div>
            {(approvals.data ?? []).length > 0 && (
              <div className="wi-approval">
                <strong style={{ fontSize: "var(--text-sm)" }}>待审批</strong>
                {(approvals.data ?? []).map((a) => (
                  <div key={a.id} className="wi-approval-row">
                    <span className="muted" style={{ fontSize: "var(--text-xs)" }}>流转审批 · {new Date(a.createdAt).toLocaleString()}</span>
                    <TextInput aria-label="审批意见" placeholder="审批意见（可选）" value={approvalComment}
                      onChange={(e) => setApprovalComment(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                    <button type="button" className="chip" disabled={decideApproval.isPending} onClick={() => decideApproval.mutate({ id: a.id, action: "approve" })}>通过</button>
                    <button type="button" className="chip" disabled={decideApproval.isPending} onClick={() => decideApproval.mutate({ id: a.id, action: "reject" })}>驳回</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {wi.type === "DEFECT" && <DefectProgressPanel workItemId={wi.id} reporterId={wi.reporterId} assigneeId={wi.assigneeId} />}
          <section><CommentsPanel targetType="WORK_ITEM" targetId={wi.id} /></section>
          <details className="wi-detail-fold"><summary>{t("flows.attachments")}</summary>
            <AttachmentsPanel targetType="WORK_ITEM" targetId={wi.id} />
          </details>
          <details className="wi-detail-fold"><summary>{t("flows.relatedWork")}</summary><div className="wi-detail-fold-content">
          <section>
            <h3 className="wi-drawer__title">{t("wiDetail.children")}</h3>
            {(children.data ?? []).length === 0 && <p className="muted">{t("wiDetail.noChildren")}</p>}
            {!!(children.data ?? []).length && (
              <ul className="wi-drawer__links">
                {(children.data ?? []).map((c) => <li key={c.id}><span className="tag">{t(`type.${c.type}`)}</span><span>{c.key} {c.title}</span></li>)}
              </ul>
            )}
          </section>

          <RelationsPanel workItemId={wi.id} projectId={wi.projectId} />

          <section>
            <h3 className="wi-drawer__title">{t("wiDetail.links")}</h3>
            {links.isLoading && <p className="muted">{t("common.loading")}</p>}
            {links.data && links.data.length === 0 && <p className="muted">{t("wiDetail.noLinks")}</p>}
            {!!links.data?.length && (
              <ul className="wi-drawer__links">
                {links.data.map((l) => (
                  <li key={l.id}>
                    <span className="tag">{TYPES.find((x) => x.value === l.target.type)?.label ?? l.target.type}</span>
                    <span>{l.target.key ? `${l.target.key} ${l.target.title}` : l.target.title}</span>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id)}>{t("wiDetail.remove")}</Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="wi-drawer__add-link">
              <Select ariaLabel={t("wiDetail.linkType")} value={type} onChange={(v) => { setType(v as LinkTarget["type"]); setTargetId(""); }}
                options={[{ value: "", label: t("wiDetail.linkType") }, ...TYPES.map((x) => ({ value: x.value, label: x.label }))]} />
              <Select ariaLabel={t("wiDetail.linkTarget")} value={targetId} onChange={setTargetId} searchable
                options={[{ value: "", label: t("wiDetail.linkTarget") }, ...targetOptions]} />
              <Button size="sm" variant="primary" disabled={!type || !targetId || add.isPending} onClick={() => add.mutate()}>
                {t("wiDetail.add")}
              </Button>
            </div>
          </section>

          </div></details>
          <details className="wi-detail-fold"><summary>{t("flows.peopleTime")}</summary><div className="wi-detail-fold-content">
            <TransferWatchersPanel workItemId={wi.id} version={wi.version} assigneeId={wi.assigneeId}
              onTransferred={() => { void qc.invalidateQueries({ queryKey: queryKeys.workItemDetail(wi.id) }); }} />
            <CollaboratorsPanel workItemId={wi.id} projectId={wi.projectId} />
            <TimeLogsPanel workItemId={wi.id} />
          </div></details>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}
      {wi && (
        <WorkItemEditor
          open={editing}
          projectId={wi.projectId}
          workItem={{ ...wi, severity: (wi as EditableWorkItem).severity ?? null, startDate: (wi as EditableWorkItem).startDate ?? null }}
          onClose={() => setEditing(false)}
          onSaved={() => { void qc.invalidateQueries({ queryKey: queryKeys.workItemDetail(wi.id) }); }}
        />
      )}
    </Drawer>
  );
}
