/** 工作项阻塞/关联关系：后端已有 BLOCKS/BLOCKED_BY/RELATES_TO/DUPLICATES，此处接 UI。 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";

interface RelationItem { id: string; key: string; title: string; type?: string }
interface RelationView { blocks: RelationItem[]; blockedBy: RelationItem[]; others: RelationItem[] }
const TYPES = ["BLOCKS", "BLOCKED_BY", "RELATES_TO", "DUPLICATES"] as const;

export function RelationsPanel({ workItemId, projectId }: { workItemId: string; projectId: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState<string>("BLOCKS");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rel = useQuery({
    queryKey: ["work-item-relations", workItemId],
    queryFn: () => apiGet<RelationView>(`/api/v1/work-items/${workItemId}/relations`),
  });
  const targets = useQuery({
    queryKey: ["work-item-relation-targets", workItemId, projectId],
    enabled: !!projectId,
    queryFn: () => apiGet<{ rows?: { id: string; key: string; title: string }[] }>(`/api/v1/projects/${projectId}/work-items`, { view: "table", pageSize: 100 }),
  });
  const add = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-items/${workItemId}/relations`, { targetId, type }),
    onSuccess: async () => { setTargetId(""); setError(null); await qc.invalidateQueries({ queryKey: ["work-item-relations", workItemId] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiRel.saveFailed")),
  });
  const remove = useMutation({
    mutationFn: (relId: string) => apiDelete(`/api/v1/work-items/${workItemId}/relations/${relId}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["work-item-relations", workItemId] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("wiRel.saveFailed")),
  });
  const options = useMemo(() => [{ value: "", label: t("wiRel.target") },
    ...(targets.data?.rows ?? []).filter((r) => r.id !== workItemId).map((r) => ({ value: r.id, label: `${r.key} ${r.title}` }))], [targets.data, workItemId]);
  const groups: { key: keyof RelationView; label: string }[] = [
    { key: "blocks", label: t("wiRel.blocks") },
    { key: "blockedBy", label: t("wiRel.blockedBy") },
    { key: "others", label: t("wiRel.others") },
  ];
  return (
    <section>
      <h3 className="wi-drawer__title">{t("wiRel.title")}</h3>
      {rel.isLoading && <p className="muted">{t("common.loading")}</p>}
      {rel.isError && <p className="muted">{t("wiRel.loadFailed")}</p>}
      {groups.map((g) => {
        const rows = rel.data?.[g.key] ?? [];
        return (
          <div key={g.key} style={{ marginBottom: 8 }}>
            <p className="muted" style={{ margin: "0 0 4px", fontSize: "var(--text-xs)" }}>{g.label}</p>
            {rows.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>—</p> : (
              <ul className="wi-drawer__links">
                {rows.map((r) => (
                  <li key={r.id}>
                    <span className="tag">{r.type ? typeLabel(r.type) : g.label}</span>
                    <span>{r.key} {r.title}</span>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>{t("common.delete")}</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <div className="wi-drawer__add-link">
        <Select ariaLabel={t("wiRel.type")} value={type} onChange={setType}
          options={TYPES.map((x) => ({ value: x, label: typeLabel(x) }))} />
        <Select ariaLabel={t("wiRel.target")} value={targetId} onChange={setTargetId} searchable options={options} />
        <Button size="sm" variant="primary" disabled={!targetId || add.isPending} onClick={() => add.mutate()}>{t("common.add")}</Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}

function typeLabel(type: string): string {
  return t(`wiRel.type.${type}`);
}
