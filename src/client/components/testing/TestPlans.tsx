import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { TestPlanPage } from "../../../shared/schemas/test-execution.ts";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { TestPlanEditor } from "./TestPlanEditor.tsx";
import { TestPlanWorkspace } from "./TestPlanWorkspace.tsx";
import { testingEndpoint, testingKey, TestStatusTag } from "./testing-ui.tsx";
export function TestPlans({
  projectId,
  reports = false,
}: {
  projectId: string;
  reports?: boolean;
}) {
  const [status, setStatus] = useState(""),
    [creating, setCreating] = useState(false),
    [planId, setPlanId] = useState<string | null>(null),
    qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: [...testingKey(projectId), "plans", status],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<TestPlanPage>(testingEndpoint(projectId) + "/plans", {
        status: status || undefined,
        before: pageParam,
        limit: 30,
      }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: testingKey(projectId) });
  };
  return (
    <>
      <section className="testing-library">
        <div className="testing-library-heading">
          <h2>{t(reports ? "testing.runs" : "testing.plans")}</h2>
          <div className="testing-toolbar-actions">
            <Select
              ariaLabel={t("testing.status")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: t("testing.statusAll") },
                ...["DRAFT", "RUNNING", "COMPLETED", "CANCELLED"].map(
                  (value) => ({ value, label: t(`testing.state.${value}`) }),
                ),
              ]}
            />
            {query.data?.pages[0]?.canManage && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCreating(true)}
              >
                {t("testing.newPlan")}
              </Button>
            )}
          </div>
        </div>
        {query.isPending && (
          <StateBlock kind="loading" title={t("common.loading")} />
        )}{" "}
        {query.isError && (
          <StateBlock
            kind="error"
            title={t("common.loadFailedShort")}
            action={() => void query.refetch()}
            actionLabel={t("common.reload")}
          />
        )}
        <ul className="testing-case-list">
          {query.data?.pages
            .flatMap((p) => p.items)
            .map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="testing-plan-row"
                  onClick={() => setPlanId(p.id)}
                >
                  <span className="testing-case-name">
                    <strong>{p.title}</strong>
                    <span className="muted mono">{p.key}</span>
                  </span>
                  <TestStatusTag status={p.status} />
                  <span className="testing-plan-build">
                    <span className="muted">{t("testing.build")}</span>
                    <span className="mono">{p.build}</span>
                  </span>
                  <span className="testing-plan-environment">
                    <span className="muted">{t("testing.environment")}</span>
                    <span>{p.environment}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
        {query.data?.pages.every((p) => !p.items.length) && (
          <StateBlock
            kind="empty"
            title={t("testing.noPlans")}
            description={t("testing.noPlansHint")}
          />
        )}
        {query.hasNextPage && (
          <div className="testing-pagination">
            <Button
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("testing.more")}
            </Button>
          </div>
        )}
      </section>
      {creating && (
        <TestPlanEditor
          projectId={projectId}
          row={null}
          onClose={() => setCreating(false)}
          onSaved={async (p) => {
            await refresh();
            setPlanId(p.id);
          }}
        />
      )}
      {planId && (
        <TestPlanWorkspace
          key={planId}
          projectId={projectId}
          planId={planId}
          reports={reports}
          onClose={() => setPlanId(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
