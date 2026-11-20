import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEventHandler } from "react";
import { t } from "../../i18n/index.ts";
import { draftImageTokens, IMAGE_ACCEPT, removeDraftImage, type MarkdownImages } from "../../lib/useMarkdownImages.ts";
import { Field } from "./Field.tsx";
import { MarkdownView } from "./MarkdownView.tsx";
import { Button } from "./Button.tsx";
import { Icon } from "../Icon.tsx";

/** 三种图片入口共用草稿/校验逻辑；普通文本粘贴保持浏览器原生行为。 */
export function MarkdownEditor({
  label, value, onChange, images, disabled = false, placeholder, rows = 6, className = "", onKeyDown, imageTarget,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  images: MarkdownImages;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  imageTarget?: { type: string; id: string };
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const active = useRef(true);
  const uploadLock = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const locked = disabled || uploading;
  const references = draftImageTokens(value);
  const referenced = images.images.filter((image) => references.includes(image.token));
  const previewUrls = new Map(referenced.map((image) => [image.token, image.previewUrl]));

  useLayoutEffect(() => {
    if (selection.current === null || preview) return;
    input.current?.focus();
    input.current?.setSelectionRange(selection.current, selection.current);
    selection.current = null;
  }, [value, preview]);

  const switchMode = (nextPreview: boolean) => {
    dragDepth.current = 0;
    setDragging(false);
    setPreview(nextPreview);
  };

  const insert = (content: string, block = false) => {
    if (disabled || preview || !content) return;
    const area = input.current;
    const current = area?.value ?? value;
    const start = area?.selectionStart ?? current.length;
    const end = area?.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const leading = block && before ? "\n".repeat(Math.max(0, 2 - (before.match(/\n*$/u)?.[0].length ?? 0))) : "";
    const trailing = block ? "\n".repeat(Math.max(0, 2 - (after.match(/^\n*/u)?.[0].length ?? 0))) : "";
    const inserted = `${leading}${content}${trailing}`;
    selection.current = start + inserted.length;
    // Chrome/Safari 的原生插入保留撤销栈；不支持时回退到受控值更新。
    if (!preview && area && !area.disabled && typeof document.execCommand === "function") {
      area.focus();
      // 上传期间正文不可聚焦，原生插入不能落到仍有焦点的标题等其他字段。
      if (document.activeElement === area && document.execCommand("insertText", false, inserted)) { onChange(area.value); return; }
    }
    setPreview(false);
    onChange(`${before}${inserted}${after}`);
  };
  const insertFiles = (files: File[], text = "") => {
    if (locked || preview || uploadLock.current) return;
    const markdown = images.stage(files);
    if (!imageTarget || !markdown) { insert([text, markdown].filter(Boolean).join("\n\n"), true); return; }
    uploadLock.current = true; setUploading(true); setUploadError(null);
    // 协作者无法读取本窗口的File/Blob；先取得受权限保护的附件地址，再进入共享Y.Text。
    void images.persist(markdown, imageTarget.type, imageTarget.id).then(resolved => {
      if (active.current) insert([text, resolved].filter(Boolean).join("\n\n"), true);
    }).catch((error: unknown) => {
      if (active.current) setUploadError(error instanceof Error ? error.message : t("att.uploadFailed"));
    }).finally(() => { uploadLock.current = false; if (active.current) setUploading(false); });
  };
  const format = (prefix: string, suffix: string, fallback: string) => {
    const selected = value.slice(input.current?.selectionStart ?? 0, input.current?.selectionEnd ?? 0);
    insert(`${prefix}${selected || fallback}${suffix}`);
  };

  return <Field label={label} htmlFor={`${id}-input`} className={`md-editor-field ${className}`}>
    <div className={`md-editor${dragging ? " is-dragging" : ""}`} aria-busy={locked || undefined}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); if (!locked && !preview) { dragDepth.current++; setDragging(true); }
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); event.dataTransfer.dropEffect = locked || preview ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false);
        insertFiles(Array.from(event.dataTransfer.files));
      }}>
      <div className="md-editor-toolbar">
        <div className="md-editor-modes ui-segmented ui-segmented--compact" role="group" aria-label={t("md.mode")}>
          <button type="button" className="ui-segmented-item" disabled={uploading} aria-pressed={!preview} onClick={() => switchMode(false)}>{t("md.write")}</button>
          <button type="button" className="ui-segmented-item" disabled={uploading} aria-pressed={preview} onClick={() => switchMode(true)}>{t("md.preview")}</button>
        </div>
        {!preview && <div className="md-editor-tools" role="group" aria-label={t("md.format")}>
            <Button size="sm" variant="ghost" iconOnly title={t("md.bold")} aria-label={t("md.bold")} disabled={locked}
              onClick={() => format("**", "**", t("md.text"))}><strong aria-hidden="true">B</strong></Button>
            <Button size="sm" variant="ghost" iconOnly title={t("md.list")} aria-label={t("md.list")} disabled={locked}
              onClick={() => insert(`- ${value.slice(input.current?.selectionStart ?? 0, input.current?.selectionEnd ?? 0) || t("md.listItem")}`, true)}><Icon name="list" size={15} /></Button>
          <Button size="sm" variant="ghost" disabled={locked || !!images.disabledReason} title={images.disabledReason ?? undefined} onClick={() => picker.current?.click()}><Icon name="upload" size={14} />{t("md.insertImage")}</Button>
        </div>}
      </div>
      <input ref={picker} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label={t("md.chooseImages")} disabled={locked || preview}
        onChange={(event) => { insertFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <textarea ref={input} id={`${id}-input`} className="textarea md-editor-input" rows={rows} value={value} disabled={locked || preview}
        hidden={preview} placeholder={placeholder} aria-describedby={`${id}-hint`} onChange={(event) => { if (!locked && !preview) onChange(event.target.value); }}
        onKeyDown={(event) => {
          if (preview) return;
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
            event.preventDefault(); format("**", "**", t("md.text"));
          } else onKeyDown?.(event);
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (!files.length) return;
          event.preventDefault(); insertFiles(files, event.clipboardData.getData("text/plain"));
        }} />
      {preview && <div className="md-editor-preview" role="region" aria-label={t("md.previewLabel")} tabIndex={0}>
        {value.trim() ? <MarkdownView text={value} draftImages={previewUrls} /> : <p className="muted">{t("md.emptyPreview")}</p>}
      </div>}
      {dragging && !preview && <div className="md-editor-drop" role="status"><Icon name="upload" size={24} /><span>{t("md.dropHere")}</span></div>}
      {referenced.length > 0 && <ul className="md-editor-images" aria-label={t("md.images")}>
        {referenced.map((image) => <li key={image.token} data-status={image.status}>
          <img src={image.previewUrl} alt="" />
          <div><span className="md-editor-image-name" title={image.file.name}>{image.file.name}</span>
            <span className="md-editor-image-status" role="status">{image.error ?? t(`md.${image.status}`)}</span></div>
          {!preview && <Button size="sm" variant="ghost" iconOnly disabled={locked} aria-label={t("md.removeImage", { name: image.file.name })}
            onClick={() => onChange(removeDraftImage(value, image.token))}><Icon name="x" size={14} /></Button>}
        </li>)}
      </ul>}
      <div className="md-editor-hint" id={`${id}-hint`}>{preview ? t("md.previewHint") : (images.disabledReason ?? t("md.hint"))}</div>
    </div>
    {uploading && <p role="status" className="muted">{t("md.uploading")}</p>}
    {uploadError && <p className="field-error md-editor-error" role="alert">{uploadError}</p>}
    {images.error && <p className="field-error md-editor-error" role="alert">{images.error}</p>}
  </Field>;
}
