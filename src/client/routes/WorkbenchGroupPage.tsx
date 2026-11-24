import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { WORKBENCH_GROUP_LABELS, type WorkbenchGroupKey } from "../../shared/workbench.ts";
import { t, useLocale } from "../i18n/index.ts";
import { ApiError } from "../lib/api.ts";
import { workbenchGroup } from "../lib/planning-api.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { PageHead } from "../components/Page.tsx";
import { ArrowLink } from "../components/ui/ArrowLink.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { PagePagination } from "../components/ui/PagePagination.tsx";
import { TableScroll } from "../components/ui/TableScroll.tsx";
import { WorkbenchItemRow } from "../components/work-item/WorkbenchItemRow.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";

export function WorkbenchGroupPage() {
  useLocale();
  const group = useParams({ strict: false }).group as WorkbenchGroupKey;
  const { page = 1 } = useSearch({ strict: false }) as { page?: number };
  const navigate = useNavigate();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const title = t(WORKBENCH_GROUP_LABELS[group]);
  const list = useQuery({ queryKey: queryKeys.workbench("group", group, page), queryFn: () => workbenchGroup(group, page) });
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / 50));
  return (
    <div className="page data-page workbench-group-page">
      <PageHead title={title} sub={list.data ? t("common.totalItems", { n: list.data.count }) : undefined}
        actions={<ArrowLink to="/workbench">{t("workbench.back")}</ArrowLink>} />
      {list.isPending ? <LoadingBlock /> : list.isError ? (
        <StateBlock kind="error" title={t("common.loadFailedShort")} description={list.error instanceof ApiError ? list.error.message : undefined}
          action={() => void list.refetch()} actionLabel={t("common.reload")} />
      ) : list.data.items.length === 0 ? (
        <StateBlock kind="empty" title={t("workbench.none")} action={() => void navigate({ to: "/workbench" })} actionLabel={t("workbench.back")} />
      ) : (
        <TableScroll className="panel workbench-group-list" label={title} resetKey={`${group}:${page}`}>
          {list.data.items.map((item) => <WorkbenchItemRow key={item.id} item={item} onOpen={setOpenItemId} />)}
        </TableScroll>
      )}
      {list.isSuccess && <PagePagination page={page} pages={pages} total={list.data.count} showSingle
        onPage={(next) => void navigate({ to: "/workbench/$group", params: { group }, search: { page: next } })} />}
      <WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} />
    </div>
  );
}
