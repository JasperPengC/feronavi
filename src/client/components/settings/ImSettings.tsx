/**
 * IM 集成设置（Round 76 · 钉钉/企微/飞书）
 *
 * 群机器人 webhook 首期落地；应用凭据可保存但应用消息 API 未实现（无 webhook 的渠道测试会明确失败）。
 * 列表永不回显明文凭据；测试/发送结果与最近错误可见。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { confirmDialog } from "../Dialog.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Select } from "../Select.tsx";
import { Icon } from "../Icon.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";
import { CATEGORIES } from "./types.ts";
import { Modal } from "../ui/Modal.tsx";
import { toast } from "../ui/Toast.tsx";

type Provider = "DINGTALK" | "WECOM" | "FEISHU";
interface ImChannel {
  id: string; name: string; provider: Provider; providerLabel: string; enabled: boolean;
  events: string[]; hasWebhook: boolean; hasCredentials: boolean; hasRecipients: boolean; recipientCount: number;
  corpId: string | null; agentId: string | null;
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestError: string | null;
  lastSendAt: string | null; lastSendOk: boolean | null; lastSendError: string | null;
}
const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "DINGTALK", label: "钉钉" }, { value: "WECOM", label: "企业微信" }, { value: "FEISHU", label: "飞书" },
];

interface Form {
  provider: Provider; name: string; webhookUrl: string; appKey: string; appSecret: string;
  corpId: string; agentId: string; recipients: string; events: string[]; enabled: boolean;
}
const EMPTY: Form = { provider: "FEISHU", name: "", webhookUrl: "", appKey: "", appSecret: "", corpId: "", agentId: "", recipients: "", events: [], enabled: true };

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function ImSettings({ onSuccess, onError, compact = false }: FeedbackHandlers & { compact?: boolean }) {
  useLocale();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["im-channels"],
    queryFn: () => apiGet<{ channels: ImChannel[] }>("/api/v1/im/channels"),
    retry: false,
  });
  const [form, setForm] = useState<Form>(EMPTY);
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => apiPost("/api/v1/im/channels", {
      provider: form.provider, name: form.name.trim(),
      webhookUrl: form.webhookUrl.trim() || null,
      appKey: form.appKey.trim() || null, appSecret: form.appSecret.trim() || null,
      corpId: form.corpId.trim() || null, agentId: form.agentId.trim() || null,
      recipients: form.recipients.trim() || null,
      events: form.events, enabled: form.enabled,
    }),
    onSuccess: async () => {
      setForm(EMPTY);
      setCreateOpen(false);
      onSuccess(t("se.imCreated"));
      await qc.invalidateQueries({ queryKey: ["im-channels"] });
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("se.imCreateFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/im/channels/${id}`),
    onSuccess: async () => { onSuccess(t("se.imDeleted")); await qc.invalidateQueries({ queryKey: ["im-channels"] }); },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.imDeleteFailed")),
  });
  const toggle = useMutation({
    mutationFn: (channel: ImChannel) => apiPatch(`/api/v1/im/channels/${channel.id}`, { enabled: !channel.enabled }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["im-channels"] }); },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.imSaveFailed")),
  });
  const test = useMutation({
    mutationFn: (channel: ImChannel) => apiPost<{ ok: boolean; error?: string }>(`/api/v1/im/channels/${channel.id}/test`, {}),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["im-channels"] });
      if (result.ok) toast.success(t("se.imTestSent")); else toast.error(result.error ?? t("se.imTestFailed"));
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.imTestFailed")),
  });

  const draft = useSettingsDraft(createOpen, form, create.isPending);
  const requestClose = () => void draft.leave(() => { setCreateOpen(false); setForm(EMPTY); setFormError(null); });
  return (
    <SettingsSection variant={compact ? "row" : "card"} leading={compact && <Icon name="inbox" size={18} />}
      title={compact ? t("se.messagingImTitle") : t("set.im")} description={compact ? t("se.messagingImDesc") : t("se.imDesc")}
      status={compact && list.data?.channels.length === 0 ? t("se.messagingUnconfigured") : undefined}
      actions={<Button size="sm" variant={compact ? "ghost" : "primary"} aria-label={t("se.imAdd")} onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} />{compact ? t("common.add") : t("se.imAdd")}</Button>}>
      {list.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {list.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>}>{t("se.imLoadFailed")}</SettingsListState>}
      {!compact && list.data && list.data.channels.length === 0 && <SettingsListState>{t("se.imEmpty")}</SettingsListState>}
      {!!list.data?.channels.length && (
        <ul className="settings-record-list">
          {list.data.channels.map((channel) => (
            <li key={channel.id}>
              <span className="settings-record-main">
                <strong>{channel.providerLabel} · {channel.name}</strong>
                <span className="muted settings-record-detail">
                  {channel.hasWebhook ? t("se.imWebhookReady") : channel.hasRecipients ? `${t("se.imAppMode")} · ${channel.recipientCount} ${t("se.imRecipientsCount")}` : t("se.imWebhookMissing")}
                  {channel.events.length ? ` · ${channel.events.join(" / ")}` : ` · ${t("se.imAllEvents")}`}
                  {channel.lastTestAt ? ` · ${t("se.imLastTest")} ${channel.lastTestOk ? "✓" : "✗"}` : ""}
                </span>
                {channel.lastSendAt && channel.lastSendOk === false && (
                  <span className="settings-record-detail" style={{ color: "var(--danger)" }}>{t("se.imLastSendFailed")} {channel.lastSendError}</span>
                )}
              </span>
              <span className="settings-record-actions">
                <Button size="sm" disabled={test.isPending} onClick={() => test.mutate(channel)}>{t("se.imTest")}</Button>
                <Button size="sm" onClick={() => toggle.mutate(channel)}>{channel.enabled ? t("se.imDisable") : t("se.imEnable")}</Button>
                <Button size="sm" variant="danger" disabled={remove.isPending} onClick={async () => { if (await confirmDialog(`${t("common.confirmDelete")} ${channel.name}`, { danger: true })) remove.mutate(channel.id); }}>{t("common.delete")}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}


      {draft.guard}
      <Modal open={createOpen} width="xl" title={t("se.imAdd")} onClose={requestClose}
        footer={<>
          <Button onClick={requestClose} disabled={create.isPending}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!form.name.trim() || create.isPending} loading={create.isPending}
            onClick={() => create.mutate()}>{t("se.imAdd")}</Button>
        </>}>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <fieldset disabled={create.isPending} className="settings-form-fields">
        <div className="settings-fields settings-fields--two im-modal-grid">
          <Select label={t("se.imProvider")} ariaLabel={t("se.imProvider")} value={form.provider}
            onChange={(v) => setForm((f) => ({ ...f, provider: v as Provider }))} options={PROVIDERS} />
          <TextInput label={t("se.imName")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <TextInput className="settings-field--span-two" label={t("se.imWebhook")} value={form.webhookUrl}
            onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))} hint={t("se.imWebhookHint")} />
          <TextInput label={t("se.imAppKey")} value={form.appKey} onChange={(e) => setForm((f) => ({ ...f, appKey: e.target.value }))} />
          <TextInput label={t("se.imAppSecret")} value={form.appSecret} onChange={(e) => setForm((f) => ({ ...f, appSecret: e.target.value }))} />
          <p className="muted im-modal-note settings-field--span-two">{t("se.imAppHint")}</p>
          <TextInput label={t("se.imCorpId")} value={form.corpId} onChange={(e) => setForm((f) => ({ ...f, corpId: e.target.value }))} />
          <TextInput label={t("se.imAgentId")} value={form.agentId} onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))} />
          <TextInput className="settings-field--span-two" label={t("se.imRecipients")} value={form.recipients}
            onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))} hint={t("se.imRecipientsHint")} />
          <div className="settings-field--span-two im-events-field">
            <span className="muted">{t("se.imEvents")}</span>
            <div className="im-events-options">
              {CATEGORIES.map(([category, labelKey]) => (
                <Checkbox key={category} size="sm" label={t(labelKey)} checked={form.events.includes(category)}
                  onChange={(checked) => setForm((f) => ({ ...f, events: checked ? [...f.events, category] : f.events.filter((x) => x !== category) }))} />
              ))}
            </div>
            <span className="muted im-events-hint">{t("se.imEventsHint")}</span>
          </div>
        </div>
        </fieldset>
      </Modal>
    </SettingsSection>
  );
}
