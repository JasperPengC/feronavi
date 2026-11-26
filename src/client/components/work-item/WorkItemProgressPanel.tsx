import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { useActor, useCan } from "../../lib/actor.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { relativeTime } from "../../lib/time.ts";
import { useLocalDraft } from "../ui/LocalDraftScope.tsx";
import { confirmDialog } from "../Dialog.tsx";

interface ProgressRow {
  id: string; summary: string; nextSteps: string | null; blockers: string | null;
  createdAt: string; authorId: string | null; authorName: string | null;
}
interface Props { workItemId: string; reporterId?: string | null; assigneeId?: string | null }

/** 人与Agent读取同一份进展，服务端负责最终权限判定。 */
export function WorkItemProgressPanel({ workItemId, reporterId, assigneeId }: Props) {
  useLocale();
  const qc = useQueryClient(), me = useActor();
  const canUpdateAny = useCan("work_item:update_any");
  const canWrite = canUpdateAny || reporterId === me.memberId || assigneeId === me.memberId;
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState(""), [nextSteps, setNextSteps] = useState(""), [blockers, setBlockers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const locked = useRef(false), confirming = useRef(false);
  const dirty = !!summary || !!nextSteps || !!blockers;
  useLocalDraft(dirty, pending !== null);
  const queryKey = ["work-item-progress", workItemId];
  const updates = useQuery({
    queryKey, retry: false,
    queryFn: () => apiGet<{ updates: ProgressRow[] }>(`/api/v1/work-items/${workItemId}/progress-updates`).then(r => r.updates ?? []),
  });
  const rows = updates.data ?? [], visibleRows = expanded ? rows : rows.slice(0, 3);
  const reset = () => { setSummary(""); setNextSteps(""); setBlockers(""); setError(null); setOpen(false); };
  const cancel = async () => {
    if (locked.current || confirming.current) return;
    confirming.current = true;
    try { if (!dirty || await confirmDialog(t("wiProgress.discard"))) reset(); }
    finally { confirming.current = false; }
  };
  const add = async () => {
    if (locked.current || !canWrite || !summary.trim()) return;
    locked.current = true; setPending("save"); setError(null);
    try {
      await apiPost(`/api/v1/work-items/${workItemId}/progress-updates`, {
        summary: summary.trim(), nextSteps: nextSteps.trim() || null, blockers: blockers.trim() || null,
      });
      // 初次读取仍在飞行时也要取消旧快照，避免写入后的回读被旧请求吞掉。
      await qc.cancelQueries({ queryKey });
      reset();
      await qc.invalidateQueries({ queryKey });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("md.saveFailed")); }
    finally { locked.current = false; setPending(null); }
  };
  const remove = async (id: string) => {
    if (locked.current || confirming.current) return;
    confirming.current = true;
    try {
      if (!(await confirmDialog(t("md.deleteUpdateConfirm"), { danger: true }))) return;
      locked.current = true; setPending(id); setError(null);
      await apiDelete(`/api/v1/work-item-progress-updates/${id}`);
      await qc.cancelQueries({ queryKey });
      await qc.invalidateQueries({ queryKey });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("md.saveFailed")); }
    finally { confirming.current = false; locked.current = false; setPending(null); }
  };
  return <section className="wi-drawer__progress" aria-label={t("wiDetail.progress")}>
    <div className="wi-progress-header">
      <h3>{t("wiDetail.progress")}</h3>
      {updates.isSuccess && <span className="muted">{rows.length}</span>}
      {canWrite && <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => open ? void cancel() : setOpen(true)}>{open ? t("md.cancel") : t("md.add")}</Button>}
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {open && canWrite && <form className="md-form" onSubmit={e => { e.preventDefault(); void add(); }}>
      <TextArea label={t("md.summary")} required autoFocus rows={2} maxLength={2000} disabled={pending !== null} value={summary} onChange={e => setSummary(e.target.value)} />
      <div className="wi-progress-fields">
        <TextArea label={t("md.nextSteps")} rows={2} maxLength={5000} disabled={pending !== null} value={nextSteps} onChange={e => setNextSteps(e.target.value)} />
        <TextArea label={t("md.blockers")} rows={2} maxLength={5000} disabled={pending !== null} value={blockers} onChange={e => setBlockers(e.target.value)} />
      </div>
      <div><Button type="submit" size="sm" variant="primary" loading={pending === "save"} disabled={!summary.trim() || pending !== null}>{t("md.submit")}</Button></div>
    </form>}
    {updates.isPending && <p className="muted" role="status">{t("common.loading")}</p>}
    {updates.isError && <div className="wi-progress-error" role="alert">
      <span>{updates.error instanceof ApiError ? updates.error.message : t("wiProgress.loadFailed")}</span>
      <Button size="sm" variant="ghost" loading={updates.isFetching} onClick={() => void updates.refetch()}>{t("common.reload")}</Button>
    </div>}
    {updates.isSuccess && rows.length === 0 && <p className="muted wi-progress-empty">{t("md.noUpdates")}</p>}
    {visibleRows.length > 0 && <ul className="md-timeline">
      {visibleRows.map(u => <li key={u.id}>
        <div className="md-timeline-head">
          <strong>{u.authorName ?? t("md.unknownAuthor")}</strong>
          <time className="muted" dateTime={u.createdAt} title={new Date(u.createdAt).toLocaleString()}>{relativeTime(u.createdAt)}</time>
          {(canWrite || u.authorId === me.memberId) && <Button size="sm" variant="ghost" loading={pending === u.id} disabled={pending !== null} onClick={() => void remove(u.id)}>{t("common.delete")}</Button>}
        </div>
        <p className="md-summary">{u.summary}</p>
        {u.nextSteps && <p className="md-line"><span className="muted">{t("md.nextSteps")}：</span>{u.nextSteps}</p>}
        {u.blockers && <p className="md-line"><span className="tag tag-warning">{t("md.blockers")}</span> {u.blockers}</p>}
      </li>)}
    </ul>}
    {rows.length > 3 && <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t("wiProgress.collapse") : t("wiProgress.showAll", { n: rows.length })}</Button>}
  </section>;
}
