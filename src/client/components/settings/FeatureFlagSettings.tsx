/**
 * 功能开关（Round 25 长任务第 23 项）
 *
 * 平台级能力：`setting:manage` 可增改开关；当前**没有内置业务消费者**，
 * 界面上如实写明（不拿它给已上线功能做隐形开关）。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";
import { settingsCopy } from "./copy.ts";

interface FlagRow { key: string; enabled: boolean; config: Record<string, unknown> }

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function FeatureFlagSettings({ onSuccess, onError }: FeedbackHandlers) {
  const locale = useLocale();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => apiGet<{ flags: FlagRow[] }>("/api/v1/feature-flags"),
    retry: false,
  });
  const [newKey, setNewKey] = useState("");
  const invalidate = async () => { await qc.invalidateQueries({ queryKey: ["feature-flags"] }); };
  const fail = (e: unknown) => onError(e instanceof ApiError ? e.message : t("se.flagFailed"));

  const put = useMutation({
    mutationFn: (input: { key: string; enabled: boolean }) =>
      apiPut(`/api/v1/feature-flags/${encodeURIComponent(input.key)}`, { enabled: input.enabled }),
    onSuccess: async (_r, input) => {
      if (input.key === newKey) { setNewKey(""); draft.markSaved(""); }
      onSuccess(t("se.flagSaved", { key: input.key }));
      await invalidate();
    },
    onError: fail,
  });

  const add = () => {
    const key = newKey.trim();
    if (!key) return;
    put.mutate({ key, enabled: true });
  };

  const draft = useSettingsDraft(true, newKey, put.isPending);
  return (
    <SettingsSection title={t("set.featureFlags")} description={settingsCopy(locale, "flagsDescription")}
      footer={<Button variant="primary" disabled={!newKey.trim() || put.isPending} onClick={add}>{t("se.flagAdd")}</Button>}>
      {draft.guard}
      {list.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {list.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>}>{t("se.flagLoadFailed")}</SettingsListState>}
      {list.data && list.data.flags.length === 0 && <SettingsListState>{t("se.flagEmpty")}</SettingsListState>}
      {!!list.data?.flags.length && (
        <ul className="settings-record-list">
          {list.data.flags.map((flag) => (
            <li key={flag.key}>
              <span className="settings-record-main">
                <code className="mono">{flag.key}</code>
                {Object.keys(flag.config ?? {}).length > 0 && (
                  <span className="settings-record-detail mono">{JSON.stringify(flag.config)}</span>
                )}
              </span>
              <span className={flag.enabled ? "tag tag-success" : "tag"}>{flag.enabled ? t("se.flagEnabled") : t("se.flagDisabled")}</span>
              <Button size="sm" variant="ghost" disabled={put.isPending}
                onClick={() => put.mutate({ key: flag.key, enabled: !flag.enabled })}>
                {flag.enabled ? t("se.flagDisable") : t("se.flagEnable")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-form-inline">
        <TextInput className="settings-field" label={t("se.flagKey")} placeholder="ui.experiment.name"
          value={newKey} aria-label={t("se.flagKey")} onChange={(e) => setNewKey(e.target.value)} />
      </div>
    </SettingsSection>
  );
}
