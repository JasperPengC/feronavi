import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { TestCasePage } from "../../../shared/schemas/test-management.ts";
import type { TestPlanDetail } from "../../../shared/schemas/test-execution.ts";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { testingEndpoint, testingKey } from "./testing-ui.tsx";
import { useTestingWrite } from "./useTestingWrite.ts";
export function TestPlanEditor({
  projectId,
  row,
  onClose,
  onSaved,
}: {
  projectId: string;
  row: TestPlanDetail | null;
  onClose: () => void;
  onSaved: (plan: TestPlanDetail) => Promise<void>;
}) {
  const [title, setTitle] = useState(row?.title ?? ""),
    [build, setBuild] = useState(row?.build ?? ""),
    [environment, setEnvironment] = useState(row?.environment ?? "");
  const [selected, setSelected] = useState(
    (row?.cases ?? []).map((c) => ({
      caseId: c.caseId,
      revisionId: c.revisionId,
      title: c.title,
      revisionNo: c.revisionNo,
    })),
  );
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const busy = useRef(false),
    write = useTestingWrite();
  const cases = useInfiniteQuery({
    queryKey: [...testingKey(projectId), "ready", query],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<TestCasePage>(testingEndpoint(projectId) + "/cases", {
        status: "READY",
        search: query || undefined,
        before: pageParam,
        limit: 50,
      }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () =>
      write<TestPlanDetail>(
        testingEndpoint(projectId) + "/plans" + (row ? `/${row.id}` : ""),
        {
          title,
          build,
          environment,
          ...(!row ||
          JSON.stringify(selected.map((c) => [c.caseId, c.revisionId])) !==
            JSON.stringify(row.cases.map((c) => [c.caseId, c.revisionId]))
            ? {
                cases: selected.map(({ caseId, revisionId }) => ({
                  caseId,
                  revisionId,
                })),
              }
            : {}),
          ...(row ? { expectedVersion: row.version } : {}),
        },
        row ? "PATCH" : "POST",
      ),
    onSuccess: async (p) => {
      await onSaved(p);
      onClose();
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const draft = useSettingsDraft(
      true,
      { title, build, environment, selected },
      save.isPending,
    ),
    close = () => void draft.leave(onClose);
  const valid = !!title.trim() && !!build.trim() && !!environment.trim();
  const submit = () => {
    if (!valid || busy.current) return;
    busy.current = true;
    save.mutate();
  };
  return (
    <Drawer
      open
      title={t(row ? "testing.editPlan" : "testing.newPlan")}
      width="lg"
      onClose={close}
      footer={
        <>
          <Button disabled={save.isPending} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!valid}
            onClick={submit}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      {draft.guard}
      <div className="testing-form">
        <TextInput
          label={t("testing.planTitle")}
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          disabled={save.isPending}
        />
        <div className="testing-form-grid">
          <TextInput
            label={t("testing.build")}
            value={build}
            maxLength={200}
            onChange={(e) => setBuild(e.target.value)}
            disabled={save.isPending}
          />
          <TextInput
            label={t("testing.environment")}
            value={environment}
            maxLength={300}
            onChange={(e) => setEnvironment(e.target.value)}
            disabled={save.isPending}
          />
        </div>
        <p className="muted">{t("testing.planHint")}</p>
        <section className="testing-section">
          <h3>{t("testing.chooseCases")}</h3>
          <form
            className="testing-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search.trim());
            }}
          >
            <TextInput
              aria-label={t("testing.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit">{t("common.search")}</Button>
          </form>
          <p className="muted">
            {t("testing.selectedCases", { n: selected.length })}
          </p>
          {selected.map((c) => (
            <div key={c.caseId} className="testing-selected-case">
              <span>
                {c.title} <span className="muted">V{c.revisionNo}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("testing.removeCase", { name: c.title })}
                disabled={save.isPending}
                onClick={() =>
                  setSelected((v) => v.filter((x) => x.caseId !== c.caseId))
                }
              >
                ×
              </Button>
            </div>
          ))}
          {cases.isPending && (
            <StateBlock kind="loading" title={t("common.loading")} />
          )}{" "}
          {cases.isError && (
            <StateBlock
              kind="error"
              title={t("common.loadFailedShort")}
              action={() => void cases.refetch()}
              actionLabel={t("common.reload")}
            />
          )}
          {(cases.data?.pages.flatMap((p) => p.items) ?? []).map((c) => (
            <div className="testing-case-option" key={c.id}>
              <Checkbox
                label={c.title}
                checked={selected.some((x) => x.caseId === c.id)}
                disabled={
                  save.isPending ||
                  (selected.length >= 500 &&
                    !selected.some((x) => x.caseId === c.id))
                }
                onChange={(checked) =>
                  setSelected((v) =>
                    checked
                      ? [
                          ...v,
                          {
                            caseId: c.id,
                            revisionId: c.currentRevisionId,
                            title: c.title,
                            revisionNo: c.revisionNo,
                          },
                        ]
                      : v.filter((x) => x.caseId !== c.id),
                  )
                }
              />
              <span className="muted mono">
                {c.key} · V{c.revisionNo}
              </span>
              <WorkItemTag kind="priority" value={c.priority} />
            </div>
          ))}
          {cases.data?.pages.every((p) => !p.items.length) && (
            <p className="muted">{t("testing.noReady")}</p>
          )}
          {cases.hasNextPage && (
            <Button
              loading={cases.isFetchingNextPage}
              onClick={() => void cases.fetchNextPage()}
            >
              {t("testing.more")}
            </Button>
          )}
        </section>
        {save.isError && (
          <p role="alert" className="alert alert-error">
            {save.error.message}
          </p>
        )}
      </div>
    </Drawer>
  );
}
