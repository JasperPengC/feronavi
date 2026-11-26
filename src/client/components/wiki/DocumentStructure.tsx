import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../lib/api.ts";
import { Modal } from "../ui/Modal.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Button } from "../ui/Button.tsx";
import { Select } from "../Select.tsx";
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";

export interface PageRow {
  id: string; title: string; slug: string; parentId: string | null;
  visibility: "PROJECT" | "RESTRICTED"; sortOrder: number; currentRevisionId: string | null;
  updatedAt: string | null; kind: "DOCUMENT" | "FOLDER"; structureVersion: number;
  archivedAt: string | null; isArchived: boolean;
}

/** 只从当前用户可见节点构建路径；不可见祖先不以名称或占位符泄露。 */
export function documentTrail(node: PageRow, pages: PageRow[]): PageRow[] {
  const byId = new Map(pages.map(page => [page.id, page]));
  const trail = [node], seen = new Set([node.id]);
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    trail.unshift(parent); seen.add(parent.id);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return trail;
}

export function DocumentBreadcrumbs({ page, pages, onSelect }: { page: PageRow; pages: PageRow[]; onSelect: (id: string) => void }) {
  return <nav className="wiki-breadcrumbs" aria-label={t("wk.folderPath")}>
    <span>{t(page.isArchived ? "wk.archived" : "wk.contents")}</span>
    {documentTrail(page, pages).map(node => <span key={node.id}>
      <Icon name="chevron-right" size={12} />
      {node.id === page.id ? <span aria-current="page">{node.title}</span> : <button type="button" onClick={() => onSelect(node.id)}>{node.title}</button>}
    </span>)}
  </nav>;
}

export function FolderContents({ pages, onSelect }: { pages: PageRow[]; onSelect: (id: string) => void }) {
  return <div className="wiki-folder-content">
    <div className="wiki-folder-list-head"><span>{t("wk.folderName")}</span><span>{t("wk.updated")}</span></div>
    {pages.length === 0 && <p className="muted wiki-folder-empty">{t("wk.folderEmpty")}</p>}
    {pages.map(page => <button type="button" className="wiki-folder-row" key={page.id} onClick={() => onSelect(page.id)}>
      <Icon name={page.kind === "FOLDER" ? "folder" : "file"} size={18} />
      <span className="wiki-folder-row-name">{page.title}</span>
      {page.visibility === "RESTRICTED" && <span className="tag tag-warning">{t("wk.restricted")}</span>}
      <time>{page.updatedAt ? new Date(page.updatedAt).toLocaleDateString() : "—"}</time>
      <Icon name="chevron-right" size={14} />
    </button>)}
  </div>;
}

export function DocumentOrganizeDialog({ mode, target, pages, projectId, onClose, onSuccess }: {
  mode: "folder" | "organize"; target: PageRow | null; pages: PageRow[]; projectId: string;
  onClose: () => void; onSuccess: (page: PageRow) => Promise<void>;
}) {
  const [title, setTitle] = useState(mode === "folder" ? "" : target?.title ?? "");
  const [parentId, setParentId] = useState(mode === "folder" && target?.kind === "FOLDER" ? target.id : target?.parentId ?? "");
  const candidates = pages.filter(page => !page.isArchived && (mode === "folder" || !documentTrail(page, pages).some(ancestor => ancestor.id === target?.id)));
  const mutation = useMutation({
    mutationFn: () => mode === "folder"
      ? apiPost<PageRow>(`/api/v1/projects/${projectId}/pages`, { kind: "FOLDER", title: title.trim(), parentId: parentId || null })
      : apiPatch<PageRow>(`/api/v1/pages/${target!.id}/structure`, { title: title.trim(), parentId: parentId || null, expectedStructureVersion: target!.structureVersion }),
    onSuccess: async page => { await onSuccess(page); onClose(); },
  });
  return <Modal open title={t(mode === "folder" ? "wk.newFolder" : "wk.organize")} onClose={() => { if (!mutation.isPending) onClose(); }} width="sm"
    footer={<><Button onClick={onClose} disabled={mutation.isPending}>{t("common.cancel")}</Button>
      <Button variant="primary" loading={mutation.isPending} disabled={!title.trim()} onClick={() => mutation.mutate()}>{t("common.save")}</Button></>}>
    <form onSubmit={event => { event.preventDefault(); if (title.trim() && !mutation.isPending) mutation.mutate(); }}>
      <TextInput label={t("wk.folderName")} autoFocus maxLength={300} value={title} onChange={event => setTitle(event.target.value)} disabled={mutation.isPending} />
      <div className="field"><span className="field-label">{t("wk.destination")}</span>
        <Select ariaLabel={t("wk.destination")} value={parentId} onChange={setParentId} disabled={mutation.isPending}
          options={[{ value: "", label: t("wk.rootFolder") }, ...candidates.map(page => ({ value: page.id, label: documentTrail(page, pages).map(node => node.title).join(" / ") }))]} />
      </div>
      <p className="muted">{t("wk.structureHint")}</p>
      {mutation.isError && <p className="alert alert-error" role="alert">{mutation.error.message}</p>}
    </form>
  </Modal>;
}
