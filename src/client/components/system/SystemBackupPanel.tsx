import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BackupFailureCode,
  BackupMode,
  BackupSummary,
  CurrentRestoreRebuild,
  PostRestoreRebuildSummary,
} from "../../../shared/schemas/system-backup.ts";
import { Select } from "../Select.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { ApiError, apiDelete, apiGet, apiPost } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";

interface BackupEstimate {
  mode: BackupMode;
  datasets: { name: string; rows: number }[];
  totalRows: number;
  blobCount: number;
  blobBytes: number;
  excludedData: { key: string; reason: string }[];
  warnings: string[];
}
interface BackupList { backups: BackupSummary[] }

const BACKUPS_KEY = ["sys-system-backups"] as const;
const CURRENT_RESTORE_KEY = ["sys-current-restore-rebuild"] as const;

function isBackupActive(status: BackupSummary["status"]): boolean {
  return status === "PENDING" || status === "RUNNING";
}

function isRebuildActive(status: PostRestoreRebuildSummary["status"]): boolean {
  return status === "PENDING" || status === "RUNNING";
}

function backupFailureMessageKey(code: BackupFailureCode) {
  switch (code) {
    case "INSUFFICIENT_STORAGE": return "sys.backupFailureStorage";
    case "BACKUP_INTERRUPTED": return "sys.backupFailureInterrupted";
    case "BACKUP_FAILED": return "sys.backupFailureGeneric";
  }
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function SystemBackupPanel() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<BackupMode>("safe");
  const [migrationPassword, setMigrationPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [confirmedFullMode, setConfirmedFullMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingRebuild, setRetryingRebuild] = useState(false);
  const [formError, setFormError] = useState("");
  const [createError, setCreateError] = useState("");
  const [historyActionError, setHistoryActionError] = useState("");
  const [rebuildError, setRebuildError] = useState("");
  const [notice, setNotice] = useState("");

  const estimate = useQuery({
    queryKey: ["sys-system-backup-preflight", mode],
    queryFn: () => apiPost<BackupEstimate>("/api/v1/system/backups/preflight", { mode }),
    retry: false,
  });
  const backups = useQuery({
    queryKey: BACKUPS_KEY,
    queryFn: () => apiGet<BackupList>("/api/v1/system/backups"),
    retry: false,
    refetchInterval: (query) => query.state.data?.backups.some((backup) => isBackupActive(backup.status)) ? 1_500 : false,
  });
  const currentRestore = useQuery({
    queryKey: CURRENT_RESTORE_KEY,
    queryFn: () => apiGet<CurrentRestoreRebuild | null>("/api/v1/system/restores/current"),
    retry: false,
    refetchInterval: (query) => query.state.data?.rebuild && isRebuildActive(query.state.data.rebuild.status) ? 1_500 : false,
  });

  const clearCredentials = () => {
    setMigrationPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
    setTotpCode("");
  };

  const submitBackup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setCreateError("");
    setNotice("");
    if (migrationPassword.length < 12 || migrationPassword.length > 256) {
      setFormError(t("sys.backupPasswordLength"));
      return;
    }
    if (migrationPassword !== confirmPassword) {
      setFormError(t("sys.backupPasswordMismatch"));
      return;
    }
    if (!currentPassword) {
      setFormError(t("sys.backupCurrentPasswordRequired"));
      return;
    }
    if (mode === "full" && !confirmedFullMode) {
      setFormError(t("sys.backupFullConfirmationRequired"));
      return;
    }

    const body: {
      mode: BackupMode;
      migrationPassword: string;
      currentPassword: string;
      totpCode?: string;
    } = { mode, migrationPassword, currentPassword };
    if (totpCode.trim()) body.totpCode = totpCode.trim();

    setSubmitting(true);
    try {
      await apiPost<{ id: string; status: "PENDING" }>("/api/v1/system/backups", body);
      setNotice(t("sys.backupSubmitted"));
      await queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : t("sys.backupCreateFailed"));
    } finally {
      clearCredentials();
      setSubmitting(false);
    }
  };

  const downloadBackup = async (backup: BackupSummary) => {
    setDownloadingId(backup.id);
    setHistoryActionError("");
    try {
      const response = await fetch(`/api/v1/system/backups/${backup.id}/download`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        let message = t("sys.backupDownloadFailed");
        try {
          const payload = await response.json() as { message?: string };
          if (payload.message) message = payload.message;
        } catch { /* 代理或文件响应可能不是 JSON */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `feronavi-system-backup-${backup.id}.fnbak`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      await queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : t("sys.backupDownloadFailed"));
      await queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
    } finally {
      setDownloadingId(null);
    }
  };

  const deleteBackup = async (backup: BackupSummary) => {
    setDeletingId(backup.id);
    setHistoryActionError("");
    try {
      await apiDelete(`/api/v1/system/backups/${backup.id}`);
      await queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
    } catch (error) {
      setHistoryActionError(error instanceof ApiError ? error.message : t("sys.backupDeleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const retryRebuild = async () => {
    if (!currentRestore.data) return;
    setRetryingRebuild(true);
    setRebuildError("");
    try {
      const rebuild = await apiPost<PostRestoreRebuildSummary>(
        `/api/v1/system/restores/${currentRestore.data.packageId}/rebuild/retry`,
        {},
      );
      queryClient.setQueryData<CurrentRestoreRebuild>(CURRENT_RESTORE_KEY, {
        ...currentRestore.data,
        rebuild,
      });
    } catch (error) {
      setRebuildError(error instanceof ApiError ? error.message : t("sys.backupRebuildRetryFailed"));
    } finally {
      setRetryingRebuild(false);
    }
  };

  const modeOptions = [
    { value: "safe", label: t("sys.backupSafeMode") },
    { value: "full", label: t("sys.backupFullMode") },
  ];

  return (
    <section className="card sys-section sys-backup-panel" aria-labelledby="sys-system-backup-title">
      <div className="sys-section-head">
        <div>
          <h2 id="sys-system-backup-title">{t("sys.systemBackupTitle")}</h2>
          <p className="muted">{t("sys.systemBackupHint")}</p>
        </div>
      </div>

      <div className="sys-backup-estimate-controls">
        <Select
          ariaLabel={t("sys.backupMode")}
          label={t("sys.backupMode")}
          value={mode}
          options={modeOptions}
          onChange={(value) => {
            setMode(value as BackupMode);
            setFormError("");
            setCreateError("");
            setNotice("");
            setConfirmedFullMode(false);
          }}
        />
      </div>

      {mode === "full" && (
        <p className="sys-backup-risk" role="note">{t("sys.backupFullWarning")}</p>
      )}

      {estimate.isPending || estimate.isFetching ? (
        <p className="muted" role="status">{t("sys.backupEstimating")}</p>
      ) : estimate.isError ? (
        <div className="sys-backup-error" role="alert">
          <p>{estimate.error instanceof ApiError ? estimate.error.message : t("sys.backupEstimateFailed")}</p>
          <Button size="sm" onClick={() => void estimate.refetch()}>{t("sys.backupRetryEstimate")}</Button>
        </div>
      ) : estimate.data?.mode === mode ? (
        <div className="sys-backup-estimate" aria-live="polite">
          <div className="sys-backup-totals">
            <span>{formatNumber(estimate.data.totalRows, locale)} {t("sys.backupRowsUnit")}</span>
            <span>{formatNumber(estimate.data.blobCount, locale)} {t("sys.backupBlobsUnit")}</span>
            <span>{formatNumber(estimate.data.blobBytes, locale)} {t("sys.backupBytesUnit")}</span>
          </div>
          <div className="sys-backup-tables">
            <div>
              <h3>{t("sys.backupIncludedData")}</h3>
              {estimate.data.datasets.length ? (
                <ul className="sys-backup-data-list">
                  {estimate.data.datasets.map((dataset) => (
                    <li key={dataset.name}>
                      <code>{dataset.name}</code>
                      <span>{formatNumber(dataset.rows, locale)} {t("sys.backupRowsUnit")}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">{t("sys.backupNoIncludedData")}</p>}
            </div>
            <div>
              <h3>{t("sys.backupExcludedData")}</h3>
              {estimate.data.excludedData.length ? (
                <ul className="sys-backup-data-list sys-backup-exclusions">
                  {estimate.data.excludedData.map((item) => (
                    <li key={item.key}>
                      <code>{item.key}</code>
                      <span>{item.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">{t("sys.backupNoExcludedData")}</p>}
            </div>
          </div>
          {estimate.data.warnings.length > 0 && (
            <ul className="sys-backup-warnings">
              {estimate.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </div>
      ) : null}

      <form className="sys-backup-form" onSubmit={(event) => void submitBackup(event)}>
        {mode === "full" && (
          <label className="sys-backup-confirm">
            <input
              type="checkbox"
              checked={confirmedFullMode}
              onChange={(event) => setConfirmedFullMode(event.target.checked)}
            />
            <span>{t("sys.backupFullConfirmation")}</span>
          </label>
        )}
        <div className="sys-backup-form-grid">
          <TextInput
            label={t("sys.backupMigrationPassword")}
            type="password"
            autoComplete="new-password"
            maxLength={256}
            value={migrationPassword}
            onChange={(event) => { setMigrationPassword(event.target.value); setFormError(""); }}
          />
          <TextInput
            label={t("sys.backupConfirmPassword")}
            type="password"
            autoComplete="new-password"
            maxLength={256}
            value={confirmPassword}
            onChange={(event) => { setConfirmPassword(event.target.value); setFormError(""); }}
          />
          <TextInput
            label={t("sys.backupCurrentPassword")}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => { setCurrentPassword(event.target.value); setFormError(""); }}
          />
          <TextInput
            label={t("sys.backupTotp")}
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value)}
          />
        </div>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        {createError && <p className="field-error" role="alert">{createError}</p>}
        {notice && <p className="sys-backup-success" role="status">{notice}</p>}
        <div className="sys-backup-submit-row">
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={submitting}
            disabled={submitting || estimate.isError || !estimate.data || (mode === "full" && !confirmedFullMode)
              || !migrationPassword || !confirmPassword || !currentPassword}
          >
            {mode === "full" ? t("sys.backupCreateFull") : t("sys.backupCreateSafe")}
          </Button>
        </div>
      </form>

      <section className="sys-backup-history" aria-labelledby="sys-backup-history-title">
        <div className="sys-backup-subhead">
          <h3 id="sys-backup-history-title">{t("sys.backupHistory")}</h3>
          <Button size="sm" onClick={() => void backups.refetch()}>{t("common.reload")}</Button>
        </div>
        {backups.isError && <p className="field-error" role="alert">{t("sys.backupListFailed")}</p>}
        {historyActionError && <p className="field-error" role="alert">{historyActionError}</p>}
        {backups.isPending && <p className="muted" role="status">{t("common.loadingShort")}…</p>}
        {backups.data?.backups.length === 0 && <p className="muted">{t("sys.backupHistoryEmpty")}</p>}
        {backups.data && backups.data.backups.length > 0 && (
          <ul className="sys-backup-history-list">
            {backups.data.backups.map((backup) => {
              const expired = new Date(backup.expiresAt).getTime() <= Date.now();
              const ready = backup.status === "SUCCEEDED";
              const canDownload = ready && !expired && backup.downloadsRemaining > 0;
              return (
                <li className="sys-backup-history-row" key={backup.id}>
                  <div className="sys-backup-history-copy">
                    <div className="sys-backup-history-title">
                      <strong>{backup.mode === "full" ? t("sys.backupFullMode") : t("sys.backupSafeMode")}</strong>
                      <span className={`tag ${ready ? "tag-success" : backup.status === "FAILED" ? "tag-danger" : "tag-warning"}`}>
                        {t(`sys.backupStatus${backup.status}` as "sys.backupStatusPENDING")}
                      </span>
                    </div>
                    <p className="muted">
                      {t("sys.backupCreatedAt", { date: new Date(backup.createdAt).toLocaleString(locale) })}
                      {backup.bytes !== null && <> · {formatNumber(backup.bytes, locale)} {t("sys.backupBytesUnit")}</>}
                    </p>
                    {ready && (
                      <p className={expired || backup.downloadsRemaining === 0 ? "sys-backup-expired" : "muted"}>
                        {expired && <>{t("sys.backupExpired")} · </>}
                        {t("sys.backupDownloadsRemaining", { count: backup.downloadsRemaining })}
                        {" · "}{t("sys.backupExpiresAt", { date: new Date(backup.expiresAt).toLocaleString(locale) })}
                      </p>
                    )}
                    {backup.status === "FAILED" && (
                      <p className="sys-backup-failure">
                        {t(backupFailureMessageKey(backup.failureCode ?? "BACKUP_FAILED"))}
                      </p>
                    )}
                  </div>
                  <div className="sys-backup-actions">
                    {ready && (
                      <Button
                        size="sm"
                        disabled={!canDownload || downloadingId === backup.id}
                        loading={downloadingId === backup.id}
                        onClick={() => void downloadBackup(backup)}
                      >{t("sys.backupDownload")}</Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`${t("sys.backupDelete")} ${backup.id}`}
                      disabled={isBackupActive(backup.status) || deletingId === backup.id}
                      loading={deletingId === backup.id}
                      onClick={() => void deleteBackup(backup)}
                    >{t("sys.backupDelete")}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {currentRestore.data && (
        <section className="sys-backup-rebuild" aria-labelledby="sys-backup-rebuild-title">
          <div>
            <h3 id="sys-backup-rebuild-title">{t("sys.backupRebuildTitle")}</h3>
            <p className={currentRestore.data.rebuild.status === "FAILED" ? "field-error" : "muted"}
              role={currentRestore.data.rebuild.status === "FAILED" ? "alert" : "status"}>
              {currentRestore.data.rebuild.message}
            </p>
            {rebuildError && <p className="field-error" role="alert">{rebuildError}</p>}
          </div>
          {currentRestore.data.rebuild.canRetry && (
            <Button size="sm" variant="primary" loading={retryingRebuild} disabled={retryingRebuild}
              onClick={() => void retryRebuild()}>
              {t("sys.backupRebuildRetry")}
            </Button>
          )}
        </section>
      )}
      {currentRestore.isError && (
        <div className="sys-backup-error" role="alert">
          <p>{t("sys.backupRestoreStatusFailed")}</p>
          <Button size="sm" onClick={() => void currentRestore.refetch()}>{t("common.reload")}</Button>
        </div>
      )}
    </section>
  );
}
