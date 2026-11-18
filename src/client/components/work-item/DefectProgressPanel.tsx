/**
 * 缺陷处理进展（Round 64 · 对标 YouQu 问题追踪）
 *
 * 结构化 summary / nextSteps / blockers；与里程碑进展同一交互语言。
 * 显示条件：工作项 type=DEFECT；可写 = work_item:update_any 或本人是报告人/处理人
 * （最终仍由服务端判定，UI 隐藏只是体验）。
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { useActor, useCan } from "../../lib/actor.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { relativeTime } from "../../lib/time.ts";

interface ProgressRow { id: string; summary: string; nextSteps: string | null; blockers: string | null; createdAt: string; authorName: string | null }
interface Props { workItemId: string; reporterId?: string | null; assigneeId?: string | null }

export function DefectProgressPanel({ workItemId, reporterId, assigneeId }: Props) {
  useLocale();
  const qc = useQueryClient();
  const me = useActor();
  const canUpdateAny = useCan("work_item:update_any");
  const canWrite = canUpdateAny || reporterId === me.memberId || assigneeId === me.memberId;
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [blockers, setBlockers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const updates = useQuery({
    queryKey: ["work-item-progress", workItemId],
    queryFn: () => apiGet<{ updates: ProgressRow[] }>(`/api/v1/work-items/${workItemId}/progress-updates`).then((r) => r.updates),
  });
  const add = async () => {
    setError(null);
    try {
      await apiPost(`/api/v1/work-items/${workItemId}/progress-updates`, {
        summary: summary.trim(), nextSteps: nextSteps.trim() || null, blockers: blockers.trim() || null,
      });
      setSummary(""); setNextSteps(""); setBlockers(""); setOpen(false);
      await qc.invalidateQueries({ queryKey: ["work-item-progress", workItemId] });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("md.saveFailed")); }
  };
  const remove = async (id: string) => {
    try {
      await apiDelete(`/api/v1/work-item-progress-updates/${id}`);
      await qc.invalidateQueries({ queryKey: ["work-item-progress", workItemId] });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("md.saveFailed")); }
  };
  return (
    <section className="wi-drawer__progress" aria-label={t("wiDetail.progress")}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ fontSize: "var(--text-sm)" }}>{t("wiDetail.progress")}</strong>
        <span style={{ flex: 1 }} />
        {canWrite && <Button size="sm" onClick={() => setOpen(!open)}>{open ? t("md.cancel") : t("md.add")}</Button>}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {open && canWrite && (
        <div className="md-form">
          <TextArea label={t("md.summary")} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <TextArea label={t("md.nextSteps")} rows={2} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} />
          <TextArea label={t("md.blockers")} rows={2} value={blockers} onChange={(e) => setBlockers(e.target.value)} />
          <Button variant="primary" disabled={!summary.trim()} onClick={() => void add()}>{t("md.submit")}</Button>
        </div>
      )}
      {(updates.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("md.noUpdates")}</p>}
      <ul className="md-timeline">
        {(updates.data ?? []).map((u) => (
          <li key={u.id}>
            <div className="md-timeline-head">
              <strong>{u.authorName ?? t("md.unknownAuthor")}</strong>
              <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{relativeTime(u.createdAt)}</span>
              {canWrite && <button type="button" className="btn-link" onClick={() => void remove(u.id)}>{t("common.delete")}</button>}
            </div>
            <p className="md-summary">{u.summary}</p>
            {u.nextSteps && <p className="md-line"><span className="muted">{t("md.nextSteps")}：</span>{u.nextSteps}</p>}
            {u.blockers && <p className="md-line"><span className="muted">{t("md.blockers")}：</span>{u.blockers}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
