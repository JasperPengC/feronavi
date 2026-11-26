import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createReleaseCandidateSchema,
  type ReleaseCandidateView,
} from "../../../shared/schemas/release-gate.ts";
import type { DeliverySourceView } from "../../../shared/schemas/delivery.ts";
import type { TestPlanPage } from "../../../shared/schemas/test-execution.ts";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { Select } from "../Select.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { useTestingWrite } from "../testing/useTestingWrite.ts";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { deliveryEndpoint, deliveryKey } from "./delivery-ui.tsx";

export function ReleaseCandidateEditor({
  projectId,
  releaseId,
  current: incoming,
  onClose,
}: {
  projectId: string;
  releaseId: string;
  current: ReleaseCandidateView | null;
  onClose: () => void;
}) {
  const [current] = useState(incoming);
  const qc = useQueryClient(),
    write = useTestingWrite();
  const [form, setForm] = useState({
    sourceId: current?.sourceId ?? "",
    commitSha: current?.commitSha ?? "",
    build: current?.build ?? "",
    environment: current?.environment ?? "",
    workflows: current?.workflowIds.join(", ") ?? "",
    testPlanIds: current?.testPlanIds ?? [],
  });
  const sources = useQuery({
    queryKey: [...deliveryKey(projectId), "sources"],
    queryFn: () =>
      apiGet<DeliverySourceView[]>(deliveryEndpoint(projectId) + "/sources"),
    retry: false,
  });
  const plans = useInfiniteQuery({
    queryKey: ["release-test-plans", projectId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<TestPlanPage>(`/api/v1/projects/${projectId}/testing/plans`, {
        limit: 50,
        before: pageParam,
      }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const body = {
    sourceId: form.sourceId,
    commitSha: form.commitSha,
    build: form.build,
    environment: form.environment,
    workflowIds: form.workflows
      .split(/[,，\s]+/u)
      .filter(Boolean)
      .map(Number),
    testPlanIds: form.testPlanIds,
    expectedCandidateNumber: current?.number ?? 0,
  };
  const valid = createReleaseCandidateSchema.safeParse(body).success;
  const save = useMutation({
    mutationFn: () =>
      write<ReleaseCandidateView>(
        `${deliveryEndpoint(projectId)}/releases/${releaseId}/candidates`,
        body,
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: deliveryKey(projectId) });
      onClose();
    },
  });
  const draft = useSettingsDraft(true, form, save.isPending),
    close = () => void draft.leave(onClose);
  const change = (
    key: "sourceId" | "commitSha" | "build" | "environment" | "workflows",
    value: string,
  ) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "commitSha" && (!f.build || f.build === f.commitSha)
        ? { build: value }
        : {}),
    }));
  return (
    <Drawer
      open
      title={t("delivery.gate.create")}
      onClose={close}
      width="md"
      footer={
        <>
          <Button disabled={save.isPending} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {t("delivery.gate.freeze")}
          </Button>
        </>
      }
    >
      <div className="delivery-form">
        <p className="muted">{t("delivery.gate.freezeHint")}</p>
        <Select
          label={t("delivery.source.title")}
          ariaLabel={t("delivery.source.title")}
          value={form.sourceId}
          onChange={(v) => change("sourceId", v)}
          options={[
            { value: "", label: t("delivery.gate.chooseSource") },
            ...(sources.data ?? []).map((s) => ({
              value: s.id,
              label: `${s.repository} · v${s.version}${s.configCurrent ? "" : " · " + t("delivery.source.inactive")}`,
            })),
          ]}
        />
        {sources.isSuccess && !sources.data.length && (
          <p className="muted">{t("delivery.gate.noSource")}</p>
        )}
        <TextInput
          label={t("delivery.sha")}
          value={form.commitSha}
          onChange={(e) => change("commitSha", e.target.value)}
          className="mono"
        />
        <div className="delivery-form-pair">
          <TextInput
            label={t("delivery.build")}
            value={form.build}
            onChange={(e) => change("build", e.target.value)}
            hint={t("delivery.gate.buildHint")}
          />
          <TextInput
            label={t("delivery.gate.environment")}
            value={form.environment}
            onChange={(e) => change("environment", e.target.value)}
          />
        </div>
        <TextInput
          label={t("delivery.gate.workflows")}
          value={form.workflows}
          onChange={(e) => change("workflows", e.target.value)}
          hint={t("delivery.gate.workflowHint")}
        />
        <fieldset className="release-test-options">
          <legend>{t("delivery.gate.plans")}</legend>
          {plans.data?.pages
            .flatMap((p) => p.items)
            .map((p) => (
              <div key={p.id}>
                <Checkbox
                  checked={form.testPlanIds.includes(p.id)}
                  onChange={(checked) =>
                    setForm((f) => ({
                      ...f,
                      testPlanIds: checked
                        ? [...f.testPlanIds, p.id]
                        : f.testPlanIds.filter((id) => id !== p.id),
                    }))
                  }
                  label={`${p.key} · ${p.title}`}
                />
                <WorkItemTag
                  kind="status"
                  value={
                    p.status === "COMPLETED"
                      ? "DONE"
                      : p.status === "RUNNING"
                        ? "IN_PROGRESS"
                        : p.status
                  }
                  stateKey={p.status}
                  label={t(`testing.state.${p.status}`)}
                />
                <span className="muted">
                  {p.build} · {p.environment}
                </span>
              </div>
            ))}
          {plans.hasNextPage && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void plans.fetchNextPage()}
            >
              {t("delivery.more")}
            </Button>
          )}
        </fieldset>
        {(sources.isError || plans.isError) && (
          <p role="alert" className="field-error">
            {t("common.loadFailedShort")}{" "}
            <Button
              size="sm"
              onClick={() => {
                void sources.refetch();
                void plans.refetch();
              }}
            >
              {t("common.reload")}
            </Button>
          </p>
        )}
        {save.isError && (
          <p role="alert" className="field-error">
            {save.error.message}
          </p>
        )}
      </div>
      {draft.guard}
    </Drawer>
  );
}
