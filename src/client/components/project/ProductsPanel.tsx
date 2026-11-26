import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "../../lib/api.ts";
import type { ProductSummary } from "../../../shared/schemas/product.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { Select } from "../Select.tsx";
import { confirmDialog } from "../Dialog.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";

const endpoint = (projectId: string) => `/api/v1/projects/${projectId}/products`;
export function ProductsPanel({ open, projectId, canCreate, onClose }: { open: boolean; projectId: string; canCreate: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<ProductSummary | null | undefined>(undefined);
  const [linking, setLinking] = useState(false);
  const query = useQuery({ queryKey: ["project-products", projectId], enabled: open, retry: false,
    queryFn: () => apiGet<{ products: ProductSummary[] }>(endpoint(projectId), { includeArchived: true }).then(r => r.products) });
  const refresh = async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["project-products"] }), qc.invalidateQueries({ queryKey: ["product-detail"] })]); };
  const lifecycle = useMutation({ mutationFn: ({ row, unlink }: { row: ProductSummary; unlink?: boolean }) => unlink
    ? apiPost(endpoint(projectId) + `/${row.id}/unlink`, { expectedVersion: row.version })
    : apiPatch(endpoint(projectId) + `/${row.id}`, { archived: !row.archivedAt, expectedVersion: row.version }), onSuccess: refresh });
  const rows = (query.data ?? []).filter(row => archived || !row.archivedAt);
  return <Drawer open={open} title={t("product.title")} onClose={() => { if (!lifecycle.isPending) onClose(); }} width="lg">
    <p className="muted product-intro">{t("product.intro")}</p>
    <div className="product-toolbar">
      <Checkbox checked={archived} onChange={setArchived} label={t("product.includeArchived")} />
      {canCreate && <div><Button onClick={() => setLinking(true)}>{t("product.link")}</Button><Button variant="primary" onClick={() => setEditing(null)}>{t("product.create")}</Button></div>}
    </div>
    {query.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
    {query.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void query.refetch()} actionLabel={t("common.reload")} />}
    {query.isSuccess && !rows.length && <StateBlock kind="empty" title={t("product.empty")} />}
    {lifecycle.isError && <p className="alert alert-error" role="alert">{lifecycle.error.message}</p>}
    <ul className="product-list">{rows.map(row => <li key={row.id}>
      <div className="product-row-main"><strong title={row.name}>{row.name}</strong><span className={`tag ${row.archivedAt ? "" : "tag-success"}`}>{t(row.archivedAt ? "product.archived" : "product.active")}</span>
        <span className="muted">{t("product.requirements", { n: row.requirementCount })}</span></div>
      {row.description && <p className="product-description">{row.description}</p>}
      <div className="product-row-actions">{row.canManage ? <>
        {!row.archivedAt && <Button size="sm" aria-label={t("product.editLabel", { name: row.name })} onClick={() => setEditing(row)}>{t("common.edit")}</Button>}
        <Button size="sm" disabled={lifecycle.isPending} onClick={async () => {
          if (row.archivedAt || await confirmDialog(t("product.archiveHint"))) lifecycle.mutate({ row });
        }}>{t(row.archivedAt ? "product.restore" : "product.archive")}</Button>
        {row.canUnlink && <Button size="sm" variant="ghost" disabled={lifecycle.isPending} onClick={async () => {
          if (await confirmDialog(t("product.unlinkHint"))) lifecycle.mutate({ row, unlink: true });
        }}>{t("product.unlink")}</Button>}
      </> : <span className="muted">{t("product.readOnly")}</span>}</div>
    </li>)}</ul>
    {editing !== undefined && <ProductForm key={editing?.id ?? "new"} projectId={projectId} row={editing} onClose={() => setEditing(undefined)} onSaved={refresh} />}
    {linking && <LinkProductForm projectId={projectId} onClose={() => setLinking(false)} onSaved={refresh} />}
  </Drawer>;
}

function ProductForm({ projectId, row, onClose, onSaved }: { projectId: string; row: ProductSummary | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(row?.name ?? ""), [description, setDescription] = useState(row?.description ?? "");
  const saving = useRef(false);
  const save = useMutation({ mutationFn: () => row
    ? apiPatch(endpoint(projectId) + `/${row.id}`, { name: name.trim(), description: description.trim() || null, expectedVersion: row.version })
    : apiPost(endpoint(projectId), { name: name.trim(), description: description.trim() || null }),
  onSuccess: async () => { await onSaved(); onClose(); }, onSettled: () => { saving.current = false; } });
  const submit = () => {
    if (!name.trim() || saving.current) return;
    saving.current = true;
    save.mutate();
  };
  const draft = useSettingsDraft(true, { name, description }, save.isPending);
  const close = () => void draft.leave(onClose);
  return <Modal open title={t(row ? "product.edit" : "product.create")} onClose={close} width="sm"
    footer={<><Button onClick={close} disabled={save.isPending}>{t("common.cancel")}</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={submit}>{t("common.save")}</Button></>}>
    {draft.guard}
    <form className="product-form" onSubmit={e => { e.preventDefault(); submit(); }}>
      <TextInput label={t("product.name")} value={name} maxLength={200} autoFocus disabled={save.isPending} onChange={e => setName(e.target.value)} />
      <TextArea label={t("common.description")} value={description} maxLength={10000} rows={4} disabled={save.isPending} onChange={e => setDescription(e.target.value)} />
      {save.isError && <p className="alert alert-error" role="alert">{save.error.message}</p>}
    </form>
  </Modal>;
}

function LinkProductForm({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [sourceId, setSourceId] = useState(""), [productId, setProductId] = useState("");
  const projects = useQuery({ queryKey: ["product-source-projects"], retry: false,
    queryFn: () => apiGet<{items:{id:string;name:string;archivedAt?:string|null}[]}>("/api/v1/projects", { pageSize:100 }).then(r => r.items) });
  const products = useQuery({ queryKey: ["product-link-options", sourceId], enabled: !!sourceId, retry:false,
    queryFn: () => apiGet<{ products: ProductSummary[] }>(endpoint(sourceId)).then(r => r.products) });
  const row = products.data?.find(p => p.id === productId);
  const link = useMutation({ mutationFn: () => apiPost(endpoint(sourceId) + `/${row!.id}/link`, { targetProjectId: projectId, expectedVersion: row!.version }),
    onSuccess: async () => { await onSaved(); onClose(); } });
  return <Modal open title={t("product.link")} onClose={() => { if (!link.isPending) onClose(); }} width="sm"
    footer={<><Button disabled={link.isPending} onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!row || !row.canManage} loading={link.isPending} onClick={() => link.mutate()}>{t("product.linkAction")}</Button></>}>
    <div className="product-form">
      <p className="muted">{t("product.linkHint")}</p>
      <Select label={t("product.sourceProject")} ariaLabel={t("product.sourceProject")} value={sourceId} searchable disabled={link.isPending}
        onChange={value => { setSourceId(value); setProductId(""); }} options={[{value:"",label:t("product.chooseProject")}, ...(projects.data ?? []).filter(p => p.id !== projectId && !p.archivedAt).map(p => ({value:p.id,label:p.name}))]} />
      <Select label={t("product.attribution")} ariaLabel={t("product.attribution")} value={productId} searchable disabled={!sourceId || link.isPending || products.isLoading}
        onChange={setProductId} options={[{value:"",label:t("product.choose")}, ...(products.data ?? []).filter(p => p.canManage).map(p => ({value:p.id,label:p.name}))]} />
      {(projects.isError || products.isError) && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => { void projects.refetch(); if (sourceId) void products.refetch(); }} actionLabel={t("common.reload")} />}
      {sourceId && products.isSuccess && !products.data.some(p => p.canManage) && <p className="muted">{t("product.noLinkable")}</p>}
      {link.isError && <p className="alert alert-error" role="alert">{link.error.message}</p>}
    </div>
  </Modal>;
}
