import { useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { planning } from "../../lib/planning-api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { t } from "../../i18n/index.ts";
import { Select } from "../Select.tsx";
import { Button } from "../ui/Button.tsx";

export interface WorkItemPlanValues { milestoneId: string; iterationId: string; releaseId: string; moduleId: string }
const plans = [
  { kind: "milestone", field: "milestoneId", label: "ms.kindMilestone" },
  { kind: "iteration", field: "iterationId", label: "ms.kindIteration" },
  { kind: "release", field: "releaseId", label: "ms.kindRelease" },
  { kind: "module", field: "moduleId", label: "ms.kindModule" },
] as const;

export function WorkItemPlanningFields({ projectId, values, existing, onChange, onValidityChange }: {
  projectId: string; values: WorkItemPlanValues; existing?: Partial<WorkItemPlanValues>;
  onChange: (field: keyof WorkItemPlanValues, value: string) => void; onValidityChange: (valid: boolean) => void;
}) {
  const queries = useQueries({ queries: plans.map(plan => ({ queryKey: queryKeys.planEntities(plan.kind, projectId, true),
    queryFn: () => planning.list(plan.kind, projectId, true), retry: false })) });
  const invalid = plans.some((plan, index) => {
    const value = values[plan.field];
    if (!value || value === existing?.[plan.field]) return false;
    const query = queries[index]!;
    const row = Array.isArray(query.data) ? query.data.find(row => row.id === value) : undefined;
    return !row || !!row.archivedAt || !!row.completedAt;
  });
  useEffect(() => onValidityChange(!invalid), [invalid, onValidityChange]);
  return <fieldset className="task-form-group"><legend>{t("wiBreakdown.planning")}</legend><div className="wie-form-grid">
    {plans.map((plan, index) => {
      const query = queries[index]!, value = values[plan.field];
      const rows = Array.isArray(query.data) ? query.data : [];
      const selected = rows.find(row => row.id === value);
      const unavailable = value && value !== existing?.[plan.field] && query.isSuccess && (!selected || selected.archivedAt || selected.completedAt);
      const label = (row: typeof rows[number]) => row.name + (row.archivedAt ? ` · ${t("pe.lifecycleArchived")}` : row.completedAt ? ` · ${t("pe.lifecycleCompleted")}` : "");
      return <Select key={plan.field} label={t(plan.label)} ariaLabel={t(plan.label)} value={value} searchable
        onChange={next => onChange(plan.field, next)} disabled={query.isLoading || query.isError}
        selectedOption={value ? { value, label: selected ? label(selected) : t(query.isError ? "common.loadFailedShort" : "common.loading") } : undefined}
        error={query.isError ? <>{t("common.loadFailedShort")} <Button size="sm" onClick={() => void query.refetch()}>{t("common.reload")}</Button></> : unavailable ? t("wiBreakdown.unavailablePlan") : undefined}
        options={[{ value: "", label: t("wie.none") }, ...rows.filter(row => (!row.archivedAt && !row.completedAt) || (row.id === value && row.id === existing?.[plan.field])).map(row => ({ value: row.id, label: label(row) }))]} />;
    })}
  </div></fieldset>;
}
