/** 工作项协作者：后端 work_item_collaborator 已有；与负责人/关注者区分。 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";

interface Collaborator { memberId: string; createdAt: string }
interface Member { id: string; name: string; username: string }
export function CollaboratorsPanel({ workItemId, projectId }: { workItemId: string; projectId: string }) {
  const qc = useQueryClient();
  const [memberId, setMemberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["work-item-collaborators", workItemId],
    queryFn: () => apiGet<Collaborator[]>(`/api/v1/work-items/${workItemId}/collaborators`),
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => apiGet<{ members: Member[] }>(`/api/v1/projects/${projectId}/members`).then((r) => r.members ?? []),
    staleTime: 60_000,
  });
  const rows = Array.isArray(list.data) ? list.data : [];
  const names = new Map((members.data ?? []).map((m) => [m.id, `${m.name} @${m.username}`]));
  const options = useMemo(() => [{ value: "", label: t("wiCollab.member") },
    ...(members.data ?? []).filter((m) => !rows.some((r) => r.memberId === m.id)).map((m) => ({ value: m.id, label: names.get(m.id) ?? m.username }))], [members.data, rows]);
  const add = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-items/${workItemId}/collaborators`, { memberId }),
    onSuccess: async () => { setMemberId(""); setError(null); await qc.invalidateQueries({ queryKey: ["work-item-collaborators", workItemId] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiCollab.saveFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/work-items/${workItemId}/collaborators/${id}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["work-item-collaborators", workItemId] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiCollab.saveFailed")),
  });
  return (
    <section>
      <h3 className="wi-drawer__title">{t("wiCollab.title")}</h3>
      {rows.length === 0 && !list.isLoading && <p className="muted">{t("wiCollab.empty")}</p>}
      {rows.length > 0 && <ul className="wi-drawer__links">{rows.map((r) => <li key={r.memberId}><span className="tag">{t("wiCollab.role")}</span><span>{names.get(r.memberId) ?? r.memberId}</span><Button size="sm" variant="ghost" onClick={() => remove.mutate(r.memberId)}>{t("common.remove")}</Button></li>)}</ul>}
      <div className="wi-drawer__add-link">
        <Select ariaLabel={t("wiCollab.member")} value={memberId} onChange={setMemberId} searchable options={options} />
        <Button size="sm" variant="primary" disabled={!memberId || add.isPending} onClick={() => add.mutate()}>{t("common.add")}</Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
