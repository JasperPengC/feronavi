import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { LoadingBlock, StateBlock } from "../ui/StateBlock.tsx";
import { WorkItemTag } from "./WorkItemTag.tsx";
import type { WorkItemChild } from "../../../shared/work-item-children.ts";
import type { WorkItemOption } from "./WorkItemPicker.tsx";

export function WorkItemChildren({ workItemId, type, canCreate, onCreate, onOpen }: {
  workItemId: string; type: string; canCreate: boolean; onCreate: () => void; onOpen: (item: WorkItemOption) => void;
}) {
  const heading = useId();
  const children = useQuery({ queryKey: queryKeys.workItemChildren(workItemId), retry: false,
    queryFn: () => apiGet<{ children: WorkItemChild[] }>(`/api/v1/work-items/${workItemId}/children`).then(r => r.children ?? []) });
  return <section className="wi-children" aria-labelledby={heading}>
    <div className="wi-children-heading">
      <h3 id={heading} className="wi-drawer__title">{t("wiDetail.children")}</h3>
      {children.isSuccess && <span className="muted">{t("wiBreakdown.count", { n: children.data.length })}</span>}
      {canCreate && <Button size="sm" variant="ghost" onClick={onCreate}>{t(type === "REQUIREMENT" ? "wiBreakdown.split" : "wiBreakdown.addChild")}</Button>}
    </div>
    {children.isLoading && <LoadingBlock />}
    {children.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={children.error.message}
      action={() => void children.refetch()} actionLabel={t("common.reload")} />}
    {children.isSuccess && children.data.length === 0 && <p className="muted wi-children-empty">{t(canCreate ? "wiBreakdown.emptyHint" : "wiDetail.noChildren")}</p>}
    {children.isSuccess && children.data.length > 0 && <ul className="wi-children-list">
      {children.data.map(child => <li key={child.id}>
        <button type="button" className="wi-child-open" onClick={() => onOpen(child)} aria-label={`${child.key} ${child.title}`}>
          <span className="wi-child-key">{child.key}</span><span className="wi-child-title">{child.title}</span>
        </button>
        <div className="wi-child-meta">
          <WorkItemTag kind="status" value={child.statusCategory} stateKey={child.statusKey} label={child.statusName} />
          <WorkItemTag kind="priority" value={child.priority} />
          <span className="wi-child-assignee" title={t("common.assignee")}>{child.assigneeName || t("wie.unassigned")}</span>
          {child.dueDate && <time dateTime={child.dueDate} title={t("common.dueDate")}>{child.dueDate}</time>}
        </div>
      </li>)}
    </ul>}
  </section>;
}
