import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Select } from "../Select.tsx";
import { Button } from "../ui/Button.tsx";

export interface WorkItemOption { id: string; key: string; title: string }

/** 搜索项目内的实际工作项；当前选中项单独回读，不受结果分页影响。 */
export function WorkItemPicker({ projectId, value, onChange, label, emptyLabel, excludeId, selected, required, disabled }: {
  projectId: string; value: string; onChange: (id: string) => void; label: string; emptyLabel: string;
  excludeId?: string; selected?: WorkItemOption; required?: boolean; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  const choices = useQuery({
    queryKey: ["work-item-picker", projectId, search], retry: false,
    queryFn: () => apiGet<{ items: WorkItemOption[]; total: number }>(`/api/v1/projects/${projectId}/work-items`, { view: "list", pageSize: 50, q: search || undefined }),
  });
  const current = useQuery({
    queryKey: ["work-item-parent", value], enabled: !!value && selected?.id !== value, retry: false,
    queryFn: () => apiGet<WorkItemOption>(`/api/v1/work-items/${value}`),
  });
  const item = selected?.id === value ? selected : current.data;
  const searching = search !== query.trim() || choices.isFetching;
  const option = (row: WorkItemOption) => ({ value: row.id, label: `${row.key} ${row.title}` });
  return <Select label={label} ariaLabel={label} value={value} onChange={onChange} searchable required={required} disabled={disabled}
    onSearchChange={setQuery} selectedOption={item ? option(item) : value ? { value, label: t(current.isError ? "common.loadFailedShort" : "common.loading") } : undefined}
    options={searching || choices.isError ? [] : [...(!query.trim() ? [{ value: "", label: emptyLabel }] : []), ...(choices.data?.items ?? []).filter(row => row.id !== excludeId).map(option)]}
    searchStatus={searching ? t("common.loading") : choices.isError ? <>{t("common.loadFailedShort")} <Button size="sm" variant="ghost" onClick={() => void choices.refetch()}>{t("common.reload")}</Button></> : undefined}
    description={(choices.data?.total ?? 0) > 50 ? t("wiBreakdown.searchMore", { n: choices.data!.total }) : undefined}
    error={current.isError && value && selected?.id !== value ? <>{t("common.loadFailedShort")} <Button size="sm" variant="ghost" onClick={() => void current.refetch()}>{t("common.reload")}</Button></> : undefined} />;
}
