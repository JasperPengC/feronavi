import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";
import { settingsCopy } from "./copy.ts";
import { ExternalLinkButton } from "../ui/LinkButton.tsx";
import { useSettingsDraft } from "./SettingsDraft.tsx";
import { Modal } from "../ui/Modal.tsx";
import { toast } from "../ui/Toast.tsx";

export function SecuritySettings({ onSuccess, onError }: FeedbackHandlers) {
  const locale = useLocale();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["2fa"], queryFn: () => apiGet<{ enabled: boolean; pending: boolean }>("/api/v1/auth/2fa") });
  const [setupData, setSetupData] = useState<{ otpauthUrl: string; recoveryCodes: string[] } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const setup = useMutation({
    mutationFn: () => apiPost<{ otpauthUrl: string; recoveryCodes: string[] }>("/api/v1/auth/2fa/setup", {}),
    onSuccess: (result) => { setSetupData(result); setQrDataUrl(""); },
    onError: (error) => onError(error instanceof ApiError ? error.message : t("se.genFailed")),
  });
  const activate = useMutation({
    mutationFn: () => apiPost("/api/v1/auth/2fa/activate", { code }),
    onSuccess: async () => {
      setSetupData(null);
      setQrDataUrl("");
      setCode("");
      onSuccess(t("se.totpEnabled"));
      await qc.invalidateQueries({ queryKey: ["2fa"] });
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : t("se.totpBadCode")),
  });
  const disable = useMutation({
    mutationFn: () => apiDelete("/api/v1/auth/2fa", { password }),
    onSuccess: async () => {
      setPassword("");
      onSuccess(t("se.totpDisabled"));
      await qc.invalidateQueries({ queryKey: ["2fa"] });
    },
    onError: (error) => onError(error instanceof ApiError ? error.message : t("se.badPassword")),
  });

  useEffect(() => {
    if (!setupData) return;
    let alive = true;
    void QRCode.toDataURL(setupData.otpauthUrl, { width: 220, margin: 1, color: { dark: "#111827", light: "#ffffff" } })
      .then((url) => { if (alive) setQrDataUrl(url); })
      .catch(() => { if (alive) toast.error(t("se.qrFailed")); });
    return () => { alive = false; };
  }, [setupData]);

  const copyText = async (text: string, okText: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okText);
    } catch {
      toast.error(t("se.copyFailed"));
    }
  };
  const downloadRecovery = () => {
    if (!setupData) return;
    const blob = new Blob([
      "Feronavi recovery codes\n",
      "Each code can be used once. Keep this file offline.\n\n",
      setupData.recoveryCodes.join("\n"),
      "\n",
    ], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "feronavi-recovery-codes.txt"; a.click();
    URL.revokeObjectURL(url);
  };
  const draft = useSettingsDraft(!!setupData, { code }, activate.isPending);
  const closeSetup = () => void draft.leave(() => {
    if (activate.isPending) return;
    setSetupData(null); setQrDataUrl(""); setCode(""); setFormError(null);
  });

  return (
    <SettingsSection title={t("set.security")} description={settingsCopy(locale, "securityDescription")}
      footer={<>
        {!state.data?.enabled && !setupData && (
          <Button variant="primary" disabled={setup.isPending || !state.isSuccess} onClick={() => setup.mutate()}>{t("se.enable2fa")}</Button>
        )}
        <ExternalLinkButton size="sm" href="/api/v1/me/data-export" download>{t("se.exportJson")}</ExternalLinkButton>
      </>}>
      <div className="settings-security-status">
        <span>{settingsCopy(locale, "twoFactor")}</span>
        {state.data?.enabled ? <span className="tag tag-success">{t("se.enabled")}</span>
          : state.data?.pending ? <span className="tag tag-warning">{t("se.pending")}</span>
            : <span className="tag">{t("se.disabled2")}</span>}
      </div>
      {state.data?.enabled && (
        <div className="settings-form-inline">
          <TextInput className="settings-field" label={t("set.currentPasswordHint")} type="password"
            placeholder={t("set.currentPasswordHint")} value={password} aria-label={t("set.currentPassword")}
            autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
          <Button disabled={!password || disable.isPending} onClick={() => disable.mutate()}>{t("se.disable2fa")}</Button>
        </div>
      )}
      {state.isLoading && <p className="settings-inline-state" aria-live="polite">{t("common.loading")}</p>}
      {state.isError && <p className="settings-inline-state settings-inline-state--error" role="alert">{t("se.saveFailed")}</p>}

      {draft.guard}
      <Modal open={Boolean(setupData)} width="lg" title={t("se.totpModalTitle")} onClose={closeSetup}
        footer={<>
          <Button onClick={closeSetup}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={activate.isPending} disabled={code.length < 6 || activate.isPending}
            onClick={() => activate.mutate()}>{t("se.activate")}</Button>
        </>}>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        {setupData && (
          <div className="totp-setup">
            <p className="muted totp-step">{t("se.totpStep1")}</p>
            <div className="totp-scan-row">
              <div className="totp-qr">
                {qrDataUrl ? <img src={qrDataUrl} alt={t("se.totpQrAlt")} width={220} height={220} /> : <span className="muted">{t("common.loading")}</span>}
              </div>
              <div className="totp-manual">
                <span className="field-label">{t("se.totpManual")}</span>
                <div className="totp-url-row">
                  <code className="mono totp-url">{setupData.otpauthUrl}</code>
                  <Button size="sm" onClick={() => void copyText(setupData.otpauthUrl, t("se.urlCopied"))}>{t("common.copy")}</Button>
                </div>
              </div>
            </div>

            <div className="totp-recovery">
              <div className="totp-recovery-head">
                <div>
                  <strong>{t("se.recoveryTitle")}</strong>
                  <p className="muted">{t("se.recoveryHint")}</p>
                </div>
                <div className="totp-recovery-actions">
                  <Button size="sm" onClick={() => void copyText(setupData.recoveryCodes.join("\n"), t("se.recoveryCopied"))}>{t("common.copy")}</Button>
                  <Button size="sm" onClick={downloadRecovery}>{t("se.recoveryDownload")}</Button>
                </div>
              </div>
              <ul className="totp-codes">
                {setupData.recoveryCodes.map((c) => <li key={c} className="mono">{c}</li>)}
              </ul>
            </div>

            <div className="totp-verify">
              <TextInput className="settings-field" label={t("se.totpCodeLabel")} inputMode="numeric"
                placeholder="000000" autoComplete="one-time-code" value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
              <span className="muted">{t("se.totpStep2")}</span>
            </div>
          </div>
        )}
      </Modal>
    </SettingsSection>
  );
}
