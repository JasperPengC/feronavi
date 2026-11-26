/**
 * 外部集成管理（Round 25 长任务第 20 项）
 *
 * 后端（迁移 0030 / `integration.service.ts`）已具备完整能力；本组件是它的管理界面：
 *   · 列表：类型/名称/地址/范围/启停 + 令牌**只显示"已配置"**（接口从不回显令牌）；
 *   · 新建/编辑：服务地址会经过后端统一 SSRF 校验，失败原因原样展示（不吞错误）；
 *   · 删除：使用平台共享危险操作确认，避免误删生产集成。
 */
import { queryKeys } from "../../lib/query-keys.ts";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Select } from "../Select.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";
import { confirmDialog } from "../Dialog.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Icon } from "../Icon.tsx";
import { DeliverySourceEditor } from '../delivery/DeliverySourceEditor.tsx';

interface IntegrationRow {
  id: string; kind: string; projectId: string | null; name: string; baseUrl: string;
  isActive: boolean; hasToken: boolean; createdAt: string; config?: Record<string, unknown> | null;
}
interface ProjectRow { id: string; name: string; key: string }
interface FormState { kind: string; name: string; baseUrl: string; token: string; projectId: string; configText: string }

const KINDS = ["GITLAB", "GITHUB", "GITEE"];
const KIND_BASE_URL: Record<string, string> = {
  GITLAB: "https://gitlab.com",
  GITHUB: "https://api.github.com",
  GITEE: "https://gitee.com/api/v5",
};
const EMPTY_FORM: FormState = { kind: "GITLAB", name: "", baseUrl: "https://gitlab.com", token: "", projectId: "", configText: "{}" };
const KIND_HINT: Record<string, string> = {
  GITLAB: "GitLab：Private-Token，仓库 group/project，支持 commits / MR",
  GITHUB: "GitHub：Bearer Token，仓库 owner/repo，支持 commits / PR / reviews",
  GITEE: "Gitee：Bearer Token，仓库 owner/repo，支持 commits / PR",
};

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function IntegrationSettings({ onSuccess, onError, compact = false }: FeedbackHandlers & { compact?: boolean }) {
  useLocale();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiGet<{ integrations: IntegrationRow[] }>("/api/v1/integrations"),
    retry: false,
  });
  const projects = useQuery({
    queryKey: queryKeys.projects("integration-scope"),
    queryFn: () => apiGet<{ items?: ProjectRow[] }>("/api/v1/projects").then((r) => r.items ?? []),
    retry: false,
  });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deliveryIntegration,setDeliveryIntegration]=useState<IntegrationRow|null>(null);

  const projectName = useMemo(() => {
    const map = new Map((projects.data ?? []).map((p) => [p.id, `${p.name}（${p.key}）`]));
    return (id: string | null) => (id ? map.get(id) ?? id.slice(0, 8) : t("se.intgGlobal"));
  }, [projects.data]);

  const reset = () => { setFormError(null); setForm(EMPTY_FORM); setEditingId(null); setFormOpen(false); };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((cur) => ({ ...cur, [key]: value }));
  const setKind = (kind: string) => setForm((cur) => {
    if (editingId) return cur;
    const base = cur.baseUrl.trim().replace(/\/+$/u, "");
    return { ...cur, kind, baseUrl: !base || base === KIND_BASE_URL[cur.kind] ? KIND_BASE_URL[kind]! : cur.baseUrl };
  });

  const invalidate = async () => { await qc.invalidateQueries({ queryKey: ["integrations"] }); };
  const fail = (error: unknown, fallback: string) => onError(error instanceof ApiError ? error.message : fallback);

  /** 同步配置是 JSON（repo / userMap）；解析失败在点击时立即提示，不发请求 */
  const parseConfig = (): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(form.configText.trim() || "{}");
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not object");
      return v as Record<string, unknown>;
    } catch {
      setFormError(t("se.intgConfigInvalid"));
      return null;
    }
  };
  const create = useMutation({
    mutationFn: (config: Record<string, unknown> | null) => apiPost<{ id: string }>("/api/v1/integrations", {
      kind: form.kind, name: form.name.trim(), baseUrl: form.baseUrl.trim(),
      token: form.token, projectId: form.projectId || null, config: config ?? {},
    }),
    onSuccess: async () => { reset(); onSuccess(t("se.intgCreated")); await invalidate(); },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("se.intgSaveFailed")),
  });
  const update = useMutation({
    mutationFn: (config: Record<string, unknown> | null) => apiPatch<{ id: string }>(`/api/v1/integrations/${editingId}`, {
      name: form.name.trim(), baseUrl: form.baseUrl.trim(), projectId: form.projectId || null,
      ...(config !== null ? { config } : {}),
      ...(form.token ? { token: form.token } : {}),
    }),
    onSuccess: async () => { reset(); onSuccess(t("se.intgUpdated")); await invalidate(); },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("se.intgSaveFailed")),
  });
  const toggle = useMutation({
    mutationFn: (row: IntegrationRow) => apiPatch(`/api/v1/integrations/${row.id}`, { isActive: !row.isActive }),
    onSuccess: async () => { onSuccess(t("se.intgUpdated")); await invalidate(); },
    onError: (e) => fail(e, t("se.intgSaveFailed")),
  });
  const sync = useMutation({
    mutationFn: (row: IntegrationRow) => apiPost<{
      fetched: number; synced: number; skipped: number;
      pulls?: { fetched: number; synced: number }; reviews?: { fetched: number; synced: number };
    }>(`/api/v1/integrations/${row.id}/sync`),
    onSuccess: (r) => onSuccess(t("se.intgSyncDone", {
      fetched: String(r.fetched), synced: String(r.synced), skipped: String(r.skipped),
      pulls: String(r.pulls?.synced ?? 0), reviews: String(r.reviews?.synced ?? 0),
    })),
    onError: (e) => fail(e, t("se.intgSyncFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/integrations/${id}`),
    onSuccess: async () => { onSuccess(t("se.intgDeleted")); await invalidate(); },
    onError: (e) => { fail(e, t("se.intgSaveFailed")); },
  });

  const startEdit = (row: IntegrationRow) => {
    setFormError(null);
    setEditingId(row.id);
    setForm({
      kind: row.kind, name: row.name, baseUrl: row.baseUrl, token: "", projectId: row.projectId ?? "",
      configText: JSON.stringify(row.config ?? {}, null, 2),
    });
    setFormOpen(true);
  };
  const submitting = create.isPending || update.isPending;
  const draft = useSettingsDraft(formOpen, form, submitting);
  const requestClose = () => void draft.leave(reset);
  const canSubmit = form.name.trim().length > 0 && form.baseUrl.trim().length > 0
    && (editingId ? true : form.token.length > 0) && !submitting;

  return (
    <SettingsSection variant={compact ? "row" : "card"} leading={compact && <Icon name="link" size={18} />}
      title={t("set.integration")} description={compact ? t("se.messagingIntegrationDesc") : t("se.intgDesc")}
      status={compact && list.data?.integrations.length === 0 ? t("se.messagingUnconfigured") : undefined}
      actions={<Button size="sm" variant={compact ? "ghost" : "primary"} aria-label={t("se.intgAdd")} onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setFormOpen(true); }}><Icon name="plus" size={14} />{compact ? t("common.add") : t("se.intgAdd")}</Button>}>
      {list.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {list.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>}>{t("se.intgLoadFailed")}</SettingsListState>}
      {!compact && list.data && list.data.integrations.length === 0 && <SettingsListState>{t("se.intgNoItems")}</SettingsListState>}
      {!!list.data?.integrations.length && (
        <ul className="settings-record-list">
          {list.data.integrations.map((row) => (
            <li key={row.id}>
              <span className="settings-record-main">
                <strong>{row.name}</strong>
                <span className="mono settings-record-detail">{row.kind} · {row.baseUrl}</span>
                <span className="settings-record-detail">{projectName(row.projectId)} · {t("se.intgTokenConfigured")}</span>
              </span>
              <span className={row.isActive ? "tag tag-success" : "tag"}>{row.isActive ? t("se.enabled") : t("se.intgInactive")}</span>
              <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>{t("se.intgEdit")}</Button>
              {row.kind==='GITHUB'&&row.projectId&&<Button size="sm" variant="ghost" onClick={()=>setDeliveryIntegration(row)}>{t('delivery.source.title')}</Button>}
              {!!row.config && typeof (row.config as { repo?: unknown }).repo === "string" && (
                <Button size="sm" variant="ghost" disabled={sync.isPending} onClick={() => sync.mutate(row)}>{t("se.intgSync")}</Button>
              )}
              <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(row)}>
                {row.isActive ? t("se.intgToggleOff") : t("se.intgToggleOn")}
              </Button>
              <Button size="sm" variant="danger" disabled={remove.isPending} onClick={async () => { if (await confirmDialog(`${t("common.confirmDelete")} ${row.name}`, { danger: true })) remove.mutate(row.id); }}>{t("common.delete")}</Button>
            </li>
          ))}
        </ul>
      )}


      {draft.guard}
      {deliveryIntegration?.projectId&&<DeliverySourceEditor projectId={deliveryIntegration.projectId} integrationId={deliveryIntegration.id} onClose={()=>setDeliveryIntegration(null)}/>}
      <Modal open={formOpen} title={editingId ? t("se.intgEdit") : t("se.intgNew")} onClose={requestClose}
        footer={<>
          <Button onClick={requestClose} disabled={submitting}>{t("se.intgCancel")}</Button>
          <Button variant="primary" disabled={!canSubmit} loading={submitting}
            onClick={() => {
              const config = parseConfig();
              if (config === null) return;
              if (editingId) update.mutate(config); else create.mutate(config);
            }}>{editingId ? t("se.intgSave") : t("se.intgNew")}</Button>
        </>}>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <fieldset disabled={submitting} className="settings-form-fields">
        <div className="settings-fields settings-fields--two">
          <p className="muted settings-field settings-field--span-two" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
            {KIND_HINT[form.kind]}
          </p>

        <Select className="settings-field" label={t("se.intgKind")} ariaLabel={t("se.intgKind")}
          value={form.kind} disabled={editingId !== null} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: k }))} />
        <TextInput className="settings-field" label={t("se.intgName")} placeholder={t("se.intgName")}
          value={form.name} aria-label={t("se.intgName")} onChange={(e) => set("name", e.target.value)} />
        <TextInput className="settings-field settings-field--span-two" label={t("se.intgBaseUrl")} type="url"
          placeholder={KIND_BASE_URL[form.kind]} value={form.baseUrl} aria-label={t("se.intgBaseUrl")}
          onChange={(e) => set("baseUrl", e.target.value)} />
        <TextInput className="settings-field" label={t("se.intgToken")} type="password"
          placeholder={editingId ? t("se.intgTokenKeep") : t("se.intgToken")} value={form.token}
          aria-label={t("se.intgToken")} autoComplete="off" onChange={(e) => set("token", e.target.value)} />
        <Select className="settings-field" label={t("se.intgScope")} ariaLabel={t("se.intgScope")}
          value={form.projectId} onChange={(v) => set("projectId", v)}
          options={[{ value: "", label: t("se.intgGlobal") }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.name}（${p.key}）` }))]} />
        <TextArea className="settings-field settings-field--span-two" label={t("se.intgConfig")}
          hint={t("se.intgConfigHint")} rows={3} value={form.configText}
          aria-label={t("se.intgConfig")} onChange={(e) => set("configText", e.target.value)} />
        </div>
        </fieldset>
      </Modal>
    </SettingsSection>
  );
}
