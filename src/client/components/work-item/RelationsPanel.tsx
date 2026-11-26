/** 工作项阻塞/关联关系：后端已有 BLOCKS/BLOCKED_BY/RELATES_TO/DUPLICATES，此处接 UI。 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";
import { WorkItemPicker, type WorkItemOption } from "./WorkItemPicker.tsx";

interface RelationItem { id: string; workItemId?: string; key: string; title: string; type?: string }
interface RelationView { blocks: RelationItem[]; blockedBy: RelationItem[]; others: RelationItem[] }
const TYPES = ["BLOCKS", "BLOCKED_BY", "RELATES_TO", "DUPLICATES"] as const;

export function RelationsPanel({ workItemId, projectId, onOpen }: { workItemId: string; projectId: string; onOpen?: (item: WorkItemOption) => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<string>("BLOCKS");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rel = useQuery({
    queryKey: ["work-item-relations", workItemId],
    queryFn: () => apiGet<RelationView>(`/api/v1/work-items/${workItemId}/relations`),
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
                    {onOpen && r.workItemId ? <button type="button" className="wi-related-open" onClick={() => onOpen({ id: r.workItemId!, key: r.key, title: r.title })}>{r.key} {r.title}</button> : <span>{r.key} {r.title}</span>}
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
        <WorkItemPicker projectId={projectId} value={targetId} onChange={setTargetId} label={t("wiRel.target")} emptyLabel={t("wiRel.target")} excludeId={workItemId} />
        <Button size="sm" variant="primary" disabled={!targetId || add.isPending} onClick={() => add.mutate()}>{t("common.add")}</Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}

function typeLabel(type: string): string {
  return t(`wiRel.type.${type}`);
}
