import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type {
  TestCaseDetail as Detail,
  TestCaseRevision,
} from "../../../shared/schemas/test-management.ts";
import { apiGet, apiPatch } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { Select } from "../Select.tsx";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { confirmDialog } from "../Dialog.tsx";
import { TestCaseEditor } from "./TestCaseEditor.tsx";
import { testingEndpoint, testingKey, TestStatusTag } from "./testing-ui.tsx";
export function TestCaseDetail({
  projectId,
  caseId,
  onClose,
  onSaved,
}: {
  projectId: string;
  caseId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const endpoint = testingEndpoint(projectId) + `/cases/${caseId}`;
  const [editing, setEditing] = useState(false),
    [revisionId, setRevisionId] = useState("");
  const query = useQuery({
    queryKey: [...testingKey(projectId), "case", caseId],
    queryFn: () => apiGet<Detail>(endpoint),
    retry: false,
  });
  const history = useInfiniteQuery({
    queryKey: [...testingKey(projectId), "history", caseId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<{
        items: { id: string; revisionNo: number; title: string }[];
        nextCursor: number | null;
      }>(endpoint + "/revisions", { before: pageParam, limit: 30 }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const old = useQuery({
    queryKey: [...testingKey(projectId), "revision", caseId, revisionId],
    enabled: !!revisionId,
    queryFn: () =>
      apiGet<TestCaseRevision>(endpoint + `/revisions/${revisionId}`),
    retry: false,
  });
  const refresh = async () => {
    await onSaved();
    await query.refetch();
    await history.refetch();
  };
  const lifecycle = useMutation({
    mutationFn: () =>
      apiPatch(endpoint, {
        expectedVersion: query.data!.version,
        status: query.data!.status === "ARCHIVED" ? "DRAFT" : "ARCHIVED",
      }),
    onSuccess: refresh,
  });
  const row = query.data,
    revision = revisionId ? old.data : row?.revision;
  return (
    <>
      <Drawer
        open
        title={row?.key ?? t("testing.cases")}
        width="lg"
        onClose={() => {
          if (!lifecycle.isPending) onClose();
        }}
      >
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
        {row && (
          <div className="testing-detail">
            <h2>{row.title}</h2>
            <div className="testing-detail-meta">
              <TestStatusTag status={row.status} />
              <WorkItemTag kind="priority" value={row.priority} />
              <span>{row.ownerName ?? t("testing.unassigned")}</span>
              <span>{row.suiteName ?? t("testing.noSuite")}</span>
              <span>{t("testing.revision", { n: row.revisionNo })}</span>
            </div>
            {row.canManage && (
              <div className="testing-detail-actions">
                {row.status !== "ARCHIVED" && (
                  <Button size="sm" onClick={() => setEditing(true)}>
                    {t("testing.editCase")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={lifecycle.isPending}
                  onClick={async () => {
                    if (
                      row.status === "ARCHIVED" ||
                      (await confirmDialog(t("testing.archiveHint")))
                    )
                      lifecycle.mutate();
                  }}
                >
                  {t(
                    row.status === "ARCHIVED"
                      ? "testing.restore"
                      : "testing.archive",
                  )}
                </Button>
              </div>
            )}
            {lifecycle.isError && (
              <p className="alert alert-error" role="alert">
                {lifecycle.error.message}
              </p>
            )}
            <div className="testing-history">
              <Select
                ariaLabel={t("testing.history")}
                value={revisionId}
                onChange={setRevisionId}
                options={[
                  {
                    value: "",
                    label: t("testing.current") + ` · V${row.revisionNo}`,
                  },
                  ...(history.data?.pages.flatMap((p) => p.items) ?? [])
                    .filter((r) => r.id !== row.currentRevisionId)
                    .map((r) => ({
                      value: r.id,
                      label: `V${r.revisionNo} · ${r.title}`,
                    })),
                ]}
              />
              {history.hasNextPage && (
                <Button
                  size="sm"
                  loading={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {t("testing.more")}
                </Button>
              )}
            </div>
            {history.isError && (
              <StateBlock
                kind="error"
                title={t("common.loadFailedShort")}
                action={() => void history.refetch()}
                actionLabel={t("common.reload")}
              />
            )}
            {revisionId && old.isPending && (
              <StateBlock kind="loading" title={t("common.loading")} />
            )}
            {revisionId && old.isError && (
              <StateBlock
                kind="error"
                title={t("common.loadFailedShort")}
                action={() => void old.refetch()}
                actionLabel={t("common.reload")}
              />
            )}
            {revision && (
              <>
                <section className="testing-section">
                  {revision.title !== row.title && (
                    <div className="testing-section-heading">
                      <h3>{revision.title}</h3>
                      <span className="muted">V{revision.revisionNo}</span>
                    </div>
                  )}
                  {revision.preconditions && (
                    <>
                      <h4>{t("testing.preconditions")}</h4>
                      <p className="testing-preserve">
                        {revision.preconditions}
                      </p>
                    </>
                  )}
                  <h4>{t("testing.steps")}</h4>
                  {!revision.steps.length && (
                    <p className="muted">{t("testing.noSteps")}</p>
                  )}
                  <ol className="testing-step-list">
                    {revision.steps.map((step, i) => (
                      <li key={i}>
                        <span className="testing-step-index">{i + 1}</span>
                        <div>
                          <strong>{t("testing.operation")}</strong>
                          <p className="testing-preserve">{step.action}</p>
                          <strong>{t("testing.expectedColumn")}</strong>
                          <p className="testing-preserve">{step.expected}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
                <section className="testing-section">
                  <h3>{t("testing.requirements")}</h3>
                  {!revision.requirements.length && (
                    <p className="muted">{t("testing.noRequirements")}</p>
                  )}
                  <ul className="testing-requirements">
                    {revision.requirements.map((ref) => (
                      <li key={ref.workItemId}>
                        <a
                          href={`/projects/${projectId}/table?item=${encodeURIComponent(ref.workItemId)}`}
                        >
                          <span className="mono">{ref.key}</span> · V
                          {ref.revisionNo} · {ref.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="muted testing-baseline">
                    {t("testing.createdBy")}：{revision.authorName ?? "—"} ·{" "}
                    {new Date(revision.createdAt).toLocaleString()}
                  </p>
                </section>
              </>
            )}
          </div>
        )}
      </Drawer>
      {editing && row && (
        <TestCaseEditor
          projectId={projectId}
          row={row}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
