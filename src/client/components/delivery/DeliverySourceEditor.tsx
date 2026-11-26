import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  configureDeliverySourceSchema,
  type DeliverySourceView,
} from "../../../shared/schemas/delivery.ts";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { Select } from "../Select.tsx";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { useTestingWrite } from "../testing/useTestingWrite.ts";
import { deliveryEndpoint, deliveryKey } from "./delivery-ui.tsx";

export function DeliverySourceEditor({
  projectId,
  integrationId,
  onClose,
}: {
  projectId: string;
  integrationId: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: [...deliveryKey(projectId), "sources"],
    queryFn: () =>
      apiGet<DeliverySourceView[]>(deliveryEndpoint(projectId) + "/sources"),
    retry: false,
  });
  const [restoredId, setRestoredId] = useState("");
  const current = query.data?.find((s) => s.integrationId === integrationId);
  const restored = query.data?.filter((s) => !s.integrationId) ?? [];
  const source = current ?? restored.find((s) => s.id === restoredId);
  return query.isSuccess ? (
    <SourceForm
      key={source?.id ?? "new"}
      {...{ projectId, integrationId, onClose, source }}
      restoreChoice={(leave) =>
        !current && !!restored.length ? (
          <Select
            label={t("delivery.source.restore")}
            ariaLabel={t("delivery.source.restore")}
            value={restoredId}
            onChange={(id) => void leave(() => setRestoredId(id))}
            options={[
              { value: "", label: t("delivery.source.create") },
              ...restored.map((s) => ({
                value: s.id,
                label: `${s.repository} · v${s.version}`,
              })),
            ]}
          />
        ) : null
      }
    />
  ) : (
    <Drawer open title={t("delivery.source.title")} onClose={onClose}>
      <StateBlock
        kind={query.isError ? "error" : "loading"}
        title={t(query.isError ? "common.loadFailedShort" : "common.loading")}
        action={query.isError ? () => void query.refetch() : undefined}
        actionLabel={t("common.reload")}
      />
    </Drawer>
  );
}
function SourceForm({
  projectId,
  integrationId,
  onClose,
  source: serverSource,
  restoreChoice,
}: {
  projectId: string;
  integrationId: string;
  onClose: () => void;
  source?: DeliverySourceView;
  restoreChoice: (
    leave: (close: () => void) => Promise<void>,
  ) => React.ReactNode;
}) {
  const [source] = useState(serverSource);
  const [secret, setSecret] = useState(""),
    [enabled, setEnabled] = useState(source?.enabled ?? true),
    qc = useQueryClient(),
    write = useTestingWrite();
  const body = {
    integrationId,
    sourceId: source?.id,
    expectedVersion: source?.version ?? 0,
    enabled,
    ...(secret ? { webhookSecret: secret } : {}),
  };
  const valid =
    configureDeliverySourceSchema.safeParse(body).success &&
    (!enabled || source?.hasWebhookSecret || secret.length >= 24);
  const save = useMutation({
    mutationFn: () =>
      write<DeliverySourceView>(deliveryEndpoint(projectId) + "/sources", body),
    onSuccess: async () => {
      setSecret("");
      await qc.invalidateQueries({ queryKey: deliveryKey(projectId) });
      onClose();
    },
  });
  const draft = useSettingsDraft(true, { secret, enabled }, save.isPending);
  const close = () => void draft.leave(onClose);
  return (
    <Drawer
      open
      title={t("delivery.source.title")}
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
            {t("delivery.source.save")}
          </Button>
        </>
      }
    >
      <div className="delivery-form">
        <p className="muted">{t("delivery.source.hint")}</p>
        {source && (
          <div className="delivery-tags">
            <WorkItemTag
              kind="status"
              value={source.configCurrent ? "DONE" : "WAITING"}
              stateKey={source.configCurrent ? "ACTIVE" : "WAITING"}
              label={t(
                source.configCurrent
                  ? "delivery.source.active"
                  : "delivery.source.inactive",
              )}
            />
            <span className="mono">
              {source.repository} · v{source.version}
            </span>
          </div>
        )}
        {restoreChoice(draft.leave)}
        <TextInput
          label={t("delivery.source.secret")}
          type="password"
          autoComplete="new-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          hint={t(
            source?.hasWebhookSecret
              ? "delivery.source.keepSecret"
              : "delivery.source.newSecret",
          )}
        />
        <Checkbox
          checked={enabled}
          onChange={setEnabled}
          label={t("delivery.source.enable")}
        />
        {source && (
          <TextInput
            label={t("delivery.source.callback")}
            readOnly
            value={`${window.location.origin}/api/v1/delivery/hooks/github/${source.id}`}
            hint={t("delivery.source.events")}
          />
        )}
        {save.isError && (
          <p className="field-error" role="alert">
            {save.error.message}
          </p>
        )}
      </div>
      {draft.guard}
    </Drawer>
  );
}
