/**
 * AI 供应商配置：LLM 与 Embedding 完全分开。
 *
 * 交互：卡片内只展示“已配置供应商”；新增/编辑都走 Modal，避免页面里同时出现空白表单和配置列表，
 * 也避免用户看不出已有供应商可以改。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Select } from "../Select.tsx";
import { Button } from "../ui/Button.tsx";
import { confirmDialog } from "../Dialog.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Modal } from "../ui/Modal.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";
import { settingsCopy } from "./copy.ts";
import { Icon } from "../Icon.tsx";
import { useSettingsDraft } from "./SettingsDraft.tsx";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";

type Purpose = "LLM" | "EMBEDDING";
type AiProvider = {
  id: string; provider: string; baseUrl: string; model: string; embeddingModel: string;
  purpose: "BOTH" | Purpose; note: string | null; hasApiKey: boolean;
  isDefault: boolean; isActive: boolean;
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestError: string | null;
};
type AiForm = { provider: string; baseUrl: string; model: string; apiKey: string; note: string };
const EMPTY_FORM: AiForm = { provider: "OPENAI_COMPAT", baseUrl: "", model: "", apiKey: "", note: "" };

function ProviderPanel({
  purpose, providers, onSuccess, onError,
}: FeedbackHandlers & { purpose: Purpose; providers: AiProvider[] }) {
  const locale = useLocale();
  const qc = useQueryClient();
  const isLlm = purpose === "LLM";
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [form, setForm] = useState<AiForm>(EMPTY_FORM);
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const related = providers.filter((p) => p.purpose === purpose || p.purpose === "BOTH");
  const canSave = Boolean(form.baseUrl.trim()) && Boolean(form.model.trim())
    && (form.provider === "OLLAMA" || Boolean(form.apiKey) || Boolean(editing?.hasApiKey));

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["ai-providers"] });
    await qc.invalidateQueries({ queryKey: ["ai-status"] });
  };

  const closeForm = () => {
    setFormOpen(false); setFormError(null);
    setEditing(null);
    setForm(EMPTY_FORM);
    setModels([]);
  };
  const startCreate = () => {
    setFormError(null);
    setEditing(null);
    setForm(EMPTY_FORM);
    setModels([]);
    setFormOpen(true);
  };
  const startEdit = (provider: AiProvider) => {
    setFormError(null);
    setEditing(provider);
    setForm({
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      model: isLlm ? provider.model : provider.embeddingModel,
      apiKey: "",
      note: provider.note ?? "",
    });
    setModels([]);
    setFormOpen(true);
  };

  const save = useMutation({
    mutationFn: () => editing
      ? apiPatch(`/api/v1/ai/providers/${editing.id}`, {
          baseUrl: form.baseUrl,
          model: form.model,
          embeddingModel: form.model,
          note: form.note.trim() || null,
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        })
      : apiPost("/api/v1/ai/providers", {
          provider: form.provider,
          baseUrl: form.baseUrl,
          model: form.model,
          embeddingModel: form.model,
          purpose,
          note: form.note.trim() || null,
          apiKey: form.apiKey || null,
        }),
    onSuccess: async () => {
      onSuccess(t(editing ? "se.providerUpdated" : "se.providerSaved"));
      closeForm();
      await invalidate();
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("se.providerSaveFailed")),
  });

  const draft = useSettingsDraft(formOpen, form, save.isPending || modelsBusy);
  const requestClose = () => void draft.leave(closeForm);

  const fetchModels = async () => {
    setModelsBusy(true);
    try {
      // 编辑时密钥不回显：优先用后端保存的密钥；只有用户输入了新 key 才走临时探测
      const r = editing && !form.apiKey
        ? await apiPost<{ models: string[] }>(`/api/v1/ai/providers/${editing.id}/models`, { baseUrl: form.baseUrl })
        : await apiPost<{ models: string[] }>("/api/v1/ai/models", {
            provider: form.provider, baseUrl: form.baseUrl, apiKey: form.apiKey || null,
          });
      setModels(r.models);
      setForm((f) => ({ ...f, model: r.models.includes(f.model) ? f.model : (r.models[0] ?? f.model) }));
      onSuccess(t("se.modelsFetched", { n: String(r.models.length) }));
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t("se.modelsFetchFailed"));
    } finally { setModelsBusy(false); }
  };

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try { await fn(); onSuccess(ok); }
    catch (e) { onError(e instanceof ApiError ? e.message : t("se.providerSaveFailed")); }
    finally { setBusyId(null); await invalidate(); }
  };
  const test = async (p: AiProvider) => {
    setBusyId(p.id);
    try {
      const r = await apiPost<{ ok: boolean; latencyMs?: number; error?: string }>(`/api/v1/ai/providers/${p.id}/test`, {});
      if (r.ok) onSuccess(t("se.aiTestOk")); else onError(r.error ?? t("se.aiTestFailed"));
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("se.aiTestFailed"));
    } finally { setBusyId(null); await invalidate(); }
  };

  const set = <K extends keyof AiForm>(key: K, value: AiForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const modelFieldLabel = isLlm ? t("set.aiModel") : t("set.aiEmbedding");
  const modelFieldAria = isLlm ? "LLM model" : "Embedding model";
  const providerModel = (p: AiProvider) => isLlm ? p.model : p.embeddingModel;

  return (
    <SettingsSection className="ai-provider-card" title={isLlm ? t("se.llmProviderTitle") : t("se.embeddingProviderTitle")}
      description={isLlm ? t("se.llmProviderHint") : t("se.embeddingProviderHint")}
      actions={<div className="ai-card-actions">
        <span className={`ai-provider-badge${isLlm ? "" : " is-embedding"}`}>{isLlm ? "LLM" : "Embedding"}</span>
        <Button size="sm" variant="primary" onClick={startCreate}><Icon name="plus" size={14} />{t("se.addProvider")}</Button>
      </div>}>
      {related.length === 0 && (
        <div className="ai-provider-empty">
          <Icon name="key" size={15} />
          <span>{settingsCopy(locale, "providerEmpty")}</span>
        </div>
      )}
      {related.length > 0 && (
        <ul className="ai-provider-list">
          {related.map((p) => (
            <li key={p.id} className="ai-provider-row">
              <div className="ai-provider-row-main">
                <div className="ai-provider-row-title">
                  <strong>{p.note || providerModel(p)}</strong>
                  {p.isDefault && <WorkItemTag kind="status" value="IN_PROGRESS" label={t("se.aiDefault")} />}
                  {!p.isActive && <WorkItemTag kind="status" value="INITIAL" label={t("se.aiDisabled")} />}
                </div>
                <div className="ai-provider-row-meta">
                  <span>{p.provider}</span>
                  <span>·</span>
                  <span>{providerModel(p)}</span>
                  <WorkItemTag kind="status" value={p.hasApiKey ? "DONE" : "INITIAL"} label={p.hasApiKey ? t("se.hasKey") : t("se.noKey")} />
                </div>
                <div className="ai-provider-row-url mono" title={p.baseUrl}>{p.baseUrl}</div>
                {p.lastTestAt && p.lastTestOk === false && <div className="ai-provider-row-error">{p.lastTestError}</div>}
              </div>
              <div className="ai-provider-row-actions">
                <Button size="sm" onClick={() => startEdit(p)}>{t("common.edit")}</Button>
                <Button size="sm" disabled={busyId === p.id} onClick={() => void test(p)}>{t("se.aiTest")}</Button>
                {!p.isDefault && <Button size="sm" disabled={busyId === p.id || !p.isActive}
                  onClick={() => void run(p.id, () => apiPost(`/api/v1/ai/providers/${p.id}/default`, {}), t("se.aiDefaultSet"))}>{t("se.aiSetDefault")}</Button>}
                <Button size="sm" disabled={busyId === p.id}
                  onClick={() => void run(p.id, () => apiPatch(`/api/v1/ai/providers/${p.id}`, { isActive: !p.isActive }), p.isActive ? t("se.aiDisabled") : t("se.aiEnabled"))}>
                  {p.isActive ? t("se.aiDisable") : t("se.aiEnable")}
                </Button>
                <Button size="sm" variant="danger" disabled={busyId === p.id}
                  onClick={async () => { if (await confirmDialog(`${t("common.confirmDelete")} ${p.note || providerModel(p)}`, { danger: true })) void run(p.id, () => apiDelete(`/api/v1/ai/providers/${p.id}`), t("se.aiDeleted")); }}>{t("common.delete")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft.guard}
      <Modal open={formOpen} width="lg" title={editing ? t("se.editProvider") : t("se.addProvider")} onClose={requestClose}
        footer={<>
          <Button onClick={requestClose} disabled={save.isPending || modelsBusy}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!canSave || save.isPending}
            onClick={() => save.mutate()}>{t("se.saveProvider")}</Button>
        </>}>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <fieldset disabled={save.isPending} className="settings-form-fields">
        <div className="settings-fields settings-fields--two ai-provider-form">
          <Select className="settings-field" label={t("set.aiProviderLabel")} value={form.provider}
            ariaLabel={t("set.aiProviderLabel")} disabled={Boolean(editing)}
            onChange={(v) => { setModels([]); set("provider", v); }}
            options={[{ value: "OPENAI_COMPAT", label: t("se.openaiCompat") }, { value: "OLLAMA", label: t("se.ollama") }]} />
          <TextInput className="settings-field" label={t("set.aiBaseUrl")}
            aria-label={isLlm ? "LLM Base URL" : "Embedding Base URL"} type="url"
            placeholder={t("set.aiBaseUrl")} value={form.baseUrl} onChange={(e) => { setModels([]); set("baseUrl", e.target.value); }} />
          {models.length > 0 ? (
            <Select className="settings-field" label={modelFieldLabel} ariaLabel={modelFieldAria} value={form.model}
              placeholder={t("se.modelSelect")} onChange={(value) => set("model", value)}
              options={models.map((model) => ({ value: model, label: model }))} />
          ) : (
            <TextInput className="settings-field" label={modelFieldLabel} aria-label={modelFieldAria}
              placeholder={t("se.modelFetchFirst")} value={form.model} onChange={(e) => set("model", e.target.value)} />
          )}
          <TextInput className="settings-field" label={t("set.aiApiKey")} type="password" autoComplete="new-password"
            aria-label={isLlm ? "LLM API Key" : "Embedding API Key"}
            placeholder={editing?.hasApiKey ? t("se.apiKeyKeep") : t("set.aiApiKey")}
            value={form.apiKey} onChange={(e) => set("apiKey", e.target.value)} />
          <TextInput className="settings-field settings-field--span-two" label={t("se.providerNote")}
            placeholder={t("se.providerNoteHint")} maxLength={200}
            value={form.note} onChange={(e) => set("note", e.target.value)} />
        </div>
        <div className="ai-modal-tools">
          <span className="muted">{editing ? t("se.editProviderHint") : t("se.addProviderHint")}</span>
          <Button size="sm" loading={modelsBusy}
            disabled={!form.baseUrl.trim() || modelsBusy || (form.provider !== "OLLAMA" && !form.apiKey && !editing)}
            onClick={() => void fetchModels()}>{t("se.fetchModels")}</Button>
        </div>
        </fieldset>
      </Modal>
    </SettingsSection>
  );
}

export function AiSettings({ onSuccess, onError }: FeedbackHandlers) {
  const locale = useLocale();
  const status = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => apiGet<{ configured: boolean; dimensionOk?: boolean; model?: string; dimensions?: number; embeddingModel?: string; chatModel?: string; message?: string }>("/api/v1/knowledge/ai-status"),
  });
  const providers = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => apiGet<{ providers: AiProvider[] }>("/api/v1/ai/providers"),
    retry: false,
  });
  const usage = useQuery({
    queryKey: ["ai-usage"],
    queryFn: () => apiGet<{ usage: { period: string; embeddingTokens: number; embeddingCalls: number; queryCount: number; limitTokens: number | null; exceeded: boolean }[] }>("/api/v1/ai/usage"),
    retry: false,
  });
  const month = usage.data?.usage.find((item) => item.period === "MONTH");
  const chatOnly = Boolean(status.data?.chatModel) && !status.data?.embeddingModel;
  const embeddingOnly = Boolean(status.data?.embeddingModel) && !status.data?.chatModel;
  const statusTitle = status.isLoading ? t("common.loading") : status.isError ? t("common.loadFailedShort") : status.data?.configured
    ? chatOnly ? t("se.chatConfiguredOnly") : embeddingOnly ? t("se.embeddingConfiguredOnly") : t("se.aiConfigured")
    : t("se.aiNotConfigured");
  const statusText = status.isLoading ? t("common.loading")
    : status.isError ? t("common.loadFailedShort")
    : status.data?.configured
      ? chatOnly
        ? t("se.chatOnlyHint", { model: status.data.chatModel ?? "" })
        : embeddingOnly
          ? t("se.embeddingOnlyHint", { model: status.data.embeddingModel ?? "" })
          : t("se.bothHint", { chat: status.data.chatModel ?? "", embedding: status.data.embeddingModel ?? "" })
      : (status.data?.message ?? t("se.aiDegraded"));

  return (
    <div className="ai-settings">
      <div className={`ai-status-banner${status.data?.configured ? " is-ok" : ""}`} role="status">
        <span className="ai-status-icon" aria-hidden="true"><Icon name={status.data?.configured ? "check" : "activity"} size={16} /></span>
        <div>
          <strong>{statusTitle}</strong>
          <p>{statusText}</p>
        </div>
        {month && <span className="muted ai-usage-chip">{settingsCopy(locale, "monthUsage", { tokens: month.embeddingTokens, calls: month.embeddingCalls, queries: month.queryCount })}</span>}
      </div>
      {status.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void status.refetch()}>{t("common.reload")}</Button>}>{t("common.loadFailedShort")}</SettingsListState>}
      {providers.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {providers.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void providers.refetch()}>{t("common.reload")}</Button>}>{t("common.loadFailedShort")}</SettingsListState>}
      {providers.data && <div className="ai-provider-grid">
        <ProviderPanel purpose="LLM" providers={providers.data?.providers ?? []} onSuccess={onSuccess} onError={onError} />
        <ProviderPanel purpose="EMBEDDING" providers={providers.data?.providers ?? []} onSuccess={onSuccess} onError={onError} />
      </div>}
      {usage.isError && <p className="settings-inline-state settings-inline-state--error" role="alert">{settingsCopy(locale, "usageLoadFailed")}</p>}
    </div>
  );
}
