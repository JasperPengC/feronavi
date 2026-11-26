import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReleaseGateView } from "../../../shared/schemas/release-gate.ts";
import { releaseFeedbackSchema } from "../../../shared/schemas/release-gate.ts";
import { apiGet } from "../../lib/api.ts";
import { useCan } from "../../lib/actor.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Drawer } from '../ui/Drawer.tsx';
import {useSettingsDraft} from '../settings/SettingsDraft.tsx';
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { Select } from "../Select.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { useTestingWrite } from "../testing/useTestingWrite.ts";
import { deliveryEndpoint, deliveryKey } from "./delivery-ui.tsx";
import { ReleaseCandidateEditor } from "./ReleaseCandidateEditor.tsx";

export function ReleaseGatePanel({
  projectId,
  releaseId,
  onReady,
}: {
  projectId: string;
  releaseId: string;
  onReady?: (ready: boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    canManage = useCan("release:manage");
  const query = useQuery({
    queryKey: [...deliveryKey(projectId), "release", releaseId],
    queryFn: () =>
      apiGet<ReleaseGateView>(
        `${deliveryEndpoint(projectId)}/releases/${releaseId}`,
      ),
    retry: false,
  });
  useEffect(() => {
    onReady?.(
      query.isSuccess &&
        !query.isFetching &&
        query.data.passed &&
        !query.data.completedAt,
    );
    return () => onReady?.(false);
  }, [onReady, query.isSuccess, query.isFetching, query.data]);
  if (query.isPending)
    return <StateBlock kind="loading" title={t("common.loading")} />;
  if (query.isError)
    return (
      <StateBlock
        kind="error"
        title={t("common.loadFailedShort")}
        action={() => void query.refetch()}
        actionLabel={t("common.reload")}
      />
    );
  const report = query.data,
    c = report.candidate;
  return (
    <section className="release-gate-panel">
      <div className="delivery-toolbar">
        <strong>{t("delivery.gate.heading")}</strong>
        <WorkItemTag
          kind="status"
          value={
            report.passed ? "DONE" : report.completedAt ? "HISTORY" : "WAITING"
          }
          stateKey={
            report.passed
              ? "PASSED"
              : report.completedAt
                ? "HISTORY"
                : "WAITING"
          }
          label={t(
            report.passed
              ? "delivery.gate.ready"
              : report.completedAt
                ? "delivery.gate.history"
                : "delivery.gate.blocked",
          )}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("delivery.gate.recheck")}
        </Button>
      </div>
      {c && (
        <div className="release-candidate-summary">
          <strong>{t("delivery.gate.candidate", { n: c.number })}</strong>
          <span>{c.repository}</span>
          <code title={c.commitSha}>{c.commitSha.slice(0, 12)}</code>
          <span>{c.environment}</span>
          <span>{t("delivery.gate.scope", { n: c.workItems.length })}</span>
        </div>
      )}
      <ul className="release-gate-checks">
        {report.checks.map((check) => (
          <li key={check.key}>
            <WorkItemTag
              kind="status"
              value={check.passed ? "DONE" : "WAITING"}
              stateKey={check.passed ? "PASSED" : "WAITING"}
              label={t(
                check.passed ? "delivery.gate.pass" : "delivery.gate.blocked",
              )}
            />
            <span>{check.message}</span>
          </li>
        ))}
      </ul>
      {!report.completedAt && canManage && (
        <Button size="sm" onClick={() => setEditing(true)}>
          {t(c ? "delivery.gate.replace" : "delivery.gate.create")}
        </Button>
      )}
      {report.verification && (
        <p className="muted">
          {t("delivery.gate.recorded", {
            time: new Date(report.verification.checkedAt).toLocaleString(),
          })}
        </p>
      )}
      {report.feedback.length > 0 && (
        <ul className="delivery-list">
          {report.feedback.map((f) => (
            <li key={f.id}>
              <div className="delivery-row-heading">
                <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {t("delivery.gate.feedbackSource")}
                </a>
                <WorkItemTag
                  kind="status"
                  value={f.outcome === "RESOLVED" ? "DONE" : "WAITING"}
                  stateKey={f.outcome === "RESOLVED" ? "DONE" : "WAITING"}
                  label={t(`delivery.gate.${f.outcome}`)}
                />
              </div>
              <p>{f.conclusion}</p>
            </li>
          ))}
        </ul>
      )}
      {report.completedAt && canManage && c && (
        <ReleaseFeedbackForm {...{ projectId, releaseId, report }} />
      )}
      {editing && (
        <ReleaseCandidateEditor
          {...{ projectId, releaseId }}
          current={c}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}
function ReleaseFeedbackForm({
  projectId,
  releaseId,
  report,
}: {
  projectId: string;
  releaseId: string;
  report: ReleaseGateView;
}) {
  const [open, setOpen] = useState(false),
    [form, setForm] = useState({
      workItemId: "",
      sourceUrl: "",
      conclusion: "",
      outcome: "FOLLOW_UP",
    }),
    qc = useQueryClient(),
    write = useTestingWrite();
  const save = useMutation({
    mutationFn: () =>
      write(
        `${deliveryEndpoint(projectId)}/releases/${releaseId}/feedback`,
        form,
      ),
    onSuccess: async () => {
      setForm({
        workItemId: "",
        sourceUrl: "",
        conclusion: "",
        outcome: "FOLLOW_UP",
      });
      setOpen(false);
      await qc.invalidateQueries({ queryKey: deliveryKey(projectId) });
    },
  });
  const draft=useSettingsDraft(open,form,save.isPending),close=()=>void draft.leave(()=>setOpen(false));
  return (
    <div className="release-feedback-form">
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("delivery.gate.feedback")}
      </Button>
      {open && (
        <Drawer open title={t('delivery.gate.feedback')} onClose={close} width="md">
        <div className="delivery-form">
          <Select
            label={t("delivery.gate.workItem")}
            ariaLabel={t("delivery.gate.workItem")}
            value={form.workItemId}
            onChange={(v) => setForm((f) => ({ ...f, workItemId: v }))}
            options={[
              { value: "", label: t("delivery.gate.chooseWorkItem") },
              ...(report.candidate?.workItems ?? []).map((w) => ({
                value: w.id,
                label: `${w.key} · ${w.title}`,
              })),
            ]}
          />
          <TextInput
            label={t("delivery.gate.feedbackSource")}
            value={form.sourceUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, sourceUrl: e.target.value }))
            }
          />
          <TextArea
            label={t("delivery.gate.conclusion")}
            value={form.conclusion}
            onChange={(e) =>
              setForm((f) => ({ ...f, conclusion: e.target.value }))
            }
          />
          <Select
            label={t("delivery.gate.outcome")}
            ariaLabel={t("delivery.gate.outcome")}
            value={form.outcome}
            onChange={(v) => setForm((f) => ({ ...f, outcome: v }))}
            options={["FOLLOW_UP", "RESOLVED"].map((value) => ({
              value,
              label: t(`delivery.gate.${value}`),
            }))}
          />
          {save.isError && (
            <p role="alert" className="field-error">
              {save.error.message}
            </p>
          )}
          <Button
            disabled={
              !releaseFeedbackSchema.safeParse(form).success || save.isPending
            }
            onClick={() => save.mutate()}
          >
            {t("common.save")}
          </Button>
        </div>
        </Drawer>
      )}
      {draft.guard}
    </div>
  );
}
