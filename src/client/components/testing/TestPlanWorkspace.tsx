import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  TestPlanDetail,
  TestPlanReport,
  TestRunDetail,
} from "../../../shared/schemas/test-execution.ts";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { PageTabs, TabPanel } from "../ui/PageTabs.tsx";
import { TestPlanEditor } from "./TestPlanEditor.tsx";
import { TestRunPanel } from "./TestRunPanel.tsx";
import { testingEndpoint, testingKey, TestStatusTag } from "./testing-ui.tsx";
import { useTestingWrite } from "./useTestingWrite.ts";
export function TestPlanWorkspace({
  projectId,
  planId,
  reports,
  onClose,
  onSaved,
}: {
  projectId: string;
  planId: string;
  reports: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [view, setView] = useState(reports ? "report" : "execution"),
    [editing, setEditing] = useState(false),
    [runId, setRunId] = useState<string | null>(null),
    [cancel, setCancel] = useState(false),
    [reason, setReason] = useState("");
  const write = useTestingWrite(),
    busy = useRef(false),
    endpoint = testingEndpoint(projectId) + `/plans/${planId}`;
  const query = useQuery({
    queryKey: [...testingKey(projectId), "plan", planId],
    queryFn: () => apiGet<TestPlanDetail>(endpoint),
    retry: false,
  });
  const report = useQuery({
    queryKey: [...testingKey(projectId), "report", planId],
    queryFn: () => apiGet<TestPlanReport>(endpoint + "/report"),
    enabled: view === "report",
    retry: false,
  });
  const refresh = async () => {
    await onSaved();
    await query.refetch();
    if (view === "report") await report.refetch();
  };
  const transition = useMutation({
    mutationFn: (action: "START" | "COMPLETE" | "CANCEL") =>
      write<TestPlanDetail>(endpoint + "/transition", {
        expectedVersion: query.data!.version,
        action,
        ...(action === "CANCEL" ? { reason } : {}),
      }),
    onSuccess: async () => {
      setCancel(false);
      setReason("");
      await refresh();
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const start = useMutation({
    mutationFn: (planCaseId: string) =>
      write<TestRunDetail>(endpoint + "/runs", {
        planCaseId,
        source: "MANUAL",
      }),
    onSuccess: async (r) => {
      setRunId(r.id);
      await refresh();
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const act = (action: "START" | "COMPLETE" | "CANCEL") => {
    if (busy.current) return;
    busy.current = true;
    transition.mutate(action);
  };
  const p = query.data,
    pending = transition.isPending || start.isPending;
  return (
    <>
      <Drawer
        open
        title={p?.key ?? t("testing.plans")}
        width="lg"
        onClose={() => {
          if (!busy.current) onClose();
        }}
      >
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
        {p && (
          <div className="testing-detail">
            <h2>{p.title}</h2>
            <div className="testing-detail-meta">
              <TestStatusTag status={p.status} />
              <span>{t("testing.caseTotal", { n: p.cases.length })}</span>
            </div>
            <dl className="testing-context">
              <div>
                <dt>{t("testing.build")}</dt>
                <dd className="mono">{p.build}</dd>
              </div>
              <div>
                <dt>{t("testing.environment")}</dt>
                <dd>{p.environment}</dd>
              </div>
            </dl>
            {p.canManage && (
              <div className="testing-detail-actions">
                {p.status === "DRAFT" && (
                  <>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => setEditing(true)}
                    >
                      {t("testing.editPlan")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={pending || !p.cases.length}
                      onClick={() => act("START")}
                    >
                      {t("testing.startPlan")}
                    </Button>
                  </>
                )}
                {p.status === "RUNNING" && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={
                      pending ||
                      p.cases.some(
                        (c) =>
                          !c.latestRun ||
                          ["IN_PROGRESS", "CANCELLED"].includes(
                            c.latestRun.status,
                          ),
                      )
                    }
                    onClick={() => act("COMPLETE")}
                  >
                    {t("testing.completePlan")}
                  </Button>
                )}
                {["DRAFT", "RUNNING"].includes(p.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setCancel((v) => !v)}
                  >
                    {t("testing.cancelPlan")}
                  </Button>
                )}
              </div>
            )}
            {cancel && (
              <div className="testing-form testing-section">
                <TextArea
                  label={t("testing.cancelReason")}
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={pending}
                />
                <Button
                  disabled={pending || !reason.trim()}
                  onClick={() => act("CANCEL")}
                >
                  {t("testing.cancelPlan")}
                </Button>
              </div>
            )}
            {p.cancelReason && <p className="alert">{p.cancelReason}</p>}
            {(transition.isError || start.isError) && (
              <div className="alert alert-error" role="alert">
                {transition.error?.message ?? start.error?.message}
                <Button onClick={() => void refresh()}>
                  {t("common.reload")}
                </Button>
              </div>
            )}
            <PageTabs
              id="test-plan"
              label={t("testing.plans")}
              value={view}
              onChange={setView}
              tabs={[
                { value: "execution", label: t("testing.runs") },
                { value: "report", label: t("testing.report") },
              ]}
            />
            <TabPanel tabsId="test-plan" value="execution" activeValue={view}>
              <ul className="testing-case-list testing-plan-cases">
                {p.cases.map((c) => (
                  <li key={c.id}>
                    <div className="testing-plan-case">
                      <span className="testing-case-name">
                        <strong>{c.title}</strong>
                        <span className="muted mono">
                          {c.key} · V{c.revisionNo}
                        </span>
                      </span>
                      <TestStatusTag
                        status={c.latestRun?.status ?? "NOT_RUN"}
                      />
                      {c.latestRun ? (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => setRunId(c.latestRun!.id)}
                        >
                          {t("testing.viewRun")}
                        </Button>
                      ) : p.status === "RUNNING" && p.canExecute ? (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            if (busy.current) return;
                            busy.current = true;
                            start.mutate(c.id);
                          }}
                        >
                          {t("testing.startRun")}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </TabPanel>
            <TabPanel tabsId="test-plan" value="report" activeValue={view}>
              {report.isPending && (
                <StateBlock kind="loading" title={t("common.loading")} />
              )}{" "}
              {report.isError && (
                <StateBlock
                  kind="error"
                  title={t("common.loadFailedShort")}
                  action={() => void report.refetch()}
                  actionLabel={t("common.reload")}
                />
              )}
              {report.data && (
                <Report report={report.data} openRun={setRunId} />
              )}
            </TabPanel>
          </div>
        )}
      </Drawer>
      {editing && p && (
        <TestPlanEditor
          projectId={projectId}
          row={p}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            await refresh();
          }}
        />
      )}
      {runId && (
        <TestRunPanel
          key={runId}
          projectId={projectId}
          runId={runId}
          onClose={() => setRunId(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
function Report({
  report: r,
  openRun,
}: {
  report: TestPlanReport;
  openRun: (id: string) => void;
}) {
  const download = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `${r.plan.key}-report.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="testing-report">
      <div className="testing-section-heading">
        <strong>
          {t(r.passed ? "testing.reportPass" : "testing.reportOpen")}
        </strong>
        <Button size="sm" onClick={download}>
          {t("testing.exportReport")}
        </Button>
      </div>
      <div className="testing-detail-meta">
        <span>{t("testing.caseTotal", { n: r.totalCases })}</span>
        <span>{t("testing.attemptTotal", { n: r.totalAttempts })}</span>
      </div>
      <h3>{t("testing.latestResults")}</h3>
      <p className="muted">
        {t("testing.testedBuild")}：
        <span className="mono">
          {r.testedBuild ?? t("testing.mixedBuilds")}
        </span>{" "}
        · {r.testedEnvironment ?? t("testing.mixedBuilds")}
      </p>
      <div className="testing-report-counts">
        {Object.entries(r.latestResults)
          .filter(([, n]) => n > 0)
          .map(([status, n]) => (
            <span key={status}>
              <TestStatusTag status={status} />
              <strong>{n}</strong>
            </span>
          ))}
      </div>
      <p className="muted">{t("testing.selfReportedHint")}</p>
      <h3>{t("testing.runHistory")}</h3>
      {r.cases.map((c) => (
        <section className="testing-report-case" key={c.planCaseId}>
          <div className="testing-section-heading">
            <strong>{c.title}</strong>
            <TestStatusTag status={c.latestStatus} />
          </div>
          <p className="muted mono">
            {c.key} · V{c.revisionNo}
          </p>
          {c.runs.map((run) => (
            <button
              type="button"
              className="testing-report-run"
              key={run.id}
              onClick={() => openRun(run.id)}
            >
              <span>{t("testing.attempt", { n: run.attempt })}</span>
              <TestStatusTag status={run.status} />
              <span>{run.executorName ?? "—"}</span>
              <span className="mono">{run.build}</span>
              <span className="muted">{run.environment}</span>
              <span className="muted">{t(`testing.${run.source}`)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
