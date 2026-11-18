/** 附件存储：本地磁盘 / S3 兼容对象存储；保存后可测试连接。 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { Select } from "../Select.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers, SettingView } from "./types.ts";

interface StorageForm {
  kind: "local" | "s3";
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKey: string; secretKey: string; forcePathStyle: boolean;
}
const EMPTY: StorageForm = {
  kind: "local", endpoint: "", region: "us-east-1", bucket: "", prefix: "",
  accessKey: "", secretKey: "", forcePathStyle: true,
};

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function StorageSettings({ onSuccess, onError }: FeedbackHandlers) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<{ settings: SettingView[] }>("/api/v1/settings") });
  const [form, setForm] = useState<StorageForm>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || !settings.data) return;
    const get = (key: string) => settings.data!.settings.find((s) => s.key === key)?.value;
    setForm({
      kind: get("storage.kind") === "s3" ? "s3" : "local",
      endpoint: String(get("storage.s3.endpoint") ?? ""),
      region: String(get("storage.s3.region") ?? "us-east-1"),
      bucket: String(get("storage.s3.bucket") ?? ""),
      prefix: String(get("storage.s3.prefix") ?? ""),
      accessKey: "", secretKey: "",
      forcePathStyle: get("storage.s3.forcePathStyle") !== false,
    });
    setLoaded(true);
  }, [settings.data, loaded]);

  const save = useMutation({
    mutationFn: (values: StorageForm) => apiPut("/api/v1/settings", {
      "storage.kind": values.kind,
      "storage.s3.endpoint": values.endpoint.trim() || null,
      "storage.s3.region": values.region.trim() || "us-east-1",
      "storage.s3.bucket": values.bucket.trim() || null,
      "storage.s3.prefix": values.prefix.trim() || null,
      "storage.s3.forcePathStyle": values.forcePathStyle,
      ...(values.accessKey ? { "storage.s3.accessKey": values.accessKey } : {}),
      ...(values.secretKey ? { "storage.s3.secretKey": values.secretKey } : {}),
    }),
    onSuccess: async () => {
      onSuccess(t("se.storageSaved"));
      const saved = { ...form, accessKey: "", secretKey: "" };
      setForm(saved); draft.markSaved(saved);
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.storageSaveFailed")),
  });
  const test = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; reason: string | null }>("/api/v1/settings/storage/test", {}),
    onSuccess: (r) => { if (r.ok) onSuccess(t("se.storageTestOk")); else onError(`${t("se.storageTestFailed")}${r.reason ? `：${r.reason}` : ""}`); },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.storageTestFailed")),
  });
  const ready = loaded && settings.isSuccess;

  const draft = useSettingsDraft(loaded, form, save.isPending);
  return (
    <SettingsSection className="storage-settings-card" title={t("se.storageTitle")} description={t("se.storageShort")} hint={t("se.storageHint")} fullWidth
      footer={<>
        <Button size="sm" loading={test.isPending} disabled={!ready || test.isPending} onClick={() => test.mutate()}>{t("se.storageTest")}</Button>
        <Button variant="primary" loading={save.isPending} disabled={!ready || save.isPending || (form.kind === "s3" && (!form.endpoint || !form.bucket))}
          onClick={() => save.mutate(form)}>{t("common.save")}</Button>
      </>}>
      {!loaded && !settings.isError && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {settings.isError && <SettingsListState tone="error" action={
        <Button size="sm" onClick={() => void settings.refetch()} disabled={settings.isFetching}>{t("common.reload")}</Button>
      }>{settings.error instanceof ApiError ? settings.error.message : t("common.loadFailedShort")}</SettingsListState>}
      {draft.guard}
      {loaded && <fieldset disabled={save.isPending} className="settings-form-fields">
      <div className="settings-fields settings-fields--two storage-kind-row">
        <Select className="settings-field" label={t("se.storageKind")} ariaLabel={t("se.storageKind")} value={form.kind}
          onChange={(v) => setForm({ ...form, kind: v as "local" | "s3" })}
          options={[{ value: "local", label: t("se.storageLocal") }, { value: "s3", label: t("se.storageS3") }]} />
        <p className="muted settings-storage-kind-note">
          {form.kind === "local" ? t("se.storageLocalHint") : t("se.storageS3Hint")}
        </p>
      </div>
      {form.kind === "s3" && (
        <div className="settings-fields settings-fields--two">
          <TextInput label={t("se.s3Endpoint")} placeholder="https://s3.example.com" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
          <TextInput label={t("se.s3Region")} placeholder="us-east-1" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          <TextInput label={t("se.s3Bucket")} placeholder="feronavi-attachments" value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })} />
          <TextInput label={t("se.s3Prefix")} placeholder="optional/prefix" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
          <TextInput label={t("se.s3AccessKey")} placeholder={t("se.s3KeyKeep")} value={form.accessKey} onChange={(e) => setForm({ ...form, accessKey: e.target.value })} />
          <TextInput label={t("se.s3SecretKey")} type="password" placeholder={t("se.s3KeyKeep")} value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} />
          <div className="settings-field settings-field--span-two">
            <Checkbox label={t("se.s3ForcePathStyle")} checked={form.forcePathStyle} onChange={(v) => setForm({ ...form, forcePathStyle: v })} />
          </div>
        </div>
      )}
      <p className="muted settings-storage-note">{t("se.storageNote")}</p>
      </fieldset>}
    </SettingsSection>
  );
}
