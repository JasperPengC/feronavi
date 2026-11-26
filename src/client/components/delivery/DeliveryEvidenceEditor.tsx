import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { t } from "../../i18n/index.ts";
import {
  createDeliveryEvidenceSchema,
  deliverySha,
  deliveryUrl,
  type DeliveryEvidenceView,
} from "../../../shared/schemas/delivery.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { Field } from "../ui/Field.tsx";
import { Select } from "../Select.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { useTestingWrite } from "../testing/useTestingWrite.ts";
import { deliveryEndpoint } from "./delivery-ui.tsx";
export function DeliveryEvidenceEditor({
  projectId,
  workItemId,
  onClose,
  onSaved,
}: {
  projectId: string;
  workItemId: string;
  onClose: () => void;
  onSaved: (row: DeliveryEvidenceView) => Promise<void>;
}) {
  const id = useId(),
    busy = useRef(false),
    write = useTestingWrite();
  const [form, setForm] = useState({
    kind: "BUILD",
    title: "",
    repository: "",
    commitSha: "",
    build: "",
    environment: "",
    status: "SUCCEEDED",
    url: "",
    summary: "",
  });
  const body = {
    ...form,
    environment: form.environment || undefined,
    workItemIds: [workItemId],
  };
  const [touched, setTouched] = useState({ url: false, commitSha: false });
  const urlError = touched.url && !!form.url && !deliveryUrl.safeParse(form.url).success;
  const shaError = touched.commitSha && !!form.commitSha && !deliverySha.safeParse(form.commitSha).success;
  const valid = createDeliveryEvidenceSchema.safeParse(body).success;
  const save = useMutation({
    mutationFn: () =>
      write<DeliveryEvidenceView>(
        deliveryEndpoint(projectId) + "/evidence",
        body,
      ),
    onSuccess: async (row) => {
      await onSaved(row);
      onClose();
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const draft = useSettingsDraft(true, form, save.isPending);
  const change = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <Drawer
      open
      title={t("delivery.new")}
      onClose={() => void draft.leave(onClose)}
      width="md"
      className="delivery-editor"
      footer={
        <>
          <Button
            disabled={save.isPending}
            onClick={() => void draft.leave(onClose)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!valid || save.isPending}
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              save.mutate();
            }}
          >
            {t("delivery.save")}
          </Button>
        </>
      }
    >
      <p className="muted">{t("delivery.selfHint")}</p>
      <div className="delivery-form">
        <Field label={t("delivery.title")} htmlFor={id + "title"}>
          <TextInput
            id={id + "title"}
            maxLength={300}
            value={form.title}
            onChange={(e) => change("title", e.target.value)}
          />
        </Field>
        <div className="delivery-form-pair">
          <Field label={t("delivery.kind")}>
            <Select
              ariaLabel={t("delivery.kind")}
              value={form.kind}
              onChange={(v) => change("kind", v)}
              options={[
                "COMMIT",
                "PULL_REQUEST",
                "CI",
                "BUILD",
                "DEPLOYMENT",
              ].map((value) => ({ value, label: t(`delivery.kind.${value}`) }))}
            />
          </Field>
          <Field label={t("delivery.status")}>
            <Select
              ariaLabel={t("delivery.status")}
              value={form.status}
              onChange={(v) => change("status", v)}
              options={["PENDING", "SUCCEEDED", "FAILED", "CANCELLED"].map(
                (value) => ({ value, label: t(`delivery.status.${value}`) }),
              )}
            />
          </Field>
        </div>
        <Field
          label={t("delivery.repository")}
          htmlFor={id + "repository"}
          hint={t("delivery.repoHint")}
        >
          <TextInput
            id={id + "repository"}
            value={form.repository}
            onChange={(e) => change("repository", e.target.value)}
          />
        </Field>
        <Field
          label={t("delivery.sha")}
          htmlFor={id + "commitSha"}
          hint={t("delivery.shaHint")}
          error={shaError ? t("delivery.shaHint") : undefined}
          descId={id + "shaHelp"}
        >
          <TextInput
            id={id + "commitSha"}
            value={form.commitSha}
            onChange={(e) => change("commitSha", e.target.value)}
            onBlur={() => setTouched((v) => ({ ...v, commitSha: true }))}
            aria-invalid={shaError || undefined}
            aria-describedby={id + "shaHelp"}
            className="mono"
            maxLength={64}
          />
        </Field>
        <div className="delivery-form-pair">
          {(["build", "environment"] as const).map((key) => (
            <Field key={key} label={t(`delivery.${key}`)} htmlFor={id + key}>
              <TextInput
                id={id + key}
                value={form[key]}
                onChange={(e) => change(key, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <Field
          label={t("delivery.url")}
          htmlFor={id + "url"}
          hint={t("delivery.urlHint")}
          error={urlError ? t("delivery.urlHint") : undefined}
          descId={id + "urlHelp"}
        >
          <TextInput
            id={id + "url"}
            value={form.url}
            onChange={(e) => change("url", e.target.value)}
            onBlur={() => setTouched((v) => ({ ...v, url: true }))}
            aria-invalid={urlError || undefined}
            aria-describedby={id + "urlHelp"}
            type="url"
          />
        </Field>
        <Field label={t("delivery.summary")} htmlFor={id + "summary"}>
          <TextArea
            id={id + "summary"}
            rows={3}
            value={form.summary}
            onChange={(e) => change("summary", e.target.value)}
          />
        </Field>
      </div>
      {save.isError && (
        <p className="field-error" role="alert">
          {save.error.message}
        </p>
      )}
      {draft.guard}
    </Drawer>
  );
}
