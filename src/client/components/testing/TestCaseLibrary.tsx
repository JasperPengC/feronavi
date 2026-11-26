import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  TestCasePage,
  TestSuite,
} from "../../../shared/schemas/test-management.ts";
import { apiGet, apiPatch } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { Select } from "../Select.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { TestCaseEditor } from "./TestCaseEditor.tsx";
import { TestCaseDetail } from "./TestCaseDetail.tsx";
import { TestSuiteEditor } from "./TestSuiteEditor.tsx";
import { testingEndpoint, testingKey, TestStatusTag } from "./testing-ui.tsx";
export function TestCaseLibrary({ projectId }: { projectId: string }) {
  const [suiteNavOpen, setSuiteNavOpen] = useState(() => !window.matchMedia?.("(max-width: 680px)").matches);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 680px)");
    if (!media) return;
    const resize = () => setSuiteNavOpen(!media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  const closeMobileSuites = () => { if (window.matchMedia?.("(max-width: 680px)").matches) setSuiteNavOpen(false); };
  const qc = useQueryClient(),
    [suiteId, setSuiteId] = useState(""),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [archivedSuites, setArchivedSuites] = useState(false);
  const [create, setCreate] = useState(false),
    [caseId, setCaseId] = useState<string | null>(null),
    [suiteForm, setSuiteForm] = useState<TestSuite | null | undefined>(
      undefined,
    );
  const suites = useQuery({
    queryKey: [...testingKey(projectId), "suites", archivedSuites],
    queryFn: () =>
      apiGet<{ items: TestSuite[]; canManage: boolean }>(
        testingEndpoint(projectId) + "/suites",
        { includeArchived: archivedSuites },
      ),
    retry: false,
  });
  const cases = useInfiniteQuery({
    queryKey: [
      ...testingKey(projectId),
      "cases",
      suiteId,
      status,
      appliedSearch,
    ],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<TestCasePage>(testingEndpoint(projectId) + "/cases", {
        suiteId: suiteId || undefined,
        status: status || undefined,
        search: appliedSearch || undefined,
        before: pageParam,
        limit: 30,
      }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: testingKey(projectId) });
  };
  const lifecycle = useMutation({
    mutationFn: (suite: TestSuite) =>
      apiPatch(testingEndpoint(projectId) + `/suites/${suite.id}`, {
        expectedVersion: suite.version,
        archived: !suite.archivedAt,
      }),
    onSuccess: async () => {
      setSuiteId("");
      await refresh();
    },
  });
  const selected = suites.data?.items.find((s) => s.id === suiteId),
    rows = cases.data?.pages.flatMap((p) => p.items) ?? [],
    canManage = cases.data?.pages[0]?.canManage === true;
  return (
    <div className="testing-library">
      <div className="testing-library-heading">
        <h2>{t("testing.cases")}</h2>
        <div className="testing-toolbar-actions">
          <Button size="sm" onClick={() => void refresh()}>
            {t("testing.refresh")}
          </Button>
          {canManage && (
            <>
              <Button size="sm" onClick={() => setSuiteForm(null)}>
                {t("testing.newSuite")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => setCreate(true)}
              >
                {t("testing.newCase")}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="testing-library-body">
        <aside className="testing-suite-nav" aria-label={t("testing.suites")}>
          <details open={suiteNavOpen} onToggle={e => setSuiteNavOpen(e.currentTarget.open)}>
          <summary><strong>{t("testing.suites")}</strong><span>{selected?.name ?? t("testing.allSuites")}</span></summary>
          <div className="testing-suite-options">
          <Checkbox
            label={t("testing.includeArchived")}
            checked={archivedSuites}
            onChange={(v) => {
              setArchivedSuites(v);
              setSuiteId("");
            }}
          />
          <button
            type="button"
            className="testing-suite-choice"
            aria-pressed={!suiteId}
            onClick={() => { setSuiteId(""); closeMobileSuites(); }}
          >
            {t("testing.allSuites")}
          </button>
          {suites.isPending && (
            <StateBlock kind="loading" title={t("common.loading")} />
          )}
          {suites.isError && (
            <StateBlock
              kind="error"
              title={t("common.loadFailedShort")}
              action={() => void suites.refetch()}
              actionLabel={t("common.reload")}
            />
          )}
          {(suites.data?.items ?? []).map((s) => (
            <button
              type="button"
              key={s.id}
              className="testing-suite-choice"
              aria-pressed={suiteId === s.id}
              onClick={() => {
                setSuiteId(s.id);
                closeMobileSuites();
                if (s.archivedAt) setStatus("ARCHIVED");
              }}
            >
              <span>
                {s.name}
                {s.archivedAt && (
                  <span className="muted">
                    {" "}
                    · {t("testing.state.ARCHIVED")}
                  </span>
                )}
              </span>
              <span
                className="testing-count"
                title={t("testing.caseCount", { n: s.activeCaseCount })}
              >
                {s.activeCaseCount}
              </span>
            </button>
          ))}
          </div>
          </details>
        </aside>
        <section className="testing-case-pane">
          {selected && (
            <div className="testing-suite-context">
              <div>
                <strong>{selected.name}</strong>
                {selected.description && (
                  <p className="muted">{selected.description}</p>
                )}
              </div>
              {selected.canManage && (
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSuiteForm(selected)}
                  >
                    {t("common.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      lifecycle.isPending ||
                      (!selected.archivedAt && selected.activeCaseCount > 0)
                    }
                    onClick={() => lifecycle.mutate(selected)}
                  >
                    {t(
                      selected.archivedAt
                        ? "testing.restoreSuite"
                        : "testing.archiveSuite",
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
          {lifecycle.isError && (
            <p className="alert alert-error" role="alert">
              {lifecycle.error.message}
            </p>
          )}
          <form
            className="testing-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedSearch(search.trim());
            }}
          >
            <TextInput
              aria-label={t("testing.search")}
              placeholder={t("testing.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" size="sm">
              {t("common.search")}
            </Button>
            <Select
              ariaLabel={t("testing.status")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: t("testing.stateAll") },
                ...["DRAFT", "READY", "ARCHIVED"].map((value) => ({
                  value,
                  label: t(`testing.state.${value}`),
                })),
              ]}
            />
            {(suiteId || status || appliedSearch) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSuiteId("");
                  setStatus("");
                  setSearch("");
                  setAppliedSearch("");
                }}
              >
                {t("testing.clear")}
              </Button>
            )}
          </form>
          {cases.isPending && (
            <StateBlock kind="loading" title={t("common.loading")} />
          )}
          {cases.isError && (
            <StateBlock
              kind="error"
              title={t("common.loadFailedShort")}
              action={() => void cases.refetch()}
              actionLabel={t("common.reload")}
            />
          )}
          {cases.isSuccess && !rows.length && (
            <StateBlock
              kind="empty"
              title={t(
                suiteId || status || appliedSearch
                  ? "testing.noMatches"
                  : "testing.empty",
              )}
              description={t("testing.emptyHint")}
              action={canManage ? () => setCreate(true) : undefined}
              actionLabel={canManage ? t("testing.newCase") : undefined}
            />
          )}
          {rows.length > 0 && (
            <>
              <div className="testing-case-columns" aria-hidden="true">
                <span>{t("testing.caseKey")}</span>
                <span>{t("testing.status")}</span>
                <span>{t("testing.priority")}</span>
                <span>{t("testing.owner")}</span>
                <span>{t("testing.version")}</span>
              </div>
              <ul className="testing-case-list">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="testing-case-row"
                      onClick={() => setCaseId(row.id)}
                    >
                      <span className="testing-case-name">
                        <strong>{row.title}</strong>
                        <span className="muted testing-case-meta">
                          <span className="mono">{row.key}</span>
                          {row.suiteName && (
                            <span className="testing-case-suite">
                              {" "}
                              · {row.suiteName}
                            </span>
                          )}
                        </span>
                      </span>
                      <TestStatusTag status={row.status} />
                      <WorkItemTag kind="priority" value={row.priority} />
                      <span className="testing-case-owner">
                        {row.ownerName ?? t("testing.unassigned")}
                      </span>
                      <span className="mono muted testing-case-version">
                        V{row.revisionNo}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {cases.hasNextPage && (
            <div className="testing-pagination">
              <Button
                loading={cases.isFetchingNextPage}
                onClick={() => void cases.fetchNextPage()}
              >
                {t("testing.more")}
              </Button>
            </div>
          )}
        </section>
      </div>
      {create && (
        <TestCaseEditor
          projectId={projectId}
          row={null}
          onClose={() => setCreate(false)}
          onSaved={refresh}
        />
      )}
      {caseId && (
        <TestCaseDetail
          key={caseId}
          projectId={projectId}
          caseId={caseId}
          onClose={() => setCaseId(null)}
          onSaved={refresh}
        />
      )}
      {suiteForm !== undefined && (
        <TestSuiteEditor
          key={suiteForm?.id ?? "new"}
          projectId={projectId}
          row={suiteForm}
          onClose={() => setSuiteForm(undefined)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
