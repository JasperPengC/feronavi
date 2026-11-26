/**
 * 附件面板：上传 / 列表 / 下载 / 预览 / 删除。
 * 后端接口早已存在但全站没有入口；这里接在工作项详情里，复用服务端的白名单与权限校验。
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiUpload, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { confirmDialog } from "../Dialog.tsx";
import { Icon } from "../Icon.tsx";

interface AttachmentRow {
  id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string;
}

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsPanel({ targetType, targetId, readOnly = false }: { targetType: string; targetId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);

  const q = useQuery({
    queryKey: ["attachments", targetType, targetId],
    queryFn: () => apiGet<AttachmentRow[]>("/api/v1/attachments", { targetType, targetId }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/attachments/${id}`),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["attachments", targetType, targetId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("att.deleteFailed")),
  });

  async function upload(files: FileList | null) {
    if (readOnly || !files?.length || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true); setError(null);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(t("md.tooLarge", { name: file.name }));
        const form = new FormData();
        form.append("targetType", targetType);
        form.append("targetId", targetId);
        form.append("file", file);
        await apiUpload("/api/v1/uploads", form);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("att.uploadFailed"));
    } finally {
      await qc.invalidateQueries({ queryKey: ["attachments", targetType, targetId] });
      uploadLock.current = false;
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const rows = Array.isArray(q.data) ? q.data : [];
  return (
    <section className="wi-attachments">
      <div className="wi-attachments-head">
        <h3 className="wi-drawer__title" style={{ margin: 0 }}>{t("att.title")}</h3>
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("att.hint")}</span>
        <span style={{ flex: 1 }} />
        {!readOnly && <><input ref={inputRef} type="file" multiple hidden disabled={uploading} aria-label={t("att.choose")}
          onChange={(e) => void upload(e.target.files)} />
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Icon name="upload" size={14} />{uploading ? t("att.uploading") : t("att.upload")}
        </Button></>}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {q.isLoading && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("common.loading")}</p>}
      {q.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void q.refetch()} actionLabel={t("common.reload")} />}
      {q.isSuccess && rows.length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("att.empty")}</p>}
      <ul className="wi-attachment-list">
        {rows.map((a) => {
          const previewable = a.mimeType.startsWith("image/") || a.mimeType === "application/pdf";
          return (
            <li key={a.id}>
              <span className="wi-attachment-icon" aria-hidden="true"><Icon name="file" size={14} /></span>
              <span className="wi-attachment-name" title={a.originalName}>{a.originalName}</span>
              <span className="muted wi-attachment-meta">{humanSize(a.sizeBytes)}</span>
              <a className="btn-link" href={`/api/v1/attachments/${a.id}`} download>{t("att.download")}</a>
              {previewable && <a className="btn-link" href={`/api/v1/attachments/${a.id}/preview`} target="_blank" rel="noreferrer">{t("att.preview")}</a>}
              {!readOnly && <Button size="sm" variant="ghost" disabled={remove.isPending}
                onClick={async () => { if (await confirmDialog(t("att.deleteConfirm"), { danger: true })) remove.mutate(a.id); }}>
                {t("common.delete")}
              </Button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
