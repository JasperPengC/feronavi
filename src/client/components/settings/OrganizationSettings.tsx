/**
 * 组织信息设置（REST 第 3 节 GET/PATCH /organization；PATCH 需 org:manage）
 * 名称 / Logo URL / 默认语言 / 默认时区 —— 组织是单行表，保存后全实例默认值生效。
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { useSettingsDraft } from "./SettingsDraft.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";

interface OrgView {
  id: string; name: string; logoUrl: string | null;
  defaultLocale: string; defaultTimezone: string;
}
const TIMEZONES = ["Asia/Shanghai", "UTC", "Asia/Tokyo", "Europe/London", "America/New_York", "America/Los_Angeles"];

export function OrganizationSettings({ onSuccess, onError }: FeedbackHandlers) {
  useLocale();
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ["organization"], queryFn: () => apiGet<OrgView>("/api/v1/organization") });
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [locale, setLocale] = useState("zh-CN");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [loaded, setLoaded] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!org.data || loaded || touched) return;
    setLoaded(true);
    setName(org.data.name);
    setLogoUrl(org.data.logoUrl ?? "");
    setLocale(org.data.defaultLocale);
    setTimezone(org.data.defaultTimezone);
  }, [org.data, touched, loaded]);

  const save = useMutation({
    mutationFn: () => apiPatch<OrgView>("/api/v1/organization", {
      name: name.trim(), logoUrl: logoUrl.trim() || null, defaultLocale: locale, defaultTimezone: timezone,
    }),
    onSuccess: async () => {
      setTouched(true); draft.markSaved();
      onSuccess(t("se.orgSaved"));
      await qc.invalidateQueries({ queryKey: ["organization"] });
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.orgSaveFailed")),
  });

  const timezoneOptions = TIMEZONES.includes(timezone)
    ? TIMEZONES.map((z) => ({ value: z, label: z }))
    : [{ value: timezone, label: timezone }, ...TIMEZONES.map((z) => ({ value: z, label: z }))];

  const draft = useSettingsDraft(loaded, { name, logoUrl, locale, timezone }, save.isPending);
  return (
    <SettingsSection title={t("set.organization")} description={t("se.orgShort")} hint={t("se.orgHint")}
      footer={<Button variant="primary" loading={save.isPending} disabled={!name.trim() || save.isPending || !loaded || !org.isSuccess}
        onClick={() => save.mutate()}>{t("se.orgSave")}</Button>}>
      {draft.guard}
      {org.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {org.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void org.refetch()}>{t("common.reload")}</Button>}>{t("common.loadFailedShort")}</SettingsListState>}
      <fieldset disabled={!loaded || save.isPending} className="settings-form-fields">
      <div className="settings-fields settings-fields--two">
        <TextInput className="settings-field" label={t("se.orgName")} value={name} aria-label={t("se.orgName")}
          onChange={(e) => { setTouched(true); setName(e.target.value); }} />
        <TextInput className="settings-field" label={t("se.orgLogo")} type="url" placeholder="https://…"
          value={logoUrl} aria-label={t("se.orgLogo")} onChange={(e) => { setTouched(true); setLogoUrl(e.target.value); }} />
        <Select className="settings-field" label={t("se.orgLocale")} ariaLabel={t("se.orgLocale")}
          value={locale} onChange={(v) => { setTouched(true); setLocale(v); }}
          options={[{ value: "zh-CN", label: "中文（zh-CN）" }, { value: "en-US", label: "English (en-US)" }]} />
        <Select className="settings-field" label={t("se.orgTimezone")} ariaLabel={t("se.orgTimezone")}
          value={timezone} onChange={(v) => { setTouched(true); setTimezone(v); }} options={timezoneOptions} searchable />
      </div>
      </fieldset>
    </SettingsSection>
  );
}
