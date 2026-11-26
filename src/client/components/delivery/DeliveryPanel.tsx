import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  DeliveryEvidencePage,
  DeliveryEvidenceView,
} from "../../../shared/schemas/delivery.ts";
import { apiGet } from "../../lib/api.ts";
import { useCan } from "../../lib/actor.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { useTestingWrite } from "../testing/useTestingWrite.ts";
import { DeliveryEvidenceEditor } from "./DeliveryEvidenceEditor.tsx";
import {
  deliveryEndpoint,
  deliveryKey,
  DeliveryStatus,
  DeliveryVerification,
} from "./delivery-ui.tsx";
export function DeliveryPanel({
  projectId,
  workItemId,
}: {
  projectId: string;
  workItemId: string;
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [linking, setLinking] = useState(false),
    [selected, setSelected] = useState("");
  const canWrite = useCan("work_item:update_any"),
    qc = useQueryClient(),
    write = useTestingWrite();
  const query = useInfiniteQuery({
    queryKey: [...deliveryKey(projectId), "workItem", workItemId],
    enabled: open,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<DeliveryEvidencePage>(deliveryEndpoint(projectId) + "/evidence", {
        workItemId,
        before: pageParam,
        limit: 20,
      }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const candidates = useInfiniteQuery({
    queryKey: [...deliveryKey(projectId), "candidates"],
    enabled: linking,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<DeliveryEvidencePage>(deliveryEndpoint(projectId) + "/evidence", {
        before: pageParam,
        limit: 30,
      }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: deliveryKey(projectId) });
  };
  const link = useMutation({
    mutationFn: () =>
      write<DeliveryEvidenceView>(
        deliveryEndpoint(projectId) + `/evidence/${selected}/links`,
        { workItemIds: [workItemId] },
      ),
    onSuccess: async () => {
      setSelected("");
      setLinking(false);
      await refresh();
    },
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <details
      className="wi-detail-fold delivery-panel"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t("delivery.heading")}</summary>
      {open && (
        <div className="wi-detail-fold-content">
          <div className="delivery-toolbar">
            <span className="muted">{t("delivery.panelHint")}</span>
            {canWrite && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLinking((v) => !v)}
                >
                  {t("delivery.link")}
                </Button>
                <Button size="sm" onClick={() => setEditing(true)}>
                  {t("delivery.new")}
                </Button>
              </div>
            )}
          </div>
          {linking && (
            <div className="delivery-link-form">
              <Select
                searchable
                ariaLabel={t("delivery.choose")}
                value={selected}
                onChange={setSelected}
                options={[
                  { value: "", label: t("delivery.choose") },
                  ...(candidates.data?.pages.flatMap((p) => p.items) ?? []).map(
                    (e) => ({
                      value: e.id,
                      label: `${e.title} · ${t(`delivery.status.${e.status}`)} · ${e.build}`,
                    }),
                  ),
                ]}
              />
              <Button
                size="sm"
                disabled={!selected || link.isPending}
                onClick={() => link.mutate()}
              >
                {t("delivery.confirmLink")}
              </Button>
              {candidates.hasNextPage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void candidates.fetchNextPage()}
                >
                  {t("delivery.more")}
                </Button>
              )}
              {candidates.isError && (
                <p role="alert">{candidates.error.message}</p>
              )}
              {link.isError && <p role="alert">{link.error.message}</p>}
            </div>
          )}
          {query.isPending && (
            <StateBlock kind="loading" title={t("common.loading")} />
          )}
          {query.isError && (
            <StateBlock
              kind="error"
              title={t("common.loadFailedShort")}
              action={() => void query.refetch()}
              actionLabel={t("common.reload")}
            />
          )}
          {query.isSuccess && !items.length && (
            <p className="muted delivery-empty">{t("delivery.empty")}</p>
          )}
          <ul className="delivery-list">
            {items.map((row) => (
              <li key={row.id}>
                <div className="delivery-row-heading">
                  <a href={row.url} target="_blank" rel="noopener noreferrer">
                    {row.title}
                  </a>
                  <div className="delivery-tags">
                    <DeliveryStatus status={row.status} />
                    <DeliveryVerification row={row} />
                  </div>
                </div>
                <div className="delivery-row-meta">
                  <span>{t(`delivery.kind.${row.kind}`)}</span>
                  <span>{row.repository}</span>
                  <span className="mono" title={row.commitSha}>
                    {row.commitSha.slice(0, 12)}
                  </span>
                  <time dateTime={row.receivedAt}>
                    {new Date(row.receivedAt).toLocaleString()}
                  </time>
                </div>
                <div className="delivery-row-build">
                  <span>{t("delivery.build")}</span>
                  <code>{row.build}</code>
                  {row.environment && <span>{row.environment}</span>}
                </div>
                {typeof row.details?.summary === "string" && row.details.summary && (
                  <details className="delivery-row-notes">
                    <summary>{t("delivery.summary")}</summary>
                    <p>{row.details.summary}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <Button
              size="sm"
              variant="ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("delivery.more")}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <DeliveryEvidenceEditor
          projectId={projectId}
          workItemId={workItemId}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
    </details>
  );
}
