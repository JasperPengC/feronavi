/**
 * SSO / 身份源管理（Round 25 长任务第 43 项）
 *
 * 后端第十四期已实现 `idp_config` + OIDC 发现/授权/回调，但**前端零接线**：
 * 管理员没界面可配，登录页也没有 SSO 入口。本组件补管理面（登录页入口在 LoginPage）。
 *
 * 纪律：clientSecret **永不回显**（接口只给 hasSecret），编辑时留空=不修改；
 * issuer 由后端统一 SSRF 校验，失败原因透传。
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Select } from "../Select.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";

interface LdapConfig {
  baseDn: string; userFilter: string; usernameAttribute: string;
  emailAttribute: string; nameAttribute: string; startTls: boolean;
  tlsRejectUnauthorized: boolean; timeoutMs: number; defaultRoleKey: string;
}
interface IdpRow {
  id: string; kind: "OIDC" | "LDAP"; issuer: string; clientId: string;
  autoProvision: boolean; enabled: boolean; allowedEmailDomains: string | null; hasSecret: boolean;
  config?: Record<string, unknown>;
}
interface FormState {
  id: string; kind: "OIDC" | "LDAP"; issuer: string; clientId: string; clientSecret: string;
  autoProvision: "yes" | "no"; enabled: "yes" | "no"; allowedEmailDomains: string;
  ldap: LdapConfig;
}
const EMPTY_LDAP: LdapConfig = {
  baseDn: "", userFilter: "(uid={{username}})", usernameAttribute: "uid",
  emailAttribute: "mail", nameAttribute: "displayName", startTls: false,
  tlsRejectUnauthorized: true, timeoutMs: 5000, defaultRoleKey: "MEMBER",
};
const EMPTY: FormState = {
  id: "", kind: "OIDC", issuer: "", clientId: "", clientSecret: "",
  autoProvision: "no", enabled: "no", allowedEmailDomains: "", ldap: EMPTY_LDAP,
};

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function SsoSettings({ onSuccess }: FeedbackHandlers) {
  useLocale();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["idps"],
    queryFn: () => apiGet<{ idps: IdpRow[] }>("/api/v1/settings/idp"),
    retry: false,
  });
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const formId = useId();
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((c) => ({ ...c, [k]: v }));
  // 防御：任何非预期响应（例如旧缓存/代理返回 {}）都不能让整页崩掉
  const idps = list.data?.idps ?? [];

  const save = useMutation({
    mutationFn: () => apiPost("/api/v1/settings/idp", {
      ...(form.id ? { id: form.id } : {}),
      kind: form.kind, issuer: form.issuer.trim(), clientId: form.clientId.trim(),
      ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
      autoProvision: form.autoProvision === "yes", enabled: form.enabled === "yes",
      allowedEmailDomains: form.allowedEmailDomains.trim() || null,
      ...(form.kind === "LDAP" ? { config: {
        url: form.issuer.trim(), bindDn: form.clientId.trim(), baseDn: form.ldap.baseDn.trim(),
        userFilter: form.ldap.userFilter.trim(), usernameAttribute: form.ldap.usernameAttribute.trim(),
        emailAttribute: form.ldap.emailAttribute.trim(), nameAttribute: form.ldap.nameAttribute.trim(),
        startTls: form.ldap.startTls, tlsRejectUnauthorized: form.ldap.tlsRejectUnauthorized,
        timeoutMs: form.ldap.timeoutMs, defaultRoleKey: form.ldap.defaultRoleKey.trim(),
      } } : {}),
    }),
    onSuccess: async () => {
      setForm(EMPTY); draft.markSaved(EMPTY); setFormOpen(false); setFormError(null);
      onSuccess(t("se.idpSaved"));
      await qc.invalidateQueries({ queryKey: ["idps"] });
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("se.idpFailed")),
  });
  const testLdap = useMutation({
    mutationFn: (id: string) => apiPost<{ ok: boolean; dnCount: number }>(`/api/v1/settings/idp/${id}/test`, {}),
    onSuccess: (r) => setTestMsg(`LDAP 连接成功，返回 ${r.dnCount} 条记录`),
    onError: (e) => setTestMsg(e instanceof ApiError ? e.message : "LDAP 连接失败"),
  });

  const draft = useSettingsDraft(formOpen, form, save.isPending);
  const startEdit = (row: IdpRow) => {
    void draft.leave(() => {
    const c = (row.config ?? {}) as Record<string, unknown>;
    const str = (k: string, d: string) => typeof c[k] === "string" ? c[k] as string : d;
    const next: FormState = {
      id: row.id, kind: row.kind, issuer: row.issuer, clientId: row.clientId, clientSecret: "",
      autoProvision: row.autoProvision ? "yes" : "no", enabled: row.enabled ? "yes" : "no",
      allowedEmailDomains: row.allowedEmailDomains ?? "",
      ldap: {
        baseDn: str("baseDn", ""), userFilter: str("userFilter", "(uid={{username}})"),
        usernameAttribute: str("usernameAttribute", "uid"), emailAttribute: str("emailAttribute", "mail"),
        nameAttribute: str("nameAttribute", "displayName"),
        startTls: c.startTls === true, tlsRejectUnauthorized: c.tlsRejectUnauthorized !== false,
        timeoutMs: typeof c.timeoutMs === "number" ? c.timeoutMs : 5000,
        defaultRoleKey: str("defaultRoleKey", "MEMBER"),
      },
    };
    setForm(next); draft.markSaved(next); setFormError(null); setFormOpen(true);
    });
  };

  const requestClose = () => void draft.leave(() => { setFormOpen(false); setForm(EMPTY); setFormError(null); });
  const canSave = !!form.issuer.trim() && !!form.clientId.trim() && (form.kind !== "LDAP" || !!form.ldap.baseDn.trim()) && !save.isPending;

  return (
    <SettingsSection title={t("set.sso")} description={t("se.ssoDesc")}
      actions={<Button size="sm" variant="primary" aria-haspopup="dialog" onClick={() => { setForm(EMPTY); setFormError(null); setFormOpen(true); }}>{t("se.idpCreate")}</Button>}>
      {draft.guard}
      {list.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {list.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>}>{t("se.idpLoadFailed")}</SettingsListState>}
      {list.data && idps.length === 0 && <SettingsListState>{t("se.idpEmpty")}</SettingsListState>}
      {!!idps.length && (
        <ul className="settings-record-list">
          {idps.map((row) => (
            <li key={row.id}>
              <span className="settings-record-main">
                <strong>{row.kind} · {row.issuer}</strong>
                <span className="settings-record-detail">clientId: {row.clientId} · {row.hasSecret ? t("se.idpHasSecret") : t("se.idpNoSecret")}</span>
                <span className="settings-record-detail">
                  {row.enabled ? t("se.idpEnabled") : t("se.idpDisabled")}
                  {row.autoProvision ? ` · ${t("se.idpAutoProvision")}` : ""}
                  {row.allowedEmailDomains ? ` · ${row.allowedEmailDomains}` : ""}
                </span>
              </span>
              {row.kind === "LDAP" && <Button size="sm" variant="ghost" loading={testLdap.isPending} onClick={() => { setTestMsg(null); testLdap.mutate(row.id); }}>测试</Button>}
              <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>{t("se.intgEdit")}</Button>
            </li>
          ))}
        </ul>
      )}

      {testMsg && <p className="muted" role="status" style={{ fontSize: "var(--text-xs)", margin: "0 0 10px" }}>{testMsg}</p>}
      <Modal open={formOpen} width="lg" title={form.id ? t("se.intgEdit") : t("se.idpCreate")} onClose={requestClose}
        footer={<>
          <Button disabled={save.isPending} onClick={requestClose}>{t("common.cancel")}</Button>
          <Button form={formId} type="submit" variant="primary" loading={save.isPending} disabled={!canSave}>{form.id ? t("se.intgSave") : t("se.idpCreate")}</Button>
        </>}>
      {formError && <p className="field-error" role="alert">{formError}</p>}
      <form id={formId} onSubmit={event => { event.preventDefault(); if (canSave) { setFormError(null); save.mutate(); } }}>
      <fieldset disabled={save.isPending} className="settings-form-fields">
      <div className="settings-fields settings-fields--two">
        <Select className="settings-field" label={t("se.idpKind")} ariaLabel={t("se.idpKind")} value={form.kind}
          onChange={(v) => set("kind", v as "OIDC" | "LDAP")}
          options={[{ value: "OIDC", label: "OIDC" }, { value: "LDAP", label: "LDAP" }]} />
        <TextInput className="settings-field" label={form.kind === "LDAP" ? "LDAP URL（ldap:// / ldaps://）" : t("se.idpIssuer")} type="url" placeholder={form.kind === "LDAP" ? "ldap://ldap.example.com:389" : "https://idp.example.com"}
          value={form.issuer} aria-label={t("se.idpIssuer")} onChange={(e) => set("issuer", e.target.value)} />
        <TextInput className="settings-field" label={form.kind === "LDAP" ? "Bind DN" : t("se.idpClientId")} value={form.clientId}
          aria-label={t("se.idpClientId")} onChange={(e) => set("clientId", e.target.value)} />
        <TextInput className="settings-field" label={form.kind === "LDAP" ? "Bind 密码" : t("se.idpClientSecret")} type="password" autoComplete="off"
          placeholder={form.id ? t("se.idpSecretKeep") : t("se.idpClientSecret")}
          value={form.clientSecret} aria-label={t("se.idpClientSecret")} onChange={(e) => set("clientSecret", e.target.value)} />
        {form.kind === "LDAP" && (
          <>
            <TextInput className="settings-field" label="Base DN" value={form.ldap.baseDn}
              onChange={(e) => set("ldap", { ...form.ldap, baseDn: e.target.value })} />
            <TextInput className="settings-field" label="用户过滤器" value={form.ldap.userFilter}
              onChange={(e) => set("ldap", { ...form.ldap, userFilter: e.target.value })} />
            <TextInput className="settings-field" label="用户名属性" value={form.ldap.usernameAttribute}
              onChange={(e) => set("ldap", { ...form.ldap, usernameAttribute: e.target.value })} />
            <TextInput className="settings-field" label="邮箱属性" value={form.ldap.emailAttribute}
              onChange={(e) => set("ldap", { ...form.ldap, emailAttribute: e.target.value })} />
            <TextInput className="settings-field" label="显示名属性" value={form.ldap.nameAttribute}
              onChange={(e) => set("ldap", { ...form.ldap, nameAttribute: e.target.value })} />
            <TextInput className="settings-field" label="默认角色 key" value={form.ldap.defaultRoleKey}
              onChange={(e) => set("ldap", { ...form.ldap, defaultRoleKey: e.target.value })} />
            <Select className="settings-field" label="StartTLS" ariaLabel="StartTLS" value={form.ldap.startTls ? "yes" : "no"}
              onChange={(v) => set("ldap", { ...form.ldap, startTls: v === "yes" })}
              options={[{ value: "no", label: "否" }, { value: "yes", label: "是" }]} />
            <Select className="settings-field" label="校验 TLS 证书" ariaLabel="校验 TLS 证书" value={form.ldap.tlsRejectUnauthorized ? "yes" : "no"}
              onChange={(v) => set("ldap", { ...form.ldap, tlsRejectUnauthorized: v === "yes" })}
              options={[{ value: "yes", label: "是" }, { value: "no", label: "否（仅内网调试）" }]} />
          </>
        )}
        <Select className="settings-field" label={t("se.idpAutoProvisionLabel")} ariaLabel={t("se.idpAutoProvisionLabel")}
          value={form.autoProvision} onChange={(v) => set("autoProvision", v as "yes" | "no")}
          options={[{ value: "no", label: t("common.no") }, { value: "yes", label: t("common.yes") }]} />
        <Select className="settings-field" label={t("se.idpEnabledLabel")} ariaLabel={t("se.idpEnabledLabel")}
          value={form.enabled} onChange={(v) => set("enabled", v as "yes" | "no")}
          options={[{ value: "no", label: t("common.no") }, { value: "yes", label: t("common.yes") }]} />
        <TextInput className="settings-field settings-field--span-two" label={t("se.idpDomains")} placeholder="example.com,corp.example.com"
          value={form.allowedEmailDomains} aria-label={t("se.idpDomains")} onChange={(e) => set("allowedEmailDomains", e.target.value)} />
      </div>
      </fieldset>
      </form>
      </Modal>
    </SettingsSection>
  );
}
