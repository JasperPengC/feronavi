import { useQueries } from "@tanstack/react-query";
import { useId, useState } from "react";
import { planning } from "../../lib/planning-api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { tablePlans, type TablePlanField, type TableSearch } from "../../lib/work-item-table-search.ts";
import { t } from "../../i18n/index.ts";
import { Select } from "../Select.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../Icon.tsx";

export function useTablePlans(projectId: string) {
  return useQueries({ queries: tablePlans.map(plan => ({ queryKey: queryKeys.planEntities(plan.kind, projectId, true),
    queryFn: () => planning.list(plan.kind, projectId, true), retry: false, staleTime: 30_000 })) });
}
export function WorkItemPlanFilters({ search, queries, onChange }: {
  search: TableSearch; queries: ReturnType<typeof useTablePlans>; onChange: (field: TablePlanField, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const names = tablePlans.flatMap((plan, index) => {
    const value = search[plan.field];
    if (!value) return [];
    const query = queries[index]!, rows = Array.isArray(query.data) ? query.data : [];
    return [rows.find(row => row.id === value)?.name ?? t(query.isLoading ? "common.loading" : "tableScope.unavailable")];
  });
  return <div className="table-plan-filters">
    <Button size="sm" variant="ghost" className="table-plan-toggle" aria-label={t("tableScope.plans")} aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)} title={names.join("、")}>
      <span>{t("tableScope.plans")}{names.length ? ` (${names.length})` : ""}</span>
      <span className="table-plan-summary">{names.join("、") || t("tableScope.allPlans")}</span><Icon name="chevron-down" size={14} />
    </Button>
    <div className="table-plan-fields" id={id} data-expanded={expanded}>
    {tablePlans.map((plan, index) => {
      const query = queries[index]!, value = search[plan.field] ?? "";
      const rows = Array.isArray(query.data) ? query.data : [];
      const selected = rows.find(row => row.id === value);
      const label = (row: typeof rows[number]) => row.name + (row.archivedAt ? ` · ${t("pe.lifecycleArchived")}` : row.completedAt ? ` · ${t("pe.lifecycleCompleted")}` : "");
      return <Select key={plan.field} size="sm" ariaLabel={t(plan.label)} value={value} searchable
        onChange={next => onChange(plan.field, next)} disabled={query.isLoading || query.isError}
        selectedOption={value ? { value, label: selected ? label(selected) : t(query.isError ? "common.loadFailedShort" : query.isLoading ? "common.loading" : "tableScope.unavailable") } : undefined}
        error={query.isError ? <>{t("common.loadFailedShort")} <Button size="sm" onClick={() => void query.refetch()}>{t("common.reload")}</Button></> : undefined}
        options={[{ value: "", label: t(plan.label) }, ...rows.map(row => ({ value: row.id, label: label(row) }))]} />;
    })}
    </div>
  </div>;
}
