/**
 * 数据留存设置（Round 25 长任务第 17 项）
 *
 * 规范 8.4 要求「保留期可配置，默认 1 年（安全类）」——后端此前只有环境变量一条路径。
 * 这里给管理员一个界面：审计 / 活动日志保留天数（0 = 关闭清理），留空/非法不允许保存。
 * 说明文字必须写清"到期会真正删除"，避免管理员误以为只是展示配置。
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";

interface SettingRow { key: string; value: unknown; isSecret: boolean }

const isDays = (raw: string): boolean => /^\d+$/.test(raw.trim()) && Number(raw) >= 0 && Number(raw) <= 3650;
const isHours = (raw: string): boolean => /^\d+$/.test(raw.trim()) && Number(raw) >= 0 && Number(raw) <= 8760;

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function RetentionSettings({ onSuccess, onError }: FeedbackHandlers) {
  useLocale();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<{ settings: SettingRow[] }>("/api/v1/settings") });
  const [auditDays, setAuditDays] = useState("365");
  const [activityDays, setActivityDays] = useState("365");
  const [exportHours, setExportHours] = useState("24");
  const [touched, setTouched] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!settings.data || touched) return;
    const valueOf = (key: string, fallback: number) => {
      const v = settings.data.settings.find((s) => s.key === key)?.value;
      return typeof v === "number" ? String(v) : String(fallback);
    };
    setAuditDays(valueOf("audit.retentionDays", 365));
    setActivityDays(valueOf("activity.retentionDays", 365));
    setExportHours(valueOf("export.retentionHours", 24));
    setLoaded(true);
  }, [settings.data, touched]);

  const save = useMutation({
    mutationFn: (values: { auditDays: string; activityDays: string; exportHours: string }) => apiPut<{ settings: SettingRow[] }>("/api/v1/settings", {
      "audit.retentionDays": Number(values.auditDays),
      "activity.retentionDays": Number(values.activityDays),
      "export.retentionHours": Number(values.exportHours),
    }),
    onSuccess: async () => {
      setTouched(true); draft.markSaved();
      onSuccess(t("se.retentionSaved"));
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.retentionInvalid")),
  });

  const valid = isDays(auditDays) && isDays(activityDays) && isHours(exportHours);
  const draft = useSettingsDraft(loaded, { auditDays, activityDays, exportHours }, save.isPending);
  return (
    <SettingsSection title={t("set.retention")} description={t("se.retentionShort")} hint={t("se.retentionHint")} fullWidth
      footer={<Button variant="primary" loading={save.isPending} disabled={!loaded || !settings.isSuccess || !valid || save.isPending}
        onClick={() => save.mutate({ auditDays, activityDays, exportHours })}>{t("se.retentionSave")}</Button>}>
      {!loaded && !settings.isError && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {settings.isError && <SettingsListState tone="error" action={
        <Button size="sm" onClick={() => void settings.refetch()} disabled={settings.isFetching}>{t("common.reload")}</Button>
      }>{settings.error instanceof ApiError ? settings.error.message : t("common.loadFailedShort")}</SettingsListState>}
      {draft.guard}
      {loaded && <fieldset disabled={save.isPending} className="settings-form-fields">
      <div className="settings-form-inline settings-form-inline--retention">
        <TextInput className="settings-field" label={t("se.retentionAudit")} type="number" inputMode="numeric"
          min={0} max={3650} value={auditDays} aria-label={t("se.retentionAudit")}
          hint={t("se.retentionAuditHint")}
          onChange={(e) => { setTouched(true); setAuditDays(e.target.value); }} />
        <TextInput className="settings-field" label={t("se.retentionActivity")} type="number" inputMode="numeric"
          min={0} max={3650} value={activityDays} aria-label={t("se.retentionActivity")}
          hint={t("se.retentionActivityHint")}
          onChange={(e) => { setTouched(true); setActivityDays(e.target.value); }} />
        <TextInput className="settings-field" label={t("se.retentionExport")} type="number" inputMode="numeric"
          min={0} max={8760} value={exportHours} aria-label={t("se.retentionExport")}
          hint={t("se.retentionExportHint")}
          onChange={(e) => { setTouched(true); setExportHours(e.target.value); }} />
      </div>
      {!valid && <p className="settings-inline-state settings-inline-state--error" role="alert">{t("se.retentionInvalid")}</p>}
      </fieldset>}
    </SettingsSection>
  );
}
