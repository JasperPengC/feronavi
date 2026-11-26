/** 工作项工时登记（后端 time-logs 已有；此处接工作项详情与汇总）。 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { useLocalDraft } from "../ui/LocalDraftScope.tsx";

interface TimeLog { id: string; minutes: number; loggedDate: string; note: string | null; memberId: string }
export function TimeLogsPanel({ workItemId }: { workItemId: string }) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logs = useQuery({
    queryKey: ["work-item-time-logs", workItemId],
    queryFn: () => apiGet<TimeLog[]>(`/api/v1/work-items/${workItemId}/time-logs`),
  });
  const add = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-items/${workItemId}/time-logs`, { minutes: Number(minutes), loggedDate: date, note: note.trim() || null }),
    onSuccess: async () => { setMinutes(""); setNote(""); setError(null); await qc.invalidateQueries({ queryKey: ["work-item-time-logs", workItemId] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiTime.saveFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/time-logs/${id}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["work-item-time-logs", workItemId] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiTime.saveFailed")),
  });
  useLocalDraft(!!minutes || !!note, add.isPending || remove.isPending);
  const rows = Array.isArray(logs.data) ? logs.data : [];
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  const valid = Number.isInteger(Number(minutes)) && Number(minutes) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <section>
      <h3 className="wi-drawer__title">{t("wiTime.title")} <span className="muted" style={{ fontWeight: 400 }}>· {t("wiTime.total", { n: String(total) })}</span></h3>
      {rows.length === 0 && !logs.isLoading && <p className="muted">{t("wiTime.empty")}</p>}
      {rows.length > 0 && (
        <ul className="wi-drawer__links">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="tag">{r.loggedDate}</span>
              <span>{t("wiTime.minutes", { n: String(r.minutes) })}{r.note ? ` · ${r.note}` : ""}</span>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>{t("common.delete")}</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="wi-drawer__add-link" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <TextInput aria-label={t("wiTime.minutesLabel")} type="number" min={1} placeholder={t("wiTime.minutesLabel")} value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ width: 120 }} />
        <DatePicker ariaLabel={t("wiTime.date")} value={date} onChange={setDate} placeholder={t("common.pickDate")} />
        <TextInput aria-label={t("wiTime.note")} placeholder={t("wiTime.note")} value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <Button size="sm" variant="primary" disabled={!valid || add.isPending} onClick={() => add.mutate()}>{t("common.add")}</Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
