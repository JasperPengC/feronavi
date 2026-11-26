import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  TestRunDetail,
  TestRunDefectResult,
  TestStepResult,
} from "../../../shared/schemas/test-execution.ts";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { Select } from "../Select.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { testingEndpoint, testingKey, TestStatusTag } from "./testing-ui.tsx";
import { useTestingWrite } from "./useTestingWrite.ts";
export function TestRunPanel({
  projectId,
  runId,
  onClose,
  onSaved,
  initialRun,
}: {
  projectId: string;
  runId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  initialRun?: TestRunDetail;
}) {
  const [activeId, setActiveId] = useState(runId);
  const query = useQuery({
    queryKey: [...testingKey(projectId), "run", activeId],
    queryFn: () =>
      apiGet<TestRunDetail>(testingEndpoint(projectId) + `/runs/${activeId}`),
    initialData: activeId === runId ? initialRun : undefined,
    retry: false,
  });
  if (query.data)
    return (
      <RunForm
        key={activeId}
        projectId={projectId}
        initial={query.data}
        onClose={onClose}
        onSaved={onSaved}
        onRetest={(r) => setActiveId(r.id)}
      />
    );
  return (
    <Drawer open title={t("testing.viewRun")} width="lg" onClose={onClose}>
      <StateBlock
        kind={query.isError ? "error" : "loading"}
        title={t(query.isError ? "common.loadFailedShort" : "common.loading")}
        action={query.isError ? () => void query.refetch() : undefined}
        actionLabel={t("common.reload")}
      />
    </Drawer>
  );
}
function RunForm({
  projectId,
  initial,
  onClose,
  onSaved,
  onRetest,
}: {
  projectId: string;
  initial: TestRunDetail;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onRetest: (run: TestRunDetail) => void;
}) {
  const [run, setRun] = useState(initial),
    [error, setError] = useState("");
  const [retesting, setRetesting] = useState(false),
    [retestBuild, setRetestBuild] = useState(run.build),
    [retestEnvironment, setRetestEnvironment] = useState(run.environment);
  const [steps, setSteps] = useState(() =>
    run.revision.steps.map((_, stepIndex) => {
      const result = run.results.find((r) => r.stepIndex === stepIndex);
      return {
        stepIndex,
        status: result?.status ?? ("PASSED" as TestStepResult["status"]),
        actual: result?.actual ?? "",
        evidence: result?.evidence.join("\n") ?? "",
      };
    }),
  );
  const [defectTitle, setDefectTitle] = useState(run.revision.title),
    [defectId, setDefectId] = useState(""),
    [saving, setSaving] = useState(false),
    [defectMode, setDefectMode] = useState<"create" | "link" | null>(null);
  const busy = useRef(false),
    write = useTestingWrite(),
    endpoint = testingEndpoint(projectId) + `/runs/${run.id}`;
  const defects = useQuery({
    queryKey: ["test-run-defect-options", projectId],
    queryFn: () =>
      apiGet<{ rows: { id: string; key: string; title: string }[] }>(
        `/api/v1/projects/${projectId}/work-items`,
        { view: "table", type: "DEFECT", pageSize: 100 },
      ),
    enabled: defectMode === "link",
    retry: false,
  });
  const draft = useSettingsDraft(run.canExecute, steps, saving);
  const results = () =>
    steps
      .filter((s) => s.actual.trim())
      .map((s) => ({
        ...s,
        evidence: s.evidence
          .split(/\r?\n/u)
          .map((v) => v.trim())
          .filter(Boolean),
      }));
  const valid = steps.length > 0 && steps.every((s) => s.actual.trim());
  const action = useMutation({
    mutationFn: async (
      kind: "save" | "complete" | "retest" | "reload" | "create" | "link",
    ) => {
      setError("");
      if (kind === "reload") {
        setRun(await apiGet<TestRunDetail>(endpoint));
        return;
      }
      if (kind === "retest") {
        const next = await write<TestRunDetail>(
          testingEndpoint(projectId) + `/plans/${run.planId}/runs`,
          {
            planCaseId: run.planCaseId,
            retestOf: run.id,
            source: "MANUAL",
            build: retestBuild,
            environment: retestEnvironment,
          },
        );
        await onSaved();
        onRetest(next);
        return;
      }
      if (kind === "create" || kind === "link") {
        await write<TestRunDefectResult>(
          endpoint + (kind === "create" ? "/defects" : "/defect-links"),
          kind === "create" ? { title: defectTitle } : { defectId },
        );
        setDefectMode(null);
        setRun(await apiGet<TestRunDetail>(endpoint));
        await onSaved();
        return;
      }
      let updated = run;
      if (draft.dirty || !run.results.length) {
        updated = await write<TestRunDetail>(
          endpoint,
          { expectedVersion: run.version, results: results() },
          "PATCH",
        );
        setRun(updated);
        draft.markSaved(steps);
      }
      if (kind === "complete") {
        updated = await write<TestRunDetail>(endpoint + "/complete", {
          expectedVersion: updated.version,
        });
        setRun(updated);
      }
      await onSaved();
    },
    onError: (e) => setError(e.message),
    onSettled: () => {
      busy.current = false;
      setSaving(false);
    },
  });
  const perform = (kind: Parameters<typeof action.mutate>[0]) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    action.mutate(kind);
  };
  const close = () => {
    if (!busy.current) void draft.leave(onClose);
  };
  return (
    <Drawer
      open
      title={`${run.caseKey} · ${t("testing.attempt", { n: run.attempt })}`}
      width="lg"
      onClose={close}
      footer={
        run.canExecute ? (
          <>
            <Button
              disabled={!results().length || action.isPending}
              onClick={() => perform("save")}
            >
              {t("testing.saveRun")}
            </Button>
            <Button
              variant="primary"
              disabled={!valid || action.isPending}
              onClick={() => perform("complete")}
            >
              {t("testing.completeRun")}
            </Button>
          </>
        ) : run.canRetest ? (
          <Button
            variant="primary"
            loading={action.isPending}
            disabled={
              retesting && (!retestBuild.trim() || !retestEnvironment.trim())
            }
            onClick={() => (retesting ? perform("retest") : setRetesting(true))}
          >
            {t(retesting ? "testing.confirmRetest" : "testing.retest")}
          </Button>
        ) : undefined
      }
    >
      {draft.guard}
      <div className="testing-detail">
        {retesting && (
          <section className="testing-form testing-section">
            <h3>{t("testing.retest")}</h3>
            <TextInput
              label={t("testing.retestBuild")}
              value={retestBuild}
              maxLength={200}
              disabled={action.isPending}
              onChange={(e) => setRetestBuild(e.target.value)}
            />
            <TextInput
              label={t("testing.retestEnvironment")}
              value={retestEnvironment}
              maxLength={300}
              disabled={action.isPending}
              onChange={(e) => setRetestEnvironment(e.target.value)}
            />
            <p className="muted">{t("testing.retestBuildHint")}</p>
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() => setRetesting(false)}
            >
              {t("common.cancel")}
            </Button>
          </section>
        )}
        <h2>{run.revision.title}</h2>
        <div className="testing-detail-meta">
          <TestStatusTag status={run.status} />
          <span>
            {t("testing.fixedRevision", { n: run.revision.revisionNo })}
          </span>
          <span>{run.executorName ?? "—"}</span>
          <span>{t(`testing.${run.source}`)}</span>
        </div>
        <dl className="testing-context">
          <div>
            <dt>{t("testing.build")}</dt>
            <dd className="mono">{run.build}</dd>
          </div>
          <div>
            <dt>{t("testing.environment")}</dt>
            <dd>{run.environment}</dd>
          </div>
        </dl>
        <p className="muted">{t("testing.runFixedHint")}</p>
        {run.cancelReason && <p className="alert">{run.cancelReason}</p>}
        {run.revision.preconditions && (
          <section className="testing-section">
            <h3>{t("testing.preconditions")}</h3>
            <p className="testing-preserve">{run.revision.preconditions}</p>
          </section>
        )}
        <ol className="testing-steps">
          {run.revision.steps.map((step, i) => (
            <li className="testing-step" key={i}>
              <div className="testing-step-number">
                <strong>{t("testing.action", { n: i + 1 })}</strong>
                {run.results.some((s) => s.stepIndex === i) && (
                  <TestStatusTag
                    status={
                      run.results.find((s) => s.stepIndex === i)?.status ??
                      "NOT_RUN"
                    }
                  />
                )}
              </div>
              <p className="testing-preserve">{step.action}</p>
              <p className="testing-preserve muted">
                {t("testing.expected", { n: i + 1 })}：{step.expected}
              </p>
              {run.canExecute ? (
                <div className="testing-form">
                  <Select
                    label={t("testing.result")}
                    ariaLabel={`${t("testing.result")} ${i + 1}`}
                    value={steps[i]!.status}
                    disabled={action.isPending}
                    onChange={(v) =>
                      setSteps((s) =>
                        s.map((x, j) =>
                          j === i
                            ? { ...x, status: v as TestStepResult["status"] }
                            : x,
                        ),
                      )
                    }
                    options={["PASSED", "FAILED", "BLOCKED", "SKIPPED"].map(
                      (value) => ({
                        value,
                        label: t(`testing.state.${value}`),
                      }),
                    )}
                  />
                  <TextArea
                    label={t("testing.actual", { n: i + 1 })}
                    value={steps[i]!.actual}
                    maxLength={10000}
                    rows={3}
                    disabled={action.isPending}
                    onChange={(e) =>
                      setSteps((s) =>
                        s.map((x, j) =>
                          j === i ? { ...x, actual: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <TextArea
                    label={t("testing.evidence", { n: i + 1 })}
                    hint={t("testing.evidenceHint")}
                    rows={2}
                    value={steps[i]!.evidence}
                    disabled={action.isPending}
                    onChange={(e) =>
                      setSteps((s) =>
                        s.map((x, j) =>
                          j === i ? { ...x, evidence: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
              ) : (
                <>
                  <p className="testing-preserve">
                    {run.results.find((s) => s.stepIndex === i)?.actual ?? "—"}
                  </p>
                  {run.results
                    .find((s) => s.stepIndex === i)
                    ?.evidence.map((url) => (
                      <a
                        key={url}
                        className="testing-evidence"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {url}
                      </a>
                    ))}
                </>
              )}
            </li>
          ))}
        </ol>
        <section className="testing-section">
          <div className="testing-section-heading">
            <h3>{t("testing.linkedDefects")}</h3>
            {run.status === "FAILED" && (
              <div className="testing-detail-actions">
                {run.canCreateDefect && (
                  <Button size="sm" onClick={() => setDefectMode("create")}>
                    {t("testing.createDefect")}
                  </Button>
                )}
                {run.canLinkDefect && (
                  <Button size="sm" onClick={() => setDefectMode("link")}>
                    {t("testing.linkDefect")}
                  </Button>
                )}
              </div>
            )}
          </div>
          {run.defects.map((d) => (
            <a
              className="testing-defect-link"
              key={d.id}
              href={`/projects/${projectId}/table?item=${d.id}`}
            >
              <span className="mono">{d.key}</span> {d.title}
              <WorkItemTag
                kind="status"
                value={d.statusCategory}
                stateKey={d.statusKey}
                label={d.statusName}
              />
            </a>
          ))}
          {!run.defects.length && (
            <p className="muted">{t("testing.noDefects")}</p>
          )}
          {defectMode && (
            <div className="testing-form">
              {defectMode === "create" ? (
                <TextInput
                  label={t("testing.defectTitle")}
                  value={defectTitle}
                  maxLength={300}
                  disabled={action.isPending}
                  onChange={(e) => setDefectTitle(e.target.value)}
                />
              ) : (
                <Select
                  label={t("testing.selectDefect")}
                  ariaLabel={t("testing.selectDefect")}
                  value={defectId}
                  onChange={setDefectId}
                  options={[
                    { value: "", label: t("testing.selectDefect") },
                    ...(defects.data?.rows ?? []).map((d) => ({
                      value: d.id,
                      label: `${d.key} ${d.title}`,
                    })),
                  ]}
                />
              )}
              <div className="testing-detail-actions">
                <Button
                  onClick={() => setDefectMode(null)}
                  disabled={action.isPending}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    action.isPending ||
                    !(defectMode === "create" ? defectTitle.trim() : defectId)
                  }
                  onClick={() => perform(defectMode)}
                >
                  {t(
                    defectMode === "create"
                      ? "testing.createDefect"
                      : "testing.linkDefect",
                  )}
                </Button>
              </div>
              {defects.isError && <p role="alert">{defects.error.message}</p>}
            </div>
          )}
        </section>
        {error && (
          <div role="alert" className="alert alert-error">
            <p>{error}</p>
            <Button
              disabled={action.isPending}
              onClick={() => perform("reload")}
            >
              {t("testing.refreshConflict")}
            </Button>
          </div>
        )}
        <p className="muted testing-source-note">
          {t("testing.selfReportedHint")}
          {run.sourceReference && (
            <>
              {" "}
              · <span className="mono">{run.sourceReference}</span>
            </>
          )}
        </p>
      </div>
    </Drawer>
  );
}
