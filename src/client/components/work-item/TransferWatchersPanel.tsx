/**
 * 转派历史 + 关注者（Round 79 · 对标 BugTransfer/Watcher）
 *
 * 转派：独立语义动作（work_item:assign），强制写历史（from/to/actor/reason）；
 * 关注：subscription 幂等，IN_APP 渠道；列表显示关注者与渠道。
 */
import { queryKeys } from "../../lib/query-keys.ts";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "../../lib/api.ts";
import { useActor, useCan } from "../../lib/actor.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Select } from "../Select.tsx";
import { relativeTime } from "../../lib/time.ts";

interface MemberRow { id: string; name: string; username: string }
interface TransferRow {
  id: string; fromName: string | null; toName: string | null; actorName: string | null;
  reason: string | null; createdAt: string;
}
interface WatcherRow { memberId: string; name: string; username: string; channels: string[] }
interface Props { workItemId: string; version: number; assigneeId: string | null; onTransferred: () => void }

export function TransferWatchersPanel({ workItemId, version, assigneeId, onTransferred }: Props) {
  useLocale();
  const qc = useQueryClient();
  const me = useActor();
  const canAssign = useCan("work_item:assign");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const members = useQuery({
    queryKey: ["members", "options"],
    queryFn: () => apiGet<{ members: MemberRow[] }>("/api/v1/members").then((r) => r.members),
  });
  const transfers = useQuery({
    queryKey: ["work-item-transfers", workItemId],
    queryFn: () => apiGet<{ transfers: TransferRow[] }>(`/api/v1/work-items/${workItemId}/transfers`).then((r) => r.transfers),
  });
  const watchers = useQuery({
    queryKey: ["work-item-watchers", workItemId],
    queryFn: () => apiGet<{ watchers: WatcherRow[] }>(`/api/v1/work-items/${workItemId}/watchers`).then((r) => r.watchers),
  });
  const watching = (watchers.data ?? []).some((w) => w.memberId === me.memberId);
  const assigneeName = (members.data ?? []).find((m) => m.id === assigneeId)?.name ?? t("tw.unassigned");

  const transfer = async () => {
    if (!targetId) return;
    setBusy(true); setError(null);
    try {
      await apiPost(`/api/v1/work-items/${workItemId}/transfer`, { assigneeId: targetId, version, reason: reason.trim() || null });
      setTargetId(""); setReason("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["work-item-transfers", workItemId] }),
        qc.invalidateQueries({ queryKey: queryKeys.workItemDetail(workItemId) }),
      ]);
      onTransferred();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("tw.transferFailed")); }
    finally { setBusy(false); }
  };
  const toggleWatch = async () => {
    setBusy(true); setError(null);
    try {
      if (watching) await apiDelete(`/api/v1/work-items/${workItemId}/follow`);
      else await apiPut(`/api/v1/work-items/${workItemId}/follow`, { channels: ["IN_APP"] });
      await qc.invalidateQueries({ queryKey: ["work-item-watchers", workItemId] });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("tw.watchFailed")); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label={t("tw.title")}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ fontSize: "var(--text-sm)" }}>{t("tw.title")}</strong>
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("tw.current")}：{assigneeName}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant={watching ? "primary" : undefined} disabled={busy} onClick={() => void toggleWatch()}>
          {watching ? t("tw.watching") : t("tw.watch")}
        </Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}

      {canAssign && (
        <div className="tw-transfer-form">
          <Select ariaLabel={t("tw.assignee")} value={targetId} onChange={setTargetId} searchable
            options={[{ value: "", label: t("tw.chooseAssignee") }, ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name || m.username, secondaryLabel: `@${m.username}` }))]} />
          <TextInput aria-label={t("tw.reason")} placeholder={t("tw.reasonHint")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!targetId || busy} onClick={() => void transfer()}>{t("tw.transfer")}</Button>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("tw.history")}</span>
        {(transfers.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("tw.noHistory")}</p>}
        <ul className="md-timeline">
          {(transfers.data ?? []).map((row) => (
            <li key={row.id}>
              <div className="md-timeline-head">
                <strong>{row.fromName ?? t("tw.unassigned")} → {row.toName ?? t("tw.unassigned")}</strong>
                <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{row.actorName ?? ""} · {relativeTime(row.createdAt)}</span>
              </div>
              {row.reason && <p className="md-line"><span className="muted">{t("tw.reasonLabel")}：</span>{row.reason}</p>}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 10 }}>
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("tw.watchers")}（{watchers.data?.length ?? 0}）</span>
        <ul className="po-activity">
          {(watchers.data ?? []).map((w) => (
            <li key={w.memberId}>
              <span className="row-avatar" aria-hidden="true" style={{ width: 22, height: 22, fontSize: 11 }}>{w.name.slice(0, 1)}</span>
              <span style={{ flex: 1 }}>{w.name}<span className="muted"> @{w.username}</span></span>
              <span className="tag">{w.channels.join(" / ")}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
