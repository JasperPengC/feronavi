import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * 导入向导（第九期 W7，四步：上传 → 映射 → 试运行 → 确认）
 *
 * 三处刻意的设计：
 *   1 映射步骤把「用户映射」单独列出并要求逐个确认 —— 规范明确人名到 ID 不许自动猜（重名/离职/外部人员）
 *   2 试运行结果用「将创建 / 将跳过（已导入过）/ 失败」三栏，**先看统计再决定**
 *   3 回滚按钮旁写明「该批次数据及其后续修改都会被删除」（规范要求明示，这不是 bug 是既定语义）
 */
import { useRef, useState } from "react";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { useParams } from "@tanstack/react-router";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiUpload, ApiError } from "../lib/api.ts";
import { PageHead } from "../components/Page.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { t, useLocale } from "../i18n/index.ts";
import { Select } from "../components/Select.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { Button } from "../components/ui/Button.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";

interface Batch {
  id: string; status: string; filename: string | null; totalRows: number;
  createdCount: number; failedCount: number; header?: string[]; encoding?: string | null;
}
interface DryResult { totalRows: number; willCreate: number; willSkip: number; failed: number; errorReport: { index: number; reason?: string; externalId?: string }[] }
interface BatchDetail extends Batch {
  header: string[];
  fieldMap: Record<string, string>;
  mappingConfig?: {
    externalIdColumn?: string | null;
    userMap?: Record<string, string>;
    valueMaps?: Record<string, Record<string, string>>;
    defaultType?: string;
  };
}
interface ImportResult { created: number; skipped: number; failed: number; status: string }
type ImportStep = 0 | 1 | 2 | 3;

/**
 * 映射目标：**这里只存词典键，不存文案**。
 * ⚠️ 曾经写成 `["title", t("im.fTitle")]` —— 那是**模块级调用 t()**，文案在模块加载时就被固化，
 * 用户切换语言后这些下拉项**不会跟着变**（同一类"读不到最新状态"的缺陷）。
 * 正确做法：常量存键，**渲染时再翻译**。
 */
const TARGETS: [string, string][] = [
  ["", "im.skip"], ["title", "im.fTitle"], ["description", "im.fDesc"], ["type", "im.fType"],
  ["priority", "im.fPriority"], ["severity", "im.fSeverity"], ["assignee", "im.fAssignee"],
  ["start_date", "im.fStart"], ["due_date", "im.fDue"], ["estimate_points", "im.fPoints"],
];
const STATUS_KEYS: Record<string, string> = {
  DRY_RUN: "im.sPending", PENDING_CONFIRM: "im.sConfirm", RUNNING: "im.sWriting",
  SUCCEEDED: "im.sDone", PARTIAL: "im.sPartial", FAILED: "im.sFailed", ROLLED_BACK: "im.sRolledBack",
};

function statusLabel(status: string) { return STATUS_KEYS[status] ? t(STATUS_KEYS[status]!) : status; }
function mappingSignature(fieldMap: Record<string, string>, externalIdColumn: string) {
  return JSON.stringify([Object.entries(fieldMap).filter(([, target]) => target).sort(([a], [b]) => a.localeCompare(b)), externalIdColumn]);
}
function ImportSteps({ step }: { step: ImportStep }) {
  return <ol className="import-flow-steps" aria-label={t("im.wizardLabel")}>
    {["im.progressPick", "im.progressMap", "im.progressValidate", "im.progressConfirm"].map((key, index) => (
      <li key={key} aria-current={step === index ? "step" : undefined} data-complete={index < step || undefined}>
        <span className="import-step-number" aria-hidden="true">{index + 1}</span><span>{t(key)}</span>
      </li>
    ))}
  </ol>;
}

export function ImportPage() {
  useLocale();
  const { projectId } = useParams({ from: "/_app/projects/$projectId/import" });
  return <ImportWorkspace key={projectId} projectId={projectId} />;
}

function ImportWorkspace({ projectId }: { projectId: string }) {
  const [section, setSection] = useState("import");
  const qc = useQueryClient();
  const writePending = useIsMutating({ mutationKey: ["import-write", projectId] }) > 0;
  const [batchId, setBatchId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const batches = useQuery({
    queryKey: ["imports", projectId],
    queryFn: () => apiGet<{ batches: Batch[] }>(`/api/v1/projects/${projectId}/imports`),
  });
  const upload = useMutation({
    mutationFn: async (selectedFile: File) => {
      const fd = new FormData();
      fd.append("file", selectedFile);
      return apiUpload<{ batchId: string }>(`/api/v1/projects/${projectId}/imports`, fd);
    },
    onSuccess: async (result) => {
      setUploadError(null); setFile(null); setBatchId(result.batchId);
      await qc.invalidateQueries({ queryKey: ["imports", projectId] });
    },
    onError: (error) => setUploadError(error instanceof Error && error.message ? error.message : t("im.uploadFailed")),
  });
  const rollback = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/imports/${id}/rollback`, {}),
    onSuccess: async (_, id) => {
      toast.success(t("im.rolledBack"));
      if (id === batchId) setBatchId(null);
      await qc.invalidateQueries({ queryKey: ["imports", projectId] });
      await qc.invalidateQueries({ queryKey: ["import", id] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("im.rollbackFailed")),
  });
  const newBatch = () => { setBatchId(null); setFile(null); setUploadError(null); };
  const items = batches.data?.batches ?? [];

  return <div className={`page project-refinement import-page import-workspace${section === "history" ? " data-page" : ""}`}>
    <PageHead title={t("im.title")} actions={batchId ? <Button disabled={writePending} onClick={() => { newBatch(); setSection("import"); }}>{t("im.newBatch")}</Button> : undefined} />
    <PageTabs id="import" label={t("im.title")} value={section} onChange={setSection} tabs={[
      { value: "import", label: t("sections.import") }, { value: "history", label: t("im.historyTitle") },
    ]} />
    <TabPanel tabsId="import" value="import" activeValue={section}>
      <div className="import-flow">
        {batchId ? <ImportBatch key={batchId} batchId={batchId} projectId={projectId} /> : <>
          <ImportSteps step={0} />
          <section className="import-flow-panel" aria-labelledby="import-upload-title">
            <h2 id="import-upload-title">{t("im.step1")}</h2>
            <p className="import-description">{t("im.fileHint")}</p>
            <label className="import-file-picker" data-has-file={!!file}>
              <input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={t("imp.chooseFile")} disabled={upload.isPending}
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0] ?? null;
                  const invalid = selectedFile && (!/\.(csv|xlsx)$/iu.test(selectedFile.name) ? "im.fileUnsupported" : selectedFile.size > 20 * 1024 * 1024 ? "im.fileTooLarge" : null);
                  setFile(invalid ? null : selectedFile); setUploadError(invalid ? t(invalid) : null);
                  if (invalid) event.target.value = "";
                }} />
              <Icon name="file" size={24} />
              <span>{file ? t("im.fileReady", { name: file.name }) : t("imp.chooseFile")}</span>
              <small>CSV / XLSX</small>
            </label>
            {uploadError && <p className="field-error" role="alert">{uploadError}</p>}
            <div className="import-flow-actions">
              <Button variant="primary" loading={upload.isPending} disabled={!file}
                onClick={() => { if (file && !upload.isPending) upload.mutate(file); }}><Icon name="upload" size={14} />{t("im.upload")}</Button>
            </div>
          </section>
        </>}
      </div>

    </TabPanel>
    <TabPanel tabsId="import" value="history" activeValue={section}>
      <section className="import-history data-fill" aria-labelledby="import-history-title">
        <div className="import-section-heading">
          <h2 id="import-history-title">{t("im.historyTitle")}</h2><p>{t("im.historyHint")}</p>
        </div>
        {batches.isLoading ? <StateBlock kind="loading" title={t("common.loading")} />
          : batches.isError ? <StateBlock kind="error" title={t("im.historyLoadFailed")} action={() => void batches.refetch()} actionLabel={t("common.reload")} />
            : items.length === 0 ? <p className="import-history-empty">{t("im.noBatches")}</p>
              : <TableScroll label={t("im.historyTitle")} resetKey={projectId}>
        <table className="import-history-table">
                <thead><tr><th>{t("im.colFile")}</th><th>{t("im.colStatus")}</th><th>{t("im.colResult")}</th><th className="table-actions">{t("im.actions")}</th></tr></thead>
                <tbody>{items.map((batch) => <tr key={batch.id} data-selected={batchId === batch.id || undefined}>
                  <td data-label={t("im.colFile")}><div className="row-title">
                    <span className="row-avatar" aria-hidden="true"><Icon name="file" size={14} /></span>
                    <span className="row-name">{batch.filename ?? t("im.untitled")}</span>
                  </div></td>
                  <td data-label={t("im.colStatus")}><span className={`status-pill ${batch.status === "SUCCEEDED" ? "dot-green" : batch.status === "FAILED" ? "dot-red" : "dot-amber"}`}>{statusLabel(batch.status)}</span></td>
                  <td data-label={t("im.colResult")} className="import-batch-summary">{t("im.batchSummary", { created: String(batch.createdCount), failed: String(batch.failedCount), total: String(batch.totalRows) })}</td>
                  <td data-label={t("im.actions")}><div className="import-batch-actions">
                    <Button size="sm" disabled={upload.isPending || rollback.isPending || writePending} onClick={() => { setBatchId(batch.id); setUploadError(null); setSection("import"); }}>{t("im.view")}</Button>
                    {["SUCCEEDED", "PARTIAL", "FAILED"].includes(batch.status) && <Button size="sm" variant="danger" disabled={rollback.isPending || writePending} title={t("imp.rollbackWarn")}
                      onClick={async () => { if (await confirmDialog(t("im.rollbackConfirm"), { danger: true })) rollback.mutate(batch.id); }}>{t("im.rollback")}</Button>}
                  </div></td>
                </tr>)}</tbody>
              </table>
        </TableScroll>}
      </section>
    </TabPanel>
  </div>;
}

function ImportBatch({ batchId, projectId }: { batchId: string; projectId: string }) {
  const detail = useQuery({ queryKey: ["import", batchId], queryFn: () => apiGet<BatchDetail>(`/api/v1/imports/${batchId}`) });
  if (detail.isLoading) return <><ImportSteps step={1} /><StateBlock kind="loading" title={t("common.loading")} /></>;
  if (detail.isError || !detail.data) return <StateBlock kind="error" title={t("im.batchLoadFailed")} action={() => void detail.refetch()} actionLabel={t("common.reload")} />;
  // The keyed workspace owns drafts and previews; responses from a previous batch cannot enter this one.
  return <ImportBatchSession key={batchId} batch={detail.data} projectId={projectId} />;
}

function ImportBatchSession({ batch, projectId }: { batch: BatchDetail; projectId: string }) {
  const qc = useQueryClient();
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(() => ({ ...batch.fieldMap }));
  const [externalIdColumn, setExternalIdColumn] = useState(batch.mappingConfig?.externalIdColumn ?? "");
  const [savedSignature, setSavedSignature] = useState(() => mappingSignature(batch.fieldMap, batch.mappingConfig?.externalIdColumn ?? ""));
  const [preview, setPreview] = useState<{ signature: string; result: DryResult } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<ImportStep>(() => ["SUCCEEDED", "PARTIAL", "FAILED", "ROLLED_BACK", "RUNNING"].includes(batch.status) ? 3 : Object.values(batch.fieldMap).includes("title") ? 2 : 1);
  const confirmLock = useRef(false);
  const signature = mappingSignature(fieldMap, externalIdColumn);
  const targets = Object.values(fieldMap).filter(Boolean);
  const missingTitle = !targets.includes("title");
  const duplicateTargets = new Set(targets).size !== targets.length;
  const mappingChanged = signature !== savedSignature;
  const readOnly = !!result || ["SUCCEEDED", "ROLLED_BACK", "RUNNING"].includes(batch.status);
  const validPreview = preview?.signature === signature && !mappingChanged ? preview.result : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["imports", projectId] });
  const onError = (cause: unknown, key: string) => setError(cause instanceof ApiError ? cause.message : t(key));

  const saveMapping = useMutation({
    mutationKey: ["import-write", projectId],
    mutationFn: (snapshot: { fieldMap: Record<string, string>; externalIdColumn: string; signature: string }) => apiPut(`/api/v1/imports/${batch.id}/mapping`, {
      fieldMap: Object.fromEntries(Object.entries(snapshot.fieldMap).filter(([, target]) => target)),
      externalIdColumn: snapshot.externalIdColumn || null,
      userMap: batch.mappingConfig?.userMap ?? {}, valueMaps: batch.mappingConfig?.valueMaps ?? {}, defaultType: batch.mappingConfig?.defaultType ?? "TASK",
    }),
    onSuccess: (_, snapshot) => {
      qc.setQueryData<BatchDetail>(["import", batch.id], (current) => current ? {
        ...current, status: "PENDING_CONFIRM",
        fieldMap: Object.fromEntries(Object.entries(snapshot.fieldMap).filter(([, target]) => target)),
        mappingConfig: { ...current.mappingConfig, externalIdColumn: snapshot.externalIdColumn || null },
      } : current);
      setSavedSignature(snapshot.signature); setPreview(null); setError(null); setStep(2);
      toast.success(t("im.mappingSaved")); void refresh();
    },
    onError: (cause) => onError(cause, "im.saveMappingFailed"),
  });
  const runDry = useMutation({
    mutationFn: (_signature: string) => apiPost<DryResult>(`/api/v1/imports/${batch.id}/dry-run`, {}),
    onSuccess: (data, checkedSignature) => { setPreview({ signature: checkedSignature, result: data }); setStep(3); setError(null); void refresh(); },
    onError: (cause) => onError(cause, "im.dryRunFailed"),
  });
  const confirm = useMutation({
    mutationKey: ["import-write", projectId],
    mutationFn: () => apiPost<ImportResult>(`/api/v1/imports/${batch.id}/confirm`, {}),
    onSuccess: (data) => {
      setResult(data); setPreview(null); setError(null);
      qc.setQueryData<BatchDetail>(["import", batch.id], (current) => current ? { ...current, status: data.status, createdCount: data.created, failedCount: data.failed } : current);
      toast.success(t("im.importComplete")); void refresh();
    },
    onError: (cause) => { setPreview(null); setStep(2); onError(cause, "im.writeFailed"); void qc.invalidateQueries({ queryKey: ["import", batch.id] }); void refresh(); },
    onSettled: () => { confirmLock.current = false; },
  });
  const busy = saveMapping.isPending || runDry.isPending || confirm.isPending;
  const canValidate = !busy && !readOnly && !missingTitle && !duplicateTargets && !mappingChanged;
  const editMapping = () => { if (!busy && !readOnly) { setStep(1); setError(null); } };
  const changeMapping = (column: string, target: string) => { setFieldMap((current) => ({ ...current, [column]: target })); setPreview(null); setError(null); };
  const validate = () => { if (canValidate) { setPreview(null); setStep(2); setError(null); runDry.mutate(signature); } };
  const confirmImport = () => {
    if (confirmLock.current || busy || readOnly || !validPreview || validPreview.willCreate <= 0) return;
    confirmLock.current = true;
    confirm.mutate();
  };

  return <>
    <ImportSteps step={step} />
    <section className="import-flow-panel" aria-busy={busy || undefined}>
      <div className="import-current-file"><Icon name="file" size={18} /><strong>{batch.filename ?? t("im.untitled")}</strong>
        <span>{t("im.batchRows", { count: String(batch.totalRows) })}</span>
        {batch.encoding && <span>{t("im.encoding", { encoding: batch.encoding })}</span>}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {step === 1 && <>
        <h2>{t("im.step2")}</h2><p className="import-description">{t("im.mapHint")}</p>
        <div className="import-mapping-grid">
          <div className="import-mapping-head" aria-hidden="true"><span>{t("im.mapSource")}</span><span>{t("im.mapTarget")}</span></div>
          {batch.header.map((column) => <div className="import-mapping-row" key={column}>
            <span className="import-source-column">{column}</span>
            <Select ariaLabel={t("im.mapTo", { column })} value={fieldMap[column] ?? ""} disabled={busy || readOnly} onChange={(target) => changeMapping(column, target)}
              options={TARGETS.map(([value, key]) => ({ value, label: t(key) }))} />
          </div>)}
        </div>
        <div className="import-external-id"><Select label={t("im.externalId")} ariaLabel={t("imp.externalIdColumn")} value={externalIdColumn} disabled={busy || readOnly}
          onChange={(value) => { setExternalIdColumn(value); setPreview(null); setError(null); }}
          options={[{ value: "", label: t("im.noExternalId") }, ...batch.header.map((value) => ({ value, label: value }))]} /></div>
        {missingTitle && <p className="import-validation-message">{t("im.needTitle")}</p>}
        {duplicateTargets && <p className="field-error" role="alert">{t("im.duplicateMapping")}</p>}
        {mappingChanged && !missingTitle && !duplicateTargets && <p className="import-validation-message">{t("im.mappingChanged")}</p>}
        <div className="import-flow-actions"><Button variant="primary" loading={saveMapping.isPending} disabled={busy || readOnly || missingTitle || duplicateTargets}
          onClick={() => saveMapping.mutate({ fieldMap: { ...fieldMap }, externalIdColumn, signature })}>{t("im.saveMapping")}</Button></div>
      </>}
      {step === 2 && <>
        <h2>{t("im.step3")}</h2><p className="import-description">{t("im.validationHint")}</p>
        <dl className="import-mapping-summary">{Object.entries(fieldMap).filter(([, target]) => target).map(([column, target]) =>
          <div key={column}><dt>{column}</dt><dd>{t(TARGETS.find(([value]) => value === target)?.[1] ?? target)}</dd></div>)}</dl>
        <div className="import-flow-actions"><Button disabled={busy || readOnly} onClick={editMapping}>{t("im.editMapping")}</Button>
          <Button variant="primary" loading={runDry.isPending} disabled={!canValidate} onClick={validate}>{t("im.dryRun")}</Button></div>
      </>}
      {step === 3 && <>
        <h2>{result ? t("im.importComplete") : t("im.confirmTitle")}</h2>
        {validPreview ? <>
          <div className="import-validation-summary" role="status">
            <strong>{t("im.willCreate", { count: String(validPreview.willCreate) })}</strong>
            <span>{t("im.willSkip", { count: String(validPreview.willSkip) })}</span>
            <span data-error={validPreview.failed > 0 || undefined}>{t("im.failedRows", { count: String(validPreview.failed) })}</span>
          </div>
          {validPreview.failed > 0 && <p className="import-description">{t("im.validationFailedRows")}</p>}
          {validPreview.errorReport.length > 0 && <>
            <p className="import-error-summary">{t("im.errorSummary", { shown: String(Math.min(20, validPreview.errorReport.length)), total: String(validPreview.failed) })}</p>
            <TableScroll className="import-errors-scroll" label={t("im.colResult")}><table className="import-error-table">
              <thead><tr><th>{t("im.colRow")}</th><th>{t("im.colExternalId")}</th><th>{t("im.colReason")}</th></tr></thead>
              <tbody>{validPreview.errorReport.slice(0, 20).map((row, index) => <tr key={`${row.index}-${index}`}><td data-label={t("im.colRow")}>{row.index}</td><td data-label={t("im.colExternalId")}>{row.externalId ?? "—"}</td><td data-label={t("im.colReason")}>{row.reason ?? "—"}</td></tr>)}</tbody>
            </table></TableScroll>
          </>}
          {validPreview.willCreate === 0 && <p className="import-validation-message">{t("im.nothingToImport")}</p>}
          <div className="import-flow-actions"><Button disabled={busy} onClick={editMapping}>{t("im.editMapping")}</Button>
            <Button disabled={!canValidate} onClick={validate}>{t("im.revalidate")}</Button>
            {validPreview.willCreate > 0 && <Button variant="primary" loading={confirm.isPending} disabled={busy || readOnly} onClick={confirmImport}>{t("im.confirmCount", { count: String(validPreview.willCreate) })}</Button>}
          </div>
        </> : result ? <p className="import-result" role="status">{t("im.resultSummary", { created: String(result.created), skipped: String(result.skipped), failed: String(result.failed) })}</p>
          : <div className="import-result"><span className="status-pill">{statusLabel(batch.status)}</span><p>{t("im.batchSummary", { created: String(batch.createdCount), failed: String(batch.failedCount), total: String(batch.totalRows) })}</p>
            {readOnly ? <p className="import-description">{t("im.batchReadOnly")}</p> : <Button onClick={editMapping}>{t("im.editMapping")}</Button>}
          </div>}
      </>}
    </section>
  </>;
}
