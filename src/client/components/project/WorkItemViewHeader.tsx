/** 工作项视图的统一头部：项目名 + 新建/刷新 + 看板/表格/时间线/日历切换。 */
import { queryKeys } from "../../lib/query-keys.ts";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { PageHead } from "../Page.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../Icon.tsx";
import { Link } from "@tanstack/react-router";

export type WorkItemView = "board" | "table" | "timeline" | "calendar" | "testing";

export function WorkItemViewHeader({
  projectId, active, onCreate, onRefresh, extra,
}: {
  projectId: string;
  active: WorkItemView;
  onCreate?: () => void;
  onRefresh?: () => void;
  extra?: ReactNode;
}) {
  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiGet<{ key: string; name: string }>(`/api/v1/projects/${projectId}`),
    retry: false,
  });
  const view = (id: WorkItemView, to: string, label: string) => active === id
    ? <span key={id} className="ui-segmented-item" aria-current="page">{label}</span>
    : <Link key={id} className="ui-segmented-item" to={to as "/projects/$projectId/board"} params={{ projectId }}>{label}</Link>;
  return (
    <PageHead
      title={<span className="work-view-title"><span>{project.data?.name ?? t("nav.workItems")}</span>
        <span className="mono muted work-view-key">{project.data?.key}</span></span>}
      actions={<>
        {extra}
        {onCreate && <Button size="sm" variant="primary" onClick={onCreate}><Icon name="plus" size={14} />{t("wie.create")}</Button>}
        {onRefresh && <Button size="sm" onClick={onRefresh}><Icon name="refresh" size={14} />{t("board.refresh")}</Button>}
        <div className="page-view-switcher ui-segmented" role="group" aria-label={t("nav.workItems")}>
          {view("board", "/projects/$projectId/board", t("nav.board"))}
          {view("table", "/projects/$projectId/table", t("nav.table"))}
          {view("timeline", "/projects/$projectId/timeline", t("nav.timeline"))}
          {view("calendar", "/projects/$projectId/calendar", t("nav.calendar"))}
          {view("testing", "/projects/$projectId/testing", t("nav.testing"))}
        </div>
      </>}
    />
  );
}
