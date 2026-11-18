import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEventHandler } from "react";
import { t } from "../../i18n/index.ts";
import { draftImageTokens, IMAGE_ACCEPT, removeDraftImage, type MarkdownImages } from "../../lib/useMarkdownImages.ts";
import { Field } from "./Field.tsx";
import { MarkdownView } from "./MarkdownView.tsx";
import { Button } from "./Button.tsx";
import { Icon } from "../Icon.tsx";

/** 三种图片入口共用草稿/校验逻辑；普通文本粘贴保持浏览器原生行为。 */
export function MarkdownEditor({
  label, value, onChange, images, disabled = false, placeholder, rows = 6, className = "", onKeyDown,
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
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
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
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const leading = block && before ? "\n".repeat(Math.max(0, 2 - (before.match(/\n*$/u)?.[0].length ?? 0))) : "";
    const trailing = block ? "\n".repeat(Math.max(0, 2 - (after.match(/^\n*/u)?.[0].length ?? 0))) : "";
    const inserted = `${leading}${content}${trailing}`;
    selection.current = start + inserted.length;
    // Chrome/Safari 的原生插入保留撤销栈；不支持时回退到受控值更新。
    if (!preview && area && typeof document.execCommand === "function") {
      area.focus();
      if (document.execCommand("insertText", false, inserted)) { onChange(area.value); return; }
    }
    setPreview(false);
    onChange(`${before}${inserted}${after}`);
  };
  const insertFiles = (files: File[], text = "") => {
    if (disabled || preview) return;
    const markdown = images.stage(files);
    insert([text, markdown].filter(Boolean).join("\n\n"), true);
  };
  const format = (prefix: string, suffix: string, fallback: string) => {
    const selected = value.slice(input.current?.selectionStart ?? 0, input.current?.selectionEnd ?? 0);
    insert(`${prefix}${selected || fallback}${suffix}`);
  };

  return <Field label={label} htmlFor={`${id}-input`} className={`md-editor-field ${className}`}>
    <div className={`md-editor${dragging ? " is-dragging" : ""}`} aria-busy={disabled || undefined}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); if (!disabled && !preview) { dragDepth.current++; setDragging(true); }
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); event.dataTransfer.dropEffect = disabled || preview ? "none" : "copy";
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
          <button type="button" className="ui-segmented-item" aria-pressed={!preview} onClick={() => switchMode(false)}>{t("md.write")}</button>
          <button type="button" className="ui-segmented-item" aria-pressed={preview} onClick={() => switchMode(true)}>{t("md.preview")}</button>
        </div>
        {!preview && <div className="md-editor-tools" role="group" aria-label={t("md.format")}>
            <Button size="sm" variant="ghost" iconOnly title={t("md.bold")} aria-label={t("md.bold")} disabled={disabled}
              onClick={() => format("**", "**", t("md.text"))}><strong aria-hidden="true">B</strong></Button>
            <Button size="sm" variant="ghost" iconOnly title={t("md.list")} aria-label={t("md.list")} disabled={disabled}
              onClick={() => insert(`- ${value.slice(input.current?.selectionStart ?? 0, input.current?.selectionEnd ?? 0) || t("md.listItem")}`, true)}><Icon name="list" size={15} /></Button>
          <Button size="sm" variant="ghost" disabled={disabled || !!images.disabledReason} title={images.disabledReason ?? undefined} onClick={() => picker.current?.click()}><Icon name="upload" size={14} />{t("md.insertImage")}</Button>
        </div>}
      </div>
      <input ref={picker} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label={t("md.chooseImages")} disabled={disabled || preview}
        onChange={(event) => { insertFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <textarea ref={input} id={`${id}-input`} className="textarea md-editor-input" rows={rows} value={value} disabled={disabled || preview}
        hidden={preview} placeholder={placeholder} aria-describedby={`${id}-hint`} onChange={(event) => { if (!disabled && !preview) onChange(event.target.value); }}
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
          {!preview && <Button size="sm" variant="ghost" iconOnly disabled={disabled} aria-label={t("md.removeImage", { name: image.file.name })}
            onClick={() => onChange(removeDraftImage(value, image.token))}><Icon name="x" size={14} /></Button>}
        </li>)}
      </ul>}
      <div className="md-editor-hint" id={`${id}-hint`}>{preview ? t("md.previewHint") : (images.disabledReason ?? t("md.hint"))}</div>
    </div>
    {images.error && <p className="field-error md-editor-error" role="alert">{images.error}</p>}
  </Field>;
}
