import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * 想法页（第十一期）：收集 → 投票 → 转工作项
 *
 * 三处刻意的设计：
 *   1 热度用「投票净和」直接展示（score 是缓存，界面不暗示它是权威值）
 *   2 转工作项按钮在已成转后变为「查看工作项」链接 —— 幂等语义要在界面上可见
 *   3 反对票与撤票都给入口（规范允许权重 -1），并把"一人一票、重复投票即改票"写清楚
 */
import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPatch, ApiError } from "../lib/api.ts";
import { PageHead } from "../components/Page.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { t, useLocale } from "../i18n/index.ts";
import { Select } from "../components/Select.tsx";
import { Icon } from "../components/Icon.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { useCan } from "../lib/actor.ts";
import { WorkItemTag } from "../components/work-item/WorkItemTag.tsx";

interface Idea {
  id: string; title: string; description: string | null; status: string;
  score: string; submittedByMemberId: string | null; submitterDisplay: string | null;
  promotedWorkItemId: string | null;
}
interface IdeaList { items: Idea[]; total: number }

const STATUS_LABEL: Record<string, string> = {
  NEW: "ideas.stNew", UNDER_REVIEW: "ideas.stReview", PLANNED: "ideas.stPlanned", REJECTED: "ideas.stRejected",
};
function statusLabel(status: string) {
  const key = STATUS_LABEL[status];
  return key ? t(key) : status;
}

export function IdeasPage() {
  useLocale();   // 订阅语言，切换即时生效
  const { projectId } = useParams({ from: "/_app/projects/$projectId/ideas" });
  const qc = useQueryClient();
  const canSubmit = useCan("idea:submit");
  const canVote = useCan("idea:vote");
  const canManage = useCan("idea:manage");
  const canCreateWorkItem = useCan("work_item:create");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({ title: "", description: "" });
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["ideas", projectId, status],
    queryFn: () => apiGet<IdeaList>(`/api/v1/projects/${projectId}/ideas${status ? `?status=${status}` : ""}`),
  });

  const invalidate = async () => { await qc.invalidateQueries({ queryKey: ["ideas", projectId] }); };
  const onErr = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);

  const submit = useMutation({
    mutationFn: () => apiPost(`/api/v1/projects/${projectId}/ideas`, { title: form.title, description: form.description || null }),
    onSuccess: async () => { setForm({ title: "", description: "" }); await invalidate(); },
    onError: (e) => onErr(e, t("ideas.submitFailed")),
  });
  const vote = useMutation({
    mutationFn: ({ id, weight }: { id: string; weight: number }) => apiPost(`/api/v1/ideas/${id}/vote`, { weight }),
    onSuccess: invalidate,
    onError: (e) => onErr(e, t("ideas.voteFailed")),
  });
  const unvote = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/ideas/${id}/vote`),
    onSuccess: invalidate,
    onError: (e) => onErr(e, t("ideas.unvoteFailed")),
  });
  const promote = useMutation({
    mutationFn: (id: string) => apiPost<{ workItem: { id: string; key: string } | null; alreadyPromoted: boolean }>(`/api/v1/ideas/${id}/promote`, {}),
    // 注意：「已转换过」是**成功路径上的提示**，不是失败 → 用 info 而不是 error（不能一把梭成全 error）
    onSuccess: async (r) => { if (r.alreadyPromoted) toast.info(t("ideas.alreadyConverted2")); if (r.workItem) setOpenItemId(r.workItem.id); await invalidate(); },
    onError: (e) => onErr(e, t("ideas.convertFailed")),
  });
  const setIdeaStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => apiPatch(`/api/v1/ideas/${id}`, { status: s }),
    onSuccess: invalidate,
    onError: (e) => onErr(e, t("ideas.statusFailed")),
  });

  const items = list.data?.items ?? [];

  return (
    <div className="page project-refinement ideas-page data-page">
      <PageHead
        title={t("ideas.title")}
        actions={
          /* 状态筛选是原有控件（被我替换表头时误删过一次，测试立刻抓到）——必须保留 */
          <Select value={status} ariaLabel={t("ideas.statusFilter")} size="sm" onChange={setStatus}
            options={[{ value: "", label: t("ideas.allStatus") },
              ...Object.entries(STATUS_LABEL).map(([v, l]) => ({ value: v, label: t(l) }))]} />
        }
      />
      <p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: 0 }}>{t("ideas.intro")}</p>

      {canSubmit && <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <strong style={{ fontSize: "var(--text-sm)" }}>{t("ideas.compose")}</strong>
        <div className="ideas-compose-row" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <TextInput style={{ flex: 1, minWidth: 220 }} placeholder={t("ideas.titlePlaceholder")} aria-label={t("ideas.titleLabel")}
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <TextInput style={{ flex: 2, minWidth: 260 }} placeholder={t("ideas.detailPlaceholder")} aria-label={t("ideas.detailLabel")}
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Button variant="primary" disabled={!form.title.trim() || submit.isPending} onClick={() => submit.mutate()}>{t("ideas.submitBtn")}</Button>
        </div>
      </div>}

      {list.isLoading && <LoadingBlock />}
      {list.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={list.error instanceof ApiError ? list.error.message : undefined}
        action={() => void list.refetch()} actionLabel={t("common.reload")} />}

      <TableScroll label={t("ideas.title")} resetKey={JSON.stringify([projectId, status])}>
        <table className="card ideas-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>{t("ideas.colHeat")}</th>
            <th>{t("ideas.colIdea")}</th>
            <th>{t("ideas.colStatus")}</th>
            <th className="table-actions">{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="row-hover">
              <td>
                <div className="table-vote">
                  {canVote && <Button size="sm" variant="ghost" aria-label={t("ideas.voteUpLabel", { title: it.title })} onClick={() => vote.mutate({ id: it.id, weight: 1 })}>+1</Button>}
                  <strong>{Number(it.score)}</strong>
                  {canVote && <Button size="sm" variant="ghost" aria-label={t("ideas.voteDownLabel", { title: it.title })} onClick={() => vote.mutate({ id: it.id, weight: -1 })}>−1</Button>}
                </div>
              </td>
              <td>
                <div className="row-title">
                  <span className="row-avatar" aria-hidden="true"><Icon name="spark" size={13} /></span>
                  <span className="row-name">{it.title}</span>
                </div>
                <div className="row-sub">
                  {it.submittedByMemberId ? t("ideas.internal2") : `外部提交：${it.submitterDisplay ?? t("ideas.anon2")}`}
                  {(() => {
                    const clean = (it.description ?? "")
                      .replace(/[（(]?seed:demo[）)]?/gi, "")
                      .replace(/^演示数据[：:]?\s*/, "")
                      .trim();
                    return clean ? ` · ${clean.slice(0, 40)}` : "";
                  })()}
                </div>
              </td>
              <td><WorkItemTag kind="status" stateKey={it.status}
                value={it.status === "PLANNED" ? "IN_PROGRESS" : "TODO"} label={statusLabel(it.status)} /></td>
              <td className="ideas-actions table-actions"><div className="table-actions-group">
                {canVote && <Button size="sm" variant="ghost" aria-label={t("ideas.unvoteLabel", { title: it.title })} onClick={() => unvote.mutate(it.id)}>{t("ideas.unvote")}</Button>}
                {it.promotedWorkItemId
                  ? <Button size="sm" onClick={() => setOpenItemId(it.promotedWorkItemId)}>{t("ideas.viewWorkItem")}</Button>
                  : canManage && canCreateWorkItem && <Button size="sm" variant="primary" disabled={promote.isPending} onClick={() => promote.mutate(it.id)}>{t("ideas.convert")}</Button>}
                {canManage && it.status !== "REJECTED" && (
                  <Button size="sm" onClick={() => setIdeaStatus.mutate({ id: it.id, s: "REJECTED" })}>{t("ideas.reject")}</Button>
                )}
              </div></td>
            </tr>
          ))}
          {items.length === 0 && list.isSuccess && (
            <tr><td colSpan={4} style={{ padding: 32, textAlign: "center" }} className="muted">
              {status
                ? <StateBlock kind="empty" title={t("common.noMatches")} action={() => setStatus("")} actionLabel={t("board.clearFilters")} />
                : <StateBlock kind="empty" title={t("ideas.emptyTitle")} description={t("ideas.emptyHint")} />}
            </td></tr>
          )}
        </tbody>
      </table>
        </TableScroll>
      <WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} />
    </div>
  );
}
