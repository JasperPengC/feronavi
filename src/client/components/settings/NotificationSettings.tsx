import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import { CATEGORIES } from "./types.ts";
import type { FeedbackHandlers, NotifPrefs } from "./types.ts";
import { settingsCopy } from "./copy.ts";

export function NotificationSettings({ onSuccess, onError }: FeedbackHandlers) {
  const locale = useLocale();
  const qc = useQueryClient();
  const notif = useQuery({ queryKey: ["notif-prefs"], queryFn: () => apiGet<NotifPrefs>("/api/v1/notification-preferences") });
  const save = useMutation({
    mutationFn: (categoryPrefs: NotifPrefs["categoryPrefs"]) => apiPut("/api/v1/notification-preferences", { categoryPrefs }),
    onSuccess: async () => {
      onSuccess(t("se.channelsSaved"));
      await qc.invalidateQueries({ queryKey: ["notif-prefs"] });
    },
    onError: (error) => onError(error instanceof ApiError ? error.message : t("se.saveFailed")),
  });

  const updateChannel = (key: string, value: boolean) => {
    const categoryPrefs = { ...(notif.data?.categoryPrefs ?? {}) };
    categoryPrefs[key] = { ...(categoryPrefs[key] ?? {}), inApp: value };
    save.mutate(categoryPrefs);
  };
  const emailLabel = settingsCopy(locale, "email");

  return (
    <SettingsSection title={t("se.channels")} description={settingsCopy(locale, "channelsDescription")}>
      <div className="settings-channel-head" aria-hidden="true">
        <span />
        <span>{t("set.inApp")}</span>
        <span>{emailLabel}</span>
      </div>
      <div className="settings-channel-list">
        {CATEGORIES.map(([key, labelKey]) => {
          const current = notif.data?.categoryPrefs?.[key] ?? {};
          const label = t(labelKey);
          const isStrong = key === "MENTION";
          return (
            <div className="settings-channel-row" key={key}>
              <span className="settings-channel-name">{label}</span>
              <Checkbox checked={isStrong || current.inApp !== false} ariaLabel={`${label} ${t("set.inApp")}`} disabled={!notif.isSuccess || save.isPending || isStrong} onChange={(value) => updateChannel(key, value)} />
              <span className="settings-channel-note">{settingsCopy(locale, "emailFollowHint")}</span>
            </div>
          );
        })}
      </div>
      {notif.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {notif.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void notif.refetch()}>{t("common.reload")}</Button>}>{t("se.saveFailed")}</SettingsListState>}
    </SettingsSection>
  );
}
