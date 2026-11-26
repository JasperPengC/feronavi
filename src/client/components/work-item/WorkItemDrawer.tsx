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
import { WorkItemProgressPanel } from "./WorkItemProgressPanel.tsx";
import { WorkItemEditor, type EditableWorkItem } from "./WorkItemEditor.tsx";
import { AttachmentsPanel } from "./AttachmentsPanel.tsx";
import { MarkdownView } from "../ui/MarkdownView.tsx";
import { TransferWatchersPanel } from "./TransferWatchersPanel.tsx";
import { RelationsPanel } from "./RelationsPanel.tsx";
import { TimeLogsPanel } from "./TimeLogsPanel.tsx";
import { CollaboratorsPanel } from "./CollaboratorsPanel.tsx";
import { WorkItemActions, type WorkItemTransition } from "./WorkItemActions.tsx";
import { WorkItemContext } from "./WorkItemContext.tsx";
import { RequirementHistory } from "./RequirementHistory.tsx";
import { RequirementChanges } from "./RequirementChanges.tsx";
import { DeliveryPanel } from '../delivery/DeliveryPanel.tsx';
import { WorkItemTag } from "./WorkItemTag.tsx";
import { useCan } from "../../lib/actor.ts";
import { WorkItemChildren } from "./WorkItemChildren.tsx";
import type { WorkItemOption } from "./WorkItemPicker.tsx";
import { LocalDraftContext, useLocalDraftScope } from "../ui/LocalDraftScope.tsx";
import { DraftNavigationGuard } from "../ui/DraftNavigationGuard.tsx";

interface WorkItemDetail {
  id: string; key: string; title: string; description: string | null;
  type: string; priority: string | null; dueDate: string | null; assigneeId: string | null; reporterId?: string | null; parentId?: string | null; projectId: string; version: number;
  statusName?: string | null; statusCategory?: string | null; statusKey?: string | null; milestoneId?: string | null; iterationId?: string | null; releaseId?: string | null;
  allowedTransitions?: WorkItemTransition[];
  productId?: string | null;
  moduleId?: string | null; startDate?: string | null;
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
  return <WorkItemNavigator workItemId={workItemId} onClose={onClose} />;
}

function WorkItemNavigator({ workItemId, onClose }: { workItemId: string | null; onClose: () => void }) {
  const [trail, setTrail] = useState<WorkItemOption[]>(workItemId ? [{ id: workItemId, key: "", title: "" }] : []);
  const [rootId, setRootId] = useState(workItemId);
  // 切换根工作项重置历史；关闭时保留最后内容，让同一个Drawer退场并恢复原入口焦点。
  if (rootId !== workItemId) {
    setRootId(workItemId);
    if (workItemId) setTrail([{ id: workItemId, key: "", title: "" }]);
  }
  const current = trail.at(-1);
  return <WorkItemDetail open={!!workItemId} workItemId={current?.id ?? null} onClose={onClose}
    previous={trail.at(-2)} onBack={() => setTrail(items => items.slice(0, -1))}
    onOpen={(from, next) => setTrail(items => {
      const previous = items.findIndex(item => item.id === next.id);
      return previous >= 0 ? items.slice(0, previous + 1) : [...items.slice(0, -1), from, next];
    })} />;
}

function WorkItemDetail({ workItemId, open, onClose, previous, onBack, onOpen }: {
  workItemId: string | null; open: boolean; onClose: () => void; previous?: WorkItemOption; onBack: () => void;
  onOpen: (from: WorkItemOption, next: WorkItemOption) => void;
}) {
  useLocale();
  const drafts = useLocalDraftScope();
  const canCreate = useCan("work_item:create");
  const qc = useQueryClient();
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
  const [creatingChild, setCreatingChild] = useState(false);
  const [approvalComment, setApprovalComment] = useState("");
  useEffect(() => { setEditing(false); setCreatingChild(false); setType(""); setTargetId(""); setError(null); setApprovalComment(""); }, [workItemId]);
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
  useEffect(() => { drafts.register("approval", { dirty: !!approvalComment, saving: decideApproval.isPending }); }, [drafts.register, approvalComment, decideApproval.isPending]);

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
  const openItem = (item: WorkItemOption) => { if (wi) void drafts.leave(() => onOpen(wi, item)); };
  return (
    <LocalDraftContext.Provider value={drafts.register}>
    <Drawer open={open} title={wi?.key ?? t("wiDetail.title")} onClose={() => void drafts.leave(onClose)} width="lg" className="work-item-detail">
      <DraftNavigationGuard dirty={drafts.dirty} saving={drafts.saving} message={t("flows.discardDraft")} />
      {previous && <Button size="sm" variant="ghost" className="wi-detail-back" onClick={() => void drafts.leave(onBack)}>{t("wiBreakdown.back", { key: previous.key })}</Button>}
      {detail.isLoading && <p className="muted">{t("common.loading")}</p>}
      {detail.isError && <p className="muted">{t("wiDetail.loadFailed")}</p>}
      {wi && (
        <div key={`body-${wi.id}`} className="wi-drawer">
          <section>
            <div className="wi-detail-heading">
              <h3>{wi.title}</h3>
              <Button size="sm" onClick={() => setEditing(true)}>{t("wie.edit")}</Button>
            </div>
            <dl className="wi-detail-properties">
              <WorkItemContext item={wi} />
              <div><dt>{t("wiDetail.type")}</dt><dd>{t(`type.${wi.type}`)}</dd></div>
              <div><dt>{t("wiDetail.priority")}</dt><dd><WorkItemTag kind="priority" value={wi.priority} /></dd></div>
              <div><dt>{t("wiDetail.due")}</dt><dd>{wi.dueDate ?? "—"}</dd></div>
              {parent.data && <div className="is-wide"><dt>{t("wie.parent")}</dt><dd><button type="button" className="wi-related-open" onClick={() => openItem(parent.data!)}>{parent.data.key} {parent.data.title}</button></dd></div>}
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
            <WorkItemActions key={wi.id} item={wi} />
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

          <WorkItemChildren workItemId={wi.id} type={wi.type} canCreate={canCreate} onCreate={() => setCreatingChild(true)} onOpen={openItem} />
          {wi.type === "REQUIREMENT" && <RequirementHistory key={wi.id} workItemId={wi.id} workItemVersion={wi.version} />}
          {wi.type === "REQUIREMENT" && <RequirementChanges key={`changes-${wi.id}`} workItemId={wi.id} workItemVersion={wi.version} />}
          <WorkItemProgressPanel key={wi.id} workItemId={wi.id} reporterId={wi.reporterId} assigneeId={wi.assigneeId} />
          <DeliveryPanel key={`delivery-${wi.id}`} projectId={wi.projectId} workItemId={wi.id} />
          <section><CommentsPanel targetType="WORK_ITEM" targetId={wi.id} /></section>
          <details className="wi-detail-fold"><summary>{t("flows.attachments")}</summary>
            <AttachmentsPanel targetType="WORK_ITEM" targetId={wi.id} />
          </details>
          <details className="wi-detail-fold"><summary>{t("flows.relatedWork")}</summary><div className="wi-detail-fold-content">
          <RelationsPanel workItemId={wi.id} projectId={wi.projectId} onOpen={openItem} />

          <section>
            <h3 className="wi-drawer__title">{t("wiDetail.links")}</h3>
            {links.isLoading && <p className="muted">{t("common.loading")}</p>}
            {links.data && links.data.length === 0 && <p className="muted">{t("wiDetail.noLinks")}</p>}
            {!!links.data?.length && (
              <ul className="wi-drawer__links">
                {links.data.map((l) => (
                  <li key={l.id}>
                    <span className="tag">{TYPES.find((x) => x.value === l.target.type)?.label ?? l.target.type}</span>
                    {l.target.type === "WORK_ITEM" ? <button type="button" className="wi-related-open" onClick={() => openItem({ ...l.target, key: l.target.key ?? "" })}>{l.target.key} {l.target.title}</button> : <span>{l.target.key ? `${l.target.key} ${l.target.title}` : l.target.title}</span>}
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
          key={`editor-${wi.id}`}
          open={editing}
          projectId={wi.projectId}
          workItem={{ ...wi, severity: (wi as EditableWorkItem).severity ?? null, startDate: (wi as EditableWorkItem).startDate ?? null }}
          onClose={() => setEditing(false)}
          onSaved={() => { void qc.invalidateQueries({ queryKey: queryKeys.workItemDetail(wi.id) }); }}
        />
      )}
      {wi && creatingChild && <WorkItemEditor open projectId={wi.projectId} initialParent={wi}
        onClose={() => setCreatingChild(false)} />}
    </Drawer>
    </LocalDraftContext.Provider>
  );
}
