import { useRef, useState } from "react";
import { useLocalDraft } from "../ui/LocalDraftScope.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, ApiError } from "../../lib/api.ts";
import { invalidateWorkItemQueries } from "../../lib/query-keys.ts";
import { useCan } from "../../lib/actor.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";

export interface WorkItemTransition { toStateKey: string; toName: string; label: string | null; requiredFields: string[] }

/** 按服务端有效动作流转；成功、审批和冲突都回读业务对象。 */
export function WorkItemActions({ item }: { item: { id: string; version: number; allowedTransitions?: WorkItemTransition[] } }) {
  const qc = useQueryClient();
  const canTransition = useCan("work_item:transition");
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ toStateKey: string; fields: string[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const move = useMutation({
    mutationFn: ({ toStateKey, fields }: { toStateKey: string; fields: Record<string, string> }) =>
      apiPost<{ status?: string }>(`/api/v1/work-items/${item.id}/transition`, { toStateKey, version: item.version, fields }),
    onSuccess: async (result) => {
      setPending(null); setError(null); setValues({});
      setNotice(result.status === "PENDING_APPROVAL" ? t("wiDetail.pendingApproval") : t("board.statusUpdated"));
      await invalidateWorkItemQueries(qc, item.id);
    },
    onError: async (e, input) => {
      const approvalId = e instanceof ApiError ? (e.details as { approvalId?: string } | null)?.approvalId : null;
      if (approvalId && e instanceof ApiError) { setPending(null); setNotice(e.message); setError(null); }
      else {
        setError(e instanceof Error ? e.message : t("board.actionFailed"));
        if (e instanceof ApiError && e.requiredFields.length) setPending({ toStateKey: input.toStateKey, fields: e.requiredFields });
        if (e instanceof ApiError && e.code === "VERSION_CONFLICT") { setPending(null); setValues({}); }
      }
      await invalidateWorkItemQueries(qc, item.id);
    },
    onSettled: () => { lock.current = false; },
  });
  function submit(toStateKey: string, fields: Record<string, string>) {
    if (lock.current || !canTransition) return;
    lock.current = true; setError(null); setNotice(null);
    move.mutate({ toStateKey, fields });
  }
  useLocalDraft(Object.values(values).some(Boolean), move.isPending);
  return <div className="wi-detail-actions">
    {canTransition && !!item.allowedTransitions?.length && <div className="wi-detail-actions__buttons" aria-label={t("wiDetail.actions")}>
      {item.allowedTransitions.map(action => <Button key={action.toStateKey} size="sm" disabled={move.isPending}
        onClick={() => { setPending(null); setValues({}); submit(action.toStateKey, {}); }}>{action.label || action.toName}</Button>)}
    </div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
    {pending && <form onSubmit={event => {
      event.preventDefault();
      if (pending.fields.every(field => values[field]?.trim())) submit(pending.toStateKey, Object.fromEntries(pending.fields.map(field => [field, (values[field] ?? "").trim()])));
    }}>
      {pending.fields.map(field => <label className="wi-detail-action-field" key={field}>{field}
        <TextInput aria-label={field} value={values[field] ?? ""} disabled={move.isPending} required
          onChange={event => setValues(previous => ({ ...previous, [field]: event.target.value }))} />
      </label>)}
      <Button type="submit" size="sm" variant="primary" disabled={move.isPending || pending.fields.some(field => !values[field]?.trim())}>{t("wiDetail.continueTransition")}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={move.isPending} onClick={() => { setPending(null); setValues({}); setError(null); }}>{t("common.cancel")}</Button>
    </form>}
  </div>;
}
