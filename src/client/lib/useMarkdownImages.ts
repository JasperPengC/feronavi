import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { apiUpload } from "./api.ts";
import { ActorContext } from "./actor.ts";
import { fromMarkdown } from "mdast-util-from-markdown";
import { t } from "../i18n/index.ts";

export interface DraftImage {
  token: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "uploaded" | "error";
  error?: string;
  uploaded?: { target: string; url: string };
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
function rewriteDraftImages(text: string, replacement: (markdown: string, token: string, image: { alt?: string | null; title?: string | null }) => string) {
  const root = fromMarkdown(text);
  const spans: { start: number; end: number; token: string; alt?: string | null; title?: string | null }[] = [];
  const visit = (node: typeof root | (typeof root.children)[number]) => {
    if (node.type === "image" && /^draft-image:[a-z0-9-]+$/u.test(node.url)
      && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      spans.push({ start: node.position.start.offset, end: node.position.end.offset, token: node.url, alt: node.alt, title: node.title });
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(root);
  // 按 Markdown 解析器的原文位置替换，保留代码、转义、空白与其他格式。
  let resolved = text;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    resolved = `${resolved.slice(0, span.start)}${replacement(text.slice(span.start, span.end), span.token, span)}${resolved.slice(span.end)}`;
  }
  return resolved;
}

export function draftImageTokens(text: string): string[] {
  const tokens = new Set<string>();
  rewriteDraftImages(text, (markdown, token) => { tokens.add(token); return markdown; });
  return [...tokens];
}

function imageMarkdown(name: string, token: string, title?: string | null) {
  const alt = name.replace(/[\r\n]/gu, " ").replace(/[\\[\]]/gu, "\\$&");
  const suffix = title ? ` "${title.replace(/[\r\n]/gu, " ").replace(/[\\"]/gu, "\\$&")}"` : "";
  return `![${alt}](${token}${suffix})`;
}

export function removeDraftImage(text: string, token: string) {
  return rewriteDraftImages(text, (markdown, reference) => reference === token ? "" : markdown);
}

/** 创建目标前不能保存浏览器临时地址；失败时已有记录仍保留用户输入的文字。 */
export function withoutDraftImages(text: string) {
  const resolved = rewriteDraftImages(text, () => "");
  return resolved === text ? text : resolved.trim();
}

export function useMarkdownImages({ newWorkItem = false }: { newWorkItem?: boolean } = {}) {
  const actor = useContext(ActorContext);
  const disabledReason = actor && (!actor.permissions.includes("attachment:upload")
    || (newWorkItem && !actor.permissions.some((permission) => ["work_item:update_own", "work_item:update_any"].includes(permission))))
    ? t("md.permissionRequired") : null;
  const store = useRef(new Map<string, DraftImage>());
  const [images, setImages] = useState<DraftImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const publish = useCallback(() => setImages([...store.current.values()].map((image) => ({ ...image }))), []);
  const reset = useCallback(() => {
    for (const image of store.current.values()) URL.revokeObjectURL(image.previewUrl);
    store.current.clear(); setImages([]); setError(null);
  }, []);
  useEffect(() => {
    const entries = store.current;
    return () => { for (const image of entries.values()) URL.revokeObjectURL(image.previewUrl); entries.clear(); };
  }, []);

  const stage = useCallback((files: File[]) => {
    if (disabledReason) { setError(disabledReason); return ""; }
    const failures: string[] = [];
    const inserted: string[] = [];
    for (let file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      let mime = file.type.toLowerCase();
      // 某些文件管理器不提供 MIME；仅从明确支持的扩展名补齐。
      if (!mime && IMAGE_TYPES[ext]) mime = IMAGE_TYPES[ext];
      if (!Object.values(IMAGE_TYPES).includes(mime) || (file.name.includes(".") && IMAGE_TYPES[ext] !== mime)) {
        failures.push(t("md.unsupported", { name: file.name })); continue;
      }
      if (!file.size || file.size > MAX_IMAGE_BYTES) {
        failures.push(t(file.size ? "md.tooLarge" : "md.emptyFile", { name: file.name })); continue;
      }
      // 截图剪贴板可能没有扩展名，按浏览器声明的图片 MIME 命名。
      const name = IMAGE_TYPES[ext] ? file.name : `${file.name || "screenshot"}.${Object.keys(IMAGE_TYPES).find((key) => IMAGE_TYPES[key] === mime)}`;
      if (name !== file.name || mime !== file.type) file = new File([file], name, { type: mime, lastModified: file.lastModified });
      const token = `draft-image:${crypto.randomUUID()}`;
      store.current.set(token, { token, file, previewUrl: URL.createObjectURL(file), status: "pending" });
      inserted.push(imageMarkdown(file.name, token));
    }
    setError(failures.length ? failures.join("\n") : null); publish();
    return inserted.join("\n\n");
  }, [publish, disabledReason]);

  const persist = useCallback(async (text: string, targetType: string, targetId: string) => {
    let resolved = text;
    const tokens = draftImageTokens(text);
    // 先检查所有引用，避免从另一份草稿粘贴来的失效链接触发部分上传。
    if (tokens.some((token) => !store.current.has(token))) throw new Error(t("md.missingImage"));
    for (const token of tokens) {
      const image = store.current.get(token)!;
      const target = `${targetType}:${targetId}`;
      if (image.uploaded?.target !== target) {
        image.status = "uploading"; image.error = undefined; publish();
        try {
          const form = new FormData();
          form.append("targetType", targetType); form.append("targetId", targetId); form.append("file", image.file);
          const uploaded = await apiUpload<{ id: string }>("/api/v1/uploads", form);
          image.uploaded = { target, url: `/api/v1/attachments/${uploaded.id}/preview` };
          image.status = "uploaded";
        } catch (cause) {
          image.status = "error"; image.error = cause instanceof Error ? cause.message : t("att.uploadFailed");
          publish(); throw new Error(t("md.uploadFailed", { name: image.file.name, error: image.error }), { cause });
        }
        publish();
      }
      resolved = rewriteDraftImages(resolved, (markdown, reference, node) => reference === token
        ? imageMarkdown(node.alt ?? "", image.uploaded!.url, node.title) : markdown);
    }
    return resolved;
  }, [publish]);

  return { images, error, disabledReason, stage, reset, persist };
}

export type MarkdownImages = ReturnType<typeof useMarkdownImages>;
