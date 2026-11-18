import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, ApiError } from "../../lib/api.ts";
import { t, setLocale } from "../../i18n/index.ts";
import { Select } from "../Select.tsx";
import { timeZoneOptions } from "../timezones.ts";
import { Button } from "../ui/Button.tsx";
import { setTheme } from "../../lib/theme.ts";
import { useSettingsDraft } from "./SettingsDraft.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers, Prefs } from "./types.ts";

const DEFAULT_PREFS: Prefs = { theme: "system", locale: "zh-CN", timezone: "", density: "comfortable" };

export function AppearanceSettings({ onSuccess, onError }: FeedbackHandlers) {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: () => apiGet<Prefs>("/api/v1/me/preferences") });
  const [form, setForm] = useState<Prefs>(DEFAULT_PREFS);

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || !prefs.data) return;
    setLoaded(true); setForm({ ...prefs.data, timezone: prefs.data.timezone ?? "" });
  }, [prefs.data, loaded]);

  const save = useMutation({
    mutationFn: () => apiPut("/api/v1/me/preferences", { ...form, timezone: form.timezone || null }),
    onSuccess: async () => {
      // 设置页保存后**立刻应用**主题（服务端值 system 由 setTheme 归一化为 auto），
      // 否则要刷新/重新登录才生效。
      setTheme(form.theme);
      setLocale(form.locale === "en-US" ? "en-US" : "zh-CN");
      draft.markSaved();
      await qc.invalidateQueries({ queryKey: ["actor"] });
      window.dispatchEvent(new Event("feronavi:theme"));
      onSuccess(t("se.prefsSaved"));
      await qc.invalidateQueries({ queryKey: ["prefs"] });
    },
    onError: (error) => onError(error instanceof ApiError ? error.message : t("se.saveFailed")),
  });

  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => setForm((current) => ({ ...current, [key]: value }));

  const draft = useSettingsDraft(loaded, form, save.isPending);
  return (
    <SettingsSection
      title={t("se.appearance")}
      description={t("se.timezoneHint")}
      footer={<Button variant="primary" disabled={save.isPending || !loaded || !prefs.isSuccess} onClick={() => save.mutate()}>{t("se.savePrefs")}</Button>}
    >
      {draft.guard}
      <fieldset disabled={!loaded || save.isPending} className="settings-form-fields">
      <div className="settings-fields settings-fields--two">
        <Select className="settings-field" label={t("se.theme")} value={form.theme} ariaLabel={t("set.theme")}
          onChange={(value) => set("theme", value)} options={[
            { value: "system", label: t("se.themeSystem") },
            { value: "light", label: t("se.themeLight") },
            { value: "dark", label: t("se.themeDark") },
          ]} />
        <Select className="settings-field" label={t("se.locale")} value={form.locale} ariaLabel={t("set.locale")}
          onChange={(value) => set("locale", value)} options={[
            { value: "zh-CN", label: t("se.zhCN") },
            { value: "en-US", label: "English" },
          ]} />
        <Select className="settings-field" searchable label={t("se.timezone")} ariaLabel={t("set.timezone")}
          value={form.timezone ?? ""} onChange={(v) => set("timezone", v)}
          options={[{ value: "", label: t("set.timezoneFollow") }, ...timeZoneOptions()]} />
        <Select className="settings-field" label={t("se.density")} value={form.density} ariaLabel={t("set.density")}
          onChange={(value) => set("density", value)} options={[
            { value: "comfortable", label: t("se.densityComfortable") },
            { value: "compact", label: t("se.densityCompact") },
          ]} />
      </div>
      </fieldset>
      {prefs.isLoading && <p className="settings-inline-state" aria-live="polite">{t("common.loading")}</p>}
      {prefs.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void prefs.refetch()}>{t("common.reload")}</Button>}>{t("common.loadFailedShort")}</SettingsListState>}
    </SettingsSection>
  );
}
