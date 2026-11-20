import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { confirmDialog } from "../Dialog.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";
import { settingsCopy } from "./copy.ts";
import { Icon } from "../Icon.tsx";

type WebhookEndpoint = { id: string; name: string; url: string; events: string[]; isActive: boolean };
type DeliveryRow = {
  id: string; event: string; status: "PENDING" | "RETRYING" | "SUCCEEDED" | "DEAD";
  attempts: number; responseCode: number | null; error: string | null; createdAt: string; nextRetryAt: string | null;
};
type WebhookForm = { name: string; url: string; events: string };

const INITIAL_FORM: WebhookForm = { name: "", url: "", events: "work_item.created" };

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function WebhookSettings({ onSuccess, onError, compact = false }: FeedbackHandlers & { compact?: boolean }) {
  const locale = useLocale();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["webhooks"],
    queryFn: () => apiGet<{ endpoints: WebhookEndpoint[] }>("/api/v1/webhooks"),
    retry: false,
  });
  const [form, setForm] = useState<WebhookForm>(INITIAL_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const formId = useId();
  const [secret, setSecret] = useState<string | null>(null);
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", openDeliveries],
    queryFn: () => apiGet<{ deliveries: DeliveryRow[] }>(`/api/v1/webhooks/${openDeliveries}/deliveries`),
    enabled: !!openDeliveries,
    retry: false,
  });
  const replay = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/webhook-deliveries/${id}/replay`),
    onSuccess: async () => {
      onSuccess(t("se.replayOk"));
      await qc.invalidateQueries({ queryKey: ["webhook-deliveries", openDeliveries] });
    },
    onError: (error) => onError(error instanceof ApiError ? error.message : t("se.replayFailed")),
  });
  const create = useMutation({
    mutationFn: () => apiPost<{ endpoint: { id: string }; secret: string }>("/api/v1/webhooks", {
      ...form,
      events: form.events.split(",").map((value) => value.trim()).filter(Boolean),
    }),
    onSuccess: async (result) => {
      setSecret(result.secret);
      setForm(INITIAL_FORM); draft.markSaved(INITIAL_FORM);
      setFormOpen(false);
      setFormError(null);
      onSuccess(t("se.webhookCreated"));
      await qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : t("se.webhookCreateFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/webhooks/${id}`),
    onSuccess: async () => {
      onSuccess(settingsCopy(locale, "webhookDeleted"));
      await qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (error) => onError(error instanceof ApiError ? error.message : settingsCopy(locale, "webhookDeleteFailed")),
  });
  const set = <K extends keyof WebhookForm>(key: K, value: WebhookForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const draft = useSettingsDraft(formOpen, form, create.isPending);
  const requestClose = () => void draft.leave(() => {
    setFormOpen(false);
    setForm(INITIAL_FORM);
    setFormError(null);
  });
  const canCreate = !!form.name.trim() && !!form.url.trim()
    && form.events.split(",").some(value => value.trim()) && !create.isPending;
  return (
    <SettingsSection variant={compact ? "row" : "card"} leading={compact && <Icon name="send" size={18} />}
      title={compact ? "Webhook" : t("set.webhook")} description={compact ? t("se.messagingWebhookDesc") : t("se.whSign")}
      status={compact && list.data?.endpoints.length === 0 ? t("se.messagingUnconfigured") : undefined}
      actions={<Button size="sm" variant={compact ? "ghost" : "primary"} aria-label={compact ? `${t("common.add")} Webhook` : t("se.newWebhook")} aria-haspopup="dialog"
        onClick={() => setFormOpen(true)}><Icon name="plus" size={14} />{compact ? t("common.add") : t("se.newWebhook")}</Button>}>
      {secret && <div className="alert alert-info" role="status">{t("se.signSecret")}<code className="mono settings-secret">{secret}</code></div>}
      {draft.guard}
      {list.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {list.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>}>{settingsCopy(locale, "webhookLoadFailed")}</SettingsListState>}
      {!compact && list.data && list.data.endpoints.length === 0 && <SettingsListState>{t("se.noWebhooks")}</SettingsListState>}
      {!!list.data?.endpoints.length && (
        <ul className="settings-record-list">
          {list.data.endpoints.map((endpoint) => (
            <li key={endpoint.id}>
              <span className="settings-record-main">
                <strong>{endpoint.name}</strong>
                <span className="mono settings-record-detail">{endpoint.url}</span>
                <span className="settings-record-detail">{endpoint.events.join(", ")}</span>
              </span>
              <span className={endpoint.isActive ? "tag tag-success" : "tag"}>{endpoint.isActive ? t("se.enabled") : t("se.disabled3")}</span>
              <Button size="sm" variant="ghost" onClick={() => setOpenDeliveries(openDeliveries === endpoint.id ? null : endpoint.id)}>
                {t("se.webhookDeliveries")}
              </Button>
              <Button size="sm" variant="danger" disabled={remove.isPending} onClick={async () => { if (await confirmDialog(`${t("common.confirmDelete")} ${endpoint.name}`, { danger: true })) remove.mutate(endpoint.id); }}>{t("common.delete")}</Button>
              {openDeliveries === endpoint.id && (
                <div className="settings-deliveries" role="region" aria-label={t("se.webhookDeliveries")}>
                  {deliveries.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
                  {deliveries.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void deliveries.refetch()}>{t("common.reload")}</Button>}>{t("se.deliveryLoadFailed")}</SettingsListState>}
                  {deliveries.data && deliveries.data.deliveries.length === 0 && <SettingsListState>{t("se.deliveryEmpty")}</SettingsListState>}
                  {!!deliveries.data?.deliveries.length && (
                    <ul className="settings-delivery-list">
                      {deliveries.data.deliveries.map((d) => (
                        <li key={d.id}>
                          <span className={d.status === "SUCCEEDED" ? "tag tag-success" : d.status === "DEAD" ? "tag tag-danger" : "tag tag-warning"}>
                            {t(`se.ds${d.status}`)}
                          </span>
                          <code className="mono settings-record-detail">{d.event}</code>
                          <span className="settings-record-detail">{t("se.deliveryAttempt", { n: String(d.attempts) })}</span>
                          <span className="settings-record-detail" title={d.error ?? undefined}>{d.responseCode ? t("se.deliveryResponse", { code: String(d.responseCode) }) : "—"}</span>
                          <span className="settings-record-detail muted">{new Date(d.createdAt).toLocaleString()}</span>
                          {d.status === "DEAD" && (
                            <Button size="sm" variant="ghost" disabled={replay.isPending} onClick={() => replay.mutate(d.id)}>{t("se.replay")}</Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={formOpen} title={t("se.newWebhook")} onClose={requestClose}
        footer={<>
          <Button disabled={create.isPending} onClick={requestClose}>{t("common.cancel")}</Button>
          <Button form={formId} type="submit" variant="primary" disabled={!canCreate} loading={create.isPending}>{t("common.create")}</Button>
        </>}>
      <form id={formId} aria-label={t("se.newWebhook")}
        onSubmit={event => { event.preventDefault(); if (canCreate) { setFormError(null); create.mutate(); } }}>
        <p className="settings-webhook-help">{t("se.whSign")}</p>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <fieldset disabled={create.isPending} className="settings-form-fields">
        <div className="settings-fields settings-fields--two">
        <TextInput className="settings-field" label={t("set.webhookName")} placeholder={t("set.webhookName")} required
          value={form.name} aria-label={t("set.webhookNameLabel")} onChange={(event) => set("name", event.target.value)} />
        <TextInput className="settings-field" label={t("set.webhookEvents")} placeholder={t("set.webhookEvents")} required
          value={form.events} aria-label={t("set.webhookEventsLabel")} onChange={(event) => set("events", event.target.value)} />
        <TextInput className="settings-field settings-field--span-two" label={t("set.webhookUrlLabel")} type="url"
          placeholder="https://example.com/hook" value={form.url} aria-label={t("set.webhookUrlLabel")} required
          onChange={(event) => set("url", event.target.value)} />
        </div>
        </fieldset>
      </form>
      </Modal>
    </SettingsSection>
  );
}
