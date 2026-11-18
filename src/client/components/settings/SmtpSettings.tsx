import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { toast } from "../ui/Toast.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Select } from "../Select.tsx";
import { useSettingsDraft } from "./SettingsDraft.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers, SettingView } from "./types.ts";

type Transport = "SMTP" | "HTTP_API";
type HttpProvider = "RESEND" | "SENDGRID" | "MAILGUN" | "POSTMARK" | "BREVO" | "CUSTOM";
type SmtpForm = {
  transport: Transport; httpProvider: HttpProvider; httpEndpoint: string; httpDomain: string;
  host: string; port: string; user: string; password: string; from: string;
};
const DEFAULT_SMTP: SmtpForm = {
  transport: "SMTP", httpProvider: "RESEND", httpEndpoint: "", httpDomain: "",
  host: "", port: "587", user: "", password: "", from: "",
};

export function SmtpSettings({ onSuccess, onError }: FeedbackHandlers) {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ settings: SettingView[] }>("/api/v1/settings"),
    retry: false,
  });
  const [form, setForm] = useState<SmtpForm>(DEFAULT_SMTP);
  const [testTo, setTestTo] = useState("");

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || !settings.data) return;
    setLoaded(true);
    const rows = settings.data?.settings ?? [];
    const get = (key: string) => rows.find((row) => row.key === key);
    setForm({
      transport: get("mail.transport")?.value === "SMTP" || !get("mail.transport") ? "SMTP" : "HTTP_API",
      httpProvider: String(get("mail.httpProvider")?.value ?? "RESEND") as HttpProvider,
      httpEndpoint: String(get("mail.httpEndpoint")?.value ?? ""),
      httpDomain: String(get("mail.httpDomain")?.value ?? ""),
      host: String(get("smtp.host")?.value ?? ""),
      port: String(get("smtp.port")?.value ?? "587"),
      user: String(get("smtp.user")?.value ?? ""),
      password: "",
      from: String(get("smtp.from")?.value ?? ""),
    });
  }, [settings.data, loaded]);

  const save = useMutation({
    mutationFn: () => apiPut("/api/v1/settings", {
      "mail.transport": form.transport,
      "mail.httpProvider": form.httpProvider,
      "mail.httpEndpoint": form.httpEndpoint || null,
      "mail.httpDomain": form.httpDomain || null,
      "smtp.host": form.host,
      "smtp.port": Number(form.port) || 587,
      "smtp.user": form.user || null,
      ...(form.password ? { "smtp.password": form.password } : {}),
      "smtp.from": form.from || null,
    }),
    onSuccess: async () => {
      onSuccess(t("se.smtpSaved"));
      const saved = { ...form, password: "" };
      setForm(saved); draft.markSaved(saved);
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => onError(error instanceof ApiError ? error.message : t("se.saveFailed")),
  });

  const test = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; reason: string | null }>("/api/v1/settings/smtp/test", { to: testTo }),
    onSuccess: (result) => {
      if (result.ok) toast.success(t("se.testSent"));
      else toast.error(`未发出：${result.reason ?? t("se.unknownReason")}`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("se.testFailed")),
  });

  const set = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const draft = useSettingsDraft(loaded, form, save.isPending);
  return (
    <SettingsSection title={t("se.smtp")} description={t("se.smtpShort")} hint={t("se.smtpHint")}
      footer={<Button variant="primary" disabled={!form.from || (form.transport === "SMTP" && !form.host) || save.isPending || !loaded || !settings.isSuccess} onClick={() => save.mutate()}>{t("se.save")}</Button>}>
      {draft.guard}
      <fieldset disabled={!loaded || save.isPending} className="settings-form-fields">
      <div className="settings-fields settings-fields--two">
        <Select className="settings-field settings-field--span-two" label={t("se.smtpTransport")} ariaLabel={t("se.smtpTransport")}
          value={form.transport} onChange={(v) => set("transport", v as Transport)}
          options={[{ value: "SMTP", label: t("se.smtpTransportSmtp") }, { value: "HTTP_API", label: t("se.smtpTransportResend") }]} />
        {form.transport === "SMTP" ? (
          <>
            <TextInput className="settings-field" label={t("smtp.host")} placeholder={t("smtp.host")}
              value={form.host} aria-label={t("smtp.hostLabel")} onChange={(event) => set("host", event.target.value)} />
            <TextInput className="settings-field" label={t("smtp.port")} inputMode="numeric" placeholder={t("smtp.port")}
              value={form.port} aria-label={t("smtp.portLabel")} onChange={(event) => set("port", event.target.value)} />
            <TextInput className="settings-field" label={t("smtp.user")} placeholder={t("smtp.user")}
              value={form.user} aria-label={t("smtp.userLabel")} onChange={(event) => set("user", event.target.value)} />
          </>
        ) : (
          <>
            <Select className="settings-field" label="HTTP 服务商" ariaLabel="HTTP 服务商" value={form.httpProvider}
              onChange={(v) => set("httpProvider", v as HttpProvider)}
              options={[
                { value: "RESEND", label: "Resend" }, { value: "SENDGRID", label: "SendGrid" },
                { value: "MAILGUN", label: "Mailgun" }, { value: "POSTMARK", label: "Postmark" },
                { value: "BREVO", label: "Brevo" }, { value: "CUSTOM", label: "自定义（Resend 兼容）" },
              ]} />
            <TextInput className="settings-field" label="API Endpoint（可选）" value={form.httpEndpoint}
              placeholder="留空使用服务商默认端点" onChange={(e) => set("httpEndpoint", e.target.value)} />
            {form.httpProvider === "MAILGUN" && (
              <TextInput className="settings-field" label="Mailgun 发信域名" value={form.httpDomain}
                placeholder="mg.example.com" onChange={(e) => set("httpDomain", e.target.value)} />
            )}
            <p className="settings-field settings-field--span-two muted" style={{ fontSize: "var(--text-xs)", margin: 0 }}>{t("se.resendApiHint")}</p>
          </>
        )}
        <TextInput className="settings-field" label={form.transport === "SMTP" ? t("smtp.password") : "Resend API Key"} type="password" placeholder={t("smtp.password")}
          value={form.password} aria-label={form.transport === "SMTP" ? t("smtp.passwordLabel") : "Resend API Key"} autoComplete="new-password"
          onChange={(event) => set("password", event.target.value)} />
        <TextInput className="settings-field settings-field--span-two" label={t("smtp.from")} type="email" placeholder="Feronavi <noreply@yourdomain.com>"
          value={form.from} aria-label={t("smtp.fromLabel")} onChange={(event) => set("from", event.target.value)} />
      </div>
      <div className="settings-test-row">
        <TextInput className="settings-field" label={t("smtp.testTo")} type="email" placeholder={t("smtp.testTo")}
          value={testTo} aria-label={t("smtp.testToLabel")} onChange={(event) => setTestTo(event.target.value)} />
        <Button size="sm" disabled={!testTo || test.isPending} onClick={() => test.mutate()}>{t("se.sendTest")}</Button>
      </div>
      {settings.isLoading && <p className="settings-inline-state" aria-live="polite">{t("common.loading")}</p>}
      {settings.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void settings.refetch()}>{t("common.reload")}</Button>}>{t("common.loadFailedShort")}</SettingsListState>}
      </fieldset>
    </SettingsSection>
  );
}
