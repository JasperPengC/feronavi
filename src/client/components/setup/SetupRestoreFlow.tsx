import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { RestoreSummary } from "../../../shared/schemas/system-backup.ts";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPost,
  apiUpload,
} from "../../lib/api.ts";
import { t as tr, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";

type RestorePhase = "upload" | "preflight" | "restoring" | "success" | "failed";

function displayValue(value: unknown, locale: string, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number")
    return new Intl.NumberFormat(locale).format(value);
  return String(value);
}

export function SetupRestoreFlow({ onBack }: { onBack: () => void }) {
  const locale = useLocale();
  const [phase, setPhase] = useState<RestorePhase>("upload");
  const [restore, setRestore] = useState<RestoreSummary | null>(null);
  const [fileName, setFileName] = useState("");
  const [migrationPassword, setMigrationPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [cleanupError, setCleanupError] = useState("");
  const [confirmationRetry, setConfirmationRetry] = useState(false);
  const [retryPassword, setRetryPassword] = useState("");
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const passwordValid =
    migrationPassword.length >= 12 && migrationPassword.length <= 256;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      fileRef.current = null;
    };
  }, []);

  const clearFileInput = () => {
    fileRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  };

  const resetForRetry = () => {
    clearFileInput();
    setFileName("");
    setMigrationPassword("");
    setConfirmation("");
    setRestore(null);
    setPendingUploadId(null);
    setCleanupError("");
    setConfirmationRetry(false);
    setRetryPassword("");
    setError("");
    setPhase("upload");
  };

  const uploadAndPreflight = async () => {
    const file = fileRef.current;
    if (!file || !passwordValid || pendingUploadId || busy) return;
    setBusy(true);
    setError("");
    let uploadedId: string | null = null;
    try {
      await apiPost<{ csrfToken?: string }>(
        "/api/v1/setup/restore/bootstrap",
        {},
      );
      const form = new FormData();
      form.set("file", file);
      const uploaded = await apiUpload<{ id: string }>(
        "/api/v1/setup/restore/upload",
        form,
      );
      uploadedId = uploaded.id;
      setPendingUploadId(uploaded.id);
      clearFileInput();
      setPhase("preflight");
      const report = await apiPost<RestoreSummary>(
        `/api/v1/setup/restore/${uploaded.id}/preflight`,
        { migrationPassword },
      );
      setRestore(report);
    } catch (e) {
      if (uploadedId) {
        try {
          await apiDelete(`/api/v1/setup/restore/${uploadedId}`);
          setPendingUploadId(null);
        } catch (cleanupFailure) {
          setCleanupError(
            cleanupFailure instanceof ApiError
              ? cleanupFailure.message
              : tr("su.restoreRetryFailed"),
          );
        }
      }
      clearFileInput();
      setMigrationPassword("");
      setPhase("failed");
      setError(
        e instanceof ApiError ? e.message : tr("su.restoreUploadFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const pollStatus = async (id: string, rejection?: string) => {
    if (!mountedRef.current) return;
    try {
      const status = await apiGet<
        RestoreSummary & { rebuild?: RestoreSummary["rebuild"] }
      >(`/api/v1/setup/restore/${id}/status`);
      if (!mountedRef.current) return;
      setRestore(status);
      setError("");
      if (status.status === "SUCCEEDED") {
        setPhase("success");
        return;
      }
      if (status.status === "FAILED") {
        setPhase("failed");
        setError(status.lastError ?? tr("su.restoreFailed"));
        return;
      }
      if (status.status === "PREFLIGHT_PASSED" && confirmationRetry) {
        setPhase("restoring");
      }
      if (
        rejection &&
        (status.status === "UPLOADED" || status.status === "PREFLIGHT_PASSED")
      ) {
        setPhase("failed");
        setError(rejection);
        return;
      }
      timerRef.current = window.setTimeout(
        () => void pollStatus(id, rejection),
        15_000,
      );
    } catch (e) {
      if (!mountedRef.current) return;
      setError(
        e instanceof ApiError ? e.message : tr("su.restoreStatusFailed"),
      );
      timerRef.current = window.setTimeout(
        () => void pollStatus(id, rejection),
        15_000,
      );
    }
  };

  const confirmRestore = async () => {
    if (!restore || confirmation !== "恢复此实例" || !passwordValid || busy)
      return;
    setBusy(true);
    setError("");
    setCleanupError("");
    let rejection: string | undefined;
    try {
      await apiPost(`/api/v1/setup/restore/${restore.id}/confirm`, {
        migrationPassword: confirmationRetry
          ? retryPassword
          : migrationPassword,
        confirmation: "恢复此实例",
      });
      setConfirmationRetry(false);
      setRetryPassword("");
    } catch (e) {
      // 响应丢失不代表服务端拒绝；只由属主状态接口判断是否已开始。
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        rejection = e.message;
      else setConfirmationRetry(true);
    } finally {
      setMigrationPassword("");
      setConfirmation("");
      setPhase("restoring");
      void pollStatus(restore.id, rejection);
      setBusy(false);
    }
  };

  const retryConfirm = async () => {
    if (!restore || retryPassword.length < 12 || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/v1/setup/restore/${restore.id}/confirm`, {
        migrationPassword: retryPassword,
        confirmation: "恢复此实例",
      });
      setConfirmationRetry(false);
      setRetryPassword("");
      void pollStatus(restore.id);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        setError(e.message);
      else setError(tr("su.restoreConfirmRetryFailed"));
    } finally {
      setBusy(false);
    }
  };

  const discardUpload = async () => {
    const id = pendingUploadId ?? restore?.id;
    if (!id) return resetForRetry();
    setBusy(true);
    try {
      await apiDelete(`/api/v1/setup/restore/${id}`);
      resetForRetry();
    } catch (e) {
      setCleanupError(
        e instanceof ApiError ? e.message : tr("su.restoreRetryFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const summary = restore?.manifestSummary;
  const excluded = Array.isArray(summary?.excludedData)
    ? summary.excludedData
    : [];
  const warnings = Array.isArray(summary?.warnings) ? summary.warnings : [];
  const rebuild = restore?.rebuild;
  const modeLabel =
    restore?.mode === "safe"
      ? tr("su.restoreModeSafe")
      : restore?.mode === "full"
        ? tr("su.restoreModeFull")
        : tr("su.restoreModeUnknown");
  const exclusionLabel = (item: unknown): string => {
    const key =
      typeof item === "object" && item !== null && "key" in item
        ? String((item as { key?: unknown }).key)
        : String(item ?? "");
    const labels: Record<string, string> = {
      api_tokens: tr("su.restoreExcludedApiTokens"),
      two_factor_authentication: tr("su.restoreExcludedTwoFactor"),
      smtp_credentials: tr("su.restoreExcludedSmtp"),
      third_party_credentials: tr("su.restoreExcludedThirdParty"),
      sessions_and_ephemeral_tokens: tr("su.restoreExcludedSessions"),
    };
    return labels[key] ?? tr("su.restoreExcludedOther");
  };

  return (
    <div className="setup-restore" aria-live="polite">
      <header className="setup-restore-head">
        <div>
          <h1 className="setup-title">{tr("su.restoreTitle")}</h1>
          <p className="setup-sub">{tr("su.restoreHint")}</p>
        </div>
        {phase === "upload" && (
          <Button disabled={busy} onClick={onBack}>
            {tr("su.restoreBack")}
          </Button>
        )}
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {cleanupError && (
        <div className="alert alert-error" role="alert">
          {cleanupError}
        </div>
      )}

      {phase === "upload" && (
        <div className="setup-restore-body">
          <div className="setup-restore-field">
            <label htmlFor="setup-restore-file">{tr("su.restoreFile")}</label>
            <input
              ref={inputRef}
              id="setup-restore-file"
              type="file"
              disabled={busy}
              accept=".fnbak,application/vnd.feronavi.backup+zip"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                fileRef.current = file;
                setFileName(file?.name ?? "");
                setError("");
              }}
            />
            {fileName && <p className="muted">{fileName}</p>}
          </div>
          <TextInput
            label={tr("su.migrationPassword")}
            type="password"
            disabled={busy}
            autoComplete="new-password"
            value={migrationPassword}
            hint={tr("su.restorePasswordHint")}
            onChange={(event) => setMigrationPassword(event.target.value)}
          />
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || !fileRef.current || !passwordValid}
            onClick={() => void uploadAndPreflight()}
          >
            {tr("su.restoreUpload")}
          </Button>
        </div>
      )}

      {(phase === "preflight" ||
        phase === "restoring" ||
        phase === "success" ||
        phase === "failed") &&
        restore && (
          <div className="setup-restore-body">
            {phase === "preflight" && (
              <>
                <h2 className="setup-group-title">
                  {tr("su.restoreSummaryTitle")}
                </h2>
                <dl className="setup-review setup-restore-summary">
                  <div>
                    <dt>{tr("su.restoreSourceVersion")}</dt>
                    <dd>{displayValue(restore.sourceVersion, locale)}</dd>
                  </div>
                  <div>
                    <dt>{tr("su.restoreMode")}</dt>
                    <dd>{modeLabel}</dd>
                  </div>
                  <div>
                    <dt>{tr("su.restoreCreatedAt")}</dt>
                    <dd>
                      {typeof summary?.createdAt === "string" &&
                      Number.isFinite(Date.parse(summary.createdAt))
                        ? new Date(summary.createdAt).toLocaleString(locale)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{tr("su.restoreDatasets")}</dt>
                    <dd>{displayValue(summary?.datasetCount, locale)}</dd>
                  </div>
                  <div>
                    <dt>{tr("su.restoreRows")}</dt>
                    <dd>{displayValue(summary?.totalRows, locale)}</dd>
                  </div>
                  <div>
                    <dt>{tr("su.restoreAttachments")}</dt>
                    <dd>
                      {displayValue(summary?.blobCount, locale)} ·{" "}
                      {displayValue(summary?.blobBytes, locale)} bytes
                    </dd>
                  </div>
                  <div>
                    <dt>{tr("su.restoreExcluded")}</dt>
                    <dd>
                      {excluded.length
                        ? excluded.map(exclusionLabel).join("、")
                        : "—"}
                    </dd>
                  </div>
                </dl>
                {warnings.length > 0 && (
                  <div className="alert alert-warning" role="note">
                    {warnings.map(String).join(" ")}
                  </div>
                )}
                <TextInput
                  label={tr("su.confirmPhrase")}
                  value={confirmation}
                  hint={tr("su.confirmPhraseHint", { phrase: "恢复此实例" })}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <div className="setup-restore-actions">
                  <Button onClick={() => void discardUpload()} disabled={busy}>
                    {tr("su.restoreCancel")}
                  </Button>
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={
                      busy || confirmation !== "恢复此实例" || !passwordValid
                    }
                    onClick={() => void confirmRestore()}
                  >
                    {tr("su.restoreConfirm")}
                  </Button>
                </div>
              </>
            )}

            {phase === "restoring" && (
              <div className="setup-restore-status" role="status">
                <h2>{tr("su.restoreBusinessProgress")}</h2>
                <p>{tr("su.restoreMaintenance")}</p>
                {confirmationRetry && restore.status === "PREFLIGHT_PASSED" && (
                  <div className="setup-restore-retry-confirm">
                    <p>{tr("su.restoreConfirmRetryHint")}</p>
                    <TextInput
                      label={tr("su.restoreRetryPassword")}
                      type="password"
                      value={retryPassword}
                      autoComplete="new-password"
                      onChange={(event) => setRetryPassword(event.target.value)}
                    />
                    <Button
                      variant="primary"
                      loading={busy}
                      disabled={busy || retryPassword.length < 12}
                      onClick={() => void retryConfirm()}
                    >
                      {tr("su.restoreConfirmRetry")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {phase === "success" && (
              <div className="setup-restore-status">
                <h2>{tr("su.restoreBusinessSuccess")}</h2>
                {restore.mode === "safe" && (
                  <>
                    <p>{tr("su.restoreReconfigure")}</p>
                    <ul className="setup-restore-list">
                      <li>{tr("su.restoreReconfigure2fa")}</li>
                      <li>{tr("su.restoreReconfigureTokens")}</li>
                      <li>{tr("su.restoreReconfigureMcp")}</li>
                      <li>{tr("su.restoreReconfigureThirdParty")}</li>
                    </ul>
                  </>
                )}
                {rebuild && (
                  <div
                    className={
                      rebuild.status === "FAILED"
                        ? "alert alert-warning"
                        : "alert"
                    }
                    role={rebuild.status === "FAILED" ? "alert" : "status"}
                  >
                    <strong>{tr("su.restoreRebuildTitle")}</strong>{" "}
                    {rebuild.message}
                  </div>
                )}
                {rebuild?.status === "FAILED" && rebuild.canRetry && (
                  <p>{tr("su.restoreRebuildRetryHint")}</p>
                )}
                <Link className="btn btn-primary" to="/login">
                  {tr("su.restoreLogin")}
                </Link>
              </div>
            )}

            {phase === "failed" && (
              <div className="setup-restore-status">
                <h2>{tr("su.restoreFailedTitle")}</h2>
                <p>{tr("su.restoreRetryHint")}</p>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={busy}
                  onClick={() => void discardUpload()}
                >
                  {tr("su.restoreRetry")}
                </Button>
              </div>
            )}
          </div>
        )}

      {phase === "failed" && !restore && (
        <div className="setup-restore-body setup-restore-status">
          <h2>{tr("su.restoreFailedTitle")}</h2>
          <p>{tr("su.restoreRetryHint")}</p>
          <Button
            variant="primary"
            disabled={busy}
            loading={busy}
            onClick={() => void discardUpload()}
          >
            {tr("su.restoreRetry")}
          </Button>
        </div>
      )}
    </div>
  );
}
