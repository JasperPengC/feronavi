import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * 自定义字段管理（第八期 W5）：项目级字段定义的增改与归档。
 *
 * 两处刻意的设计：
 *   1 key 与 type 建后不可改（服务端也拒绝）—— 改了等于把已填的值全部作废，界面直接置灰
 *   2 归档而非删除，并明确告知「已填的值不会丢」，避免用户以为数据被清掉
 *
 * Round 13 改造：改成**左树右内容**（用户要求第 3 条）。层级是真实的 ——
 * 字段有 6 种类型（文本/数字/日期/单选/多选/成员），左侧按类型分组、可展开到具体字段，
 * 点类型 = 只看该类型，点字段 = 只看该字段。**不为了有树而造分类**：类型本来就是字段的真实属性。
 */
import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import { Select } from "../components/Select.tsx";
import { Checkbox } from "../components/Checkbox.tsx";
import { Modal } from "../components/ui/Modal.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageHead } from "../components/Page.tsx";
import { TreeLayout } from "../components/layout/TreeLayout.tsx";
import { Button } from "../components/ui/Button.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Tree } from "../components/ui/Tree.tsx";
import type { TreeNode } from "../components/ui/Tree.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";

interface FieldDef {
  id: string; key: string; name: string; type: string;
  options: { value: string; label: string }[];
  isRequired: boolean; archivedAt: string | null; sortOrder?: number;
}

const TYPE_LABEL: Record<string, string> = {
  TEXT: "cf.typeText", NUMBER: "cf.typeNumber", DATE: "cf.typeDate",
  SINGLE_SELECT: "cf.typeSingle", MULTI_SELECT: "cf.typeMulti", PERSON: "cf.typePerson",
};
/** 类型展示顺序固定：避免树的分支顺序每次刷新都变 */
const TYPE_ORDER = ["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "PERSON"];

import { useSettingsDraft } from "../components/settings/SettingsDraft.tsx";
import { useCan } from "../lib/actor.ts";

export function CustomFieldsPage() {
  useLocale();   // 订阅语言，切换即时生效
  const { projectId } = useParams({ from: "/_app/projects/$projectId/fields" });
  const qc = useQueryClient();
  const canManage = useCan("work_item:manage_field");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ key: "", name: "", type: "TEXT", options: "", isRequired: false });
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editField, setEditField] = useState<FieldDef | null>(null);
  const [editForm, setEditForm] = useState({ name: "", options: "", isRequired: false, sortOrder: 0 });
  const [includeArchived] = useState(false);
  /** 当前选中的树节点：null=全部；type:XXX=某类型；字段 id=某个字段 */
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(
    () => new Set(TYPE_ORDER.map((type) => `type:${type}`)),
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["custom-fields", projectId, includeArchived],
    queryFn: () => apiGet<FieldDef[]>(`/api/v1/projects/${projectId}/custom-fields${includeArchived ? "?archived=true" : ""}`),
  });

  const invalidate = async () => { await qc.invalidateQueries({ queryKey: ["custom-fields", projectId] }); };

  const create = useMutation({
    mutationFn: () => apiPost(`/api/v1/projects/${projectId}/custom-fields`, {
      key: form.key, name: form.name, type: form.type, isRequired: form.isRequired,
      // 选项按 "值:标签" 每行一个输入；只有选项类字段才提交
      ...(["SINGLE_SELECT", "MULTI_SELECT"].includes(form.type)
        ? { options: form.options.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
            const [value, label] = l.split(":").map((x) => x.trim());
            return { value: value ?? "", label: label ?? value ?? "" };
          }) }
        : {}),
    }),
    onSuccess: async () => { setCreateOpen(false); setForm({ key: "", name: "", type: "TEXT", options: "", isRequired: false }); await invalidate(); },
    onError: (e) => setCreateError(e instanceof ApiError ? e.message : t("cf.createFailed")),
  });

  const archive = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/custom-fields/${id}/archive`, {}),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("cf.archiveFailed")),
  });

  const updateField = useMutation({
    mutationFn: () => {
      if (!editField) return Promise.reject(new Error("no field"));
      const body: Record<string, unknown> = { name: editForm.name, isRequired: editForm.isRequired, sortOrder: editForm.sortOrder };
      if (["SINGLE_SELECT", "MULTI_SELECT"].includes(editField.type)) {
        body.options = editForm.options.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const [value, label] = l.split(":").map((x) => x.trim());
          return { value: value ?? "", label: label ?? value ?? "" };
        });
      }
      return apiPatch(`/api/v1/custom-fields/${editField.id}`, body);
    },
    onSuccess: async () => { setEditField(null); await invalidate(); },
    onError: (e) => setEditError(e instanceof ApiError ? e.message : t("cf.renameFailed")),
  });
  function openEdit(f: FieldDef) {
    setEditField(f);
    setEditForm({ name: f.name, options: f.options.map((o) => `${o.value}:${o.label}`).join("\n"), isRequired: f.isRequired, sortOrder: f.sortOrder ?? 0 });
  }

  const needsOptions = ["SINGLE_SELECT", "MULTI_SELECT"].includes(form.type);
  const rows = data ?? [];

  /* 左树：全部 → 各类型 → 字段。类型分支只显示真实存在的字段，**不造空分类**。 */
  const treeNodes: TreeNode[] = [
    { id: "all", label: t("cf.allFields"), extra: rows.length },
    ...TYPE_ORDER.map((type) => {
      const list = rows.filter((f) => f.type === type);
      return {
        id: `type:${type}`,
        label: TYPE_LABEL[type] ? t(TYPE_LABEL[type]!) : type,
        extra: list.length,
        children: list.map((f) => ({
          id: f.id,
          label: f.name,
          extra: f.isRequired ? t("cf.requiredLabel") : undefined,
        })),
      };
    }).filter((g) => (g.children?.length ?? 0) > 0),
  ];

  const selectedField = rows.find((f) => f.id === selectedNodeId) ?? null;
  const selectedType = selectedField
    ? selectedField.type
    : selectedNodeId?.startsWith("type:") ? selectedNodeId.slice("type:".length) : null;
  const visibleRows = selectedField ? [selectedField]
    : selectedType ? rows.filter((f) => f.type === selectedType) : rows;

  const editGuard = useSettingsDraft(!!editField, editForm, updateField.isPending);
  const createGuard = useSettingsDraft(createOpen, form, create.isPending);
  const closeCreate = () => void createGuard.leave(() => { setCreateOpen(false); setForm({ key: "", name: "", type: "TEXT", options: "", isRequired: false }); setCreateError(null); });
  const closeEdit = () => void editGuard.leave(() => { setEditField(null); setEditError(null); });
  return (
    <div className="page project-refinement custom-fields-page data-page">
      <PageHead title={t("fields.title")} actions={canManage && <Button variant="primary"
        aria-haspopup="dialog" onClick={() => { setCreateError(null); setCreateOpen(true); }}>
        <Icon name="plus" size={14} />{t("cf.new")}
      </Button>} />
      {editGuard.guard}
      {createGuard.guard}
      {isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void refetch()} actionLabel={t("common.reload")} />}

      <TreeLayout
        treeLabel={t("cf.treeLabel")}
        treeWidth={240}
        tree={(
          <Tree
            nodes={treeNodes}
            ariaLabel={t("cf.treeLabel")}
            emptyText={t("cf.empty")}
            selectedId={selectedNodeId}
            expandedIds={expandedTypes}
            onSelect={setSelectedNodeId}
            onToggle={(id) => setExpandedTypes((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
          />
        )}
      >
        {canManage && <Modal open={createOpen} title={t("cf.create")} onClose={closeCreate} footer={<>
          <Button disabled={create.isPending} onClick={closeCreate}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={create.isPending} disabled={!form.key.trim() || !form.name.trim() || create.isPending} onClick={() => { setCreateError(null); create.mutate(); }}>{t("cf.create")}</Button>
        </>}>
          {createError && <p className="field-error" role="alert">{createError}</p>}
          <fieldset disabled={create.isPending} className="settings-form-fields">
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 12, marginTop: 12, alignItems: "end",
          }}>
            <TextInput label={t("cf.keyLabel")} placeholder={t("cf.keyPlaceholder")} value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })} />
            <TextInput label={t("cf.nameLabel")} placeholder={t("cf.namePlaceholder")} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label={t("cf.typeLabel")} value={form.type} ariaLabel={t("cf.typeLabel")}
              onChange={(v) => setForm({ ...form, type: v as typeof form.type })}
              options={TYPE_ORDER.map((v) => ({ value: v, label: t(TYPE_LABEL[v]!) }))} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36 }}>
              <Checkbox checked={form.isRequired} onChange={(v) => setForm({ ...form, isRequired: v })}
                label={t("cf.requiredLabel")} size="sm" />
            </div>
          </div>
          {needsOptions && (
            <TextArea label={t("cf.optionsLabel")} rows={3} value={form.options}
              hint={<>{t("cf.optionsHint")}<code>{t("cf.optionsFormat")}</code>{t("cf.optionsHintTail")}</>}
              onChange={(e) => setForm({ ...form, options: e.target.value })} />
          )}
          <p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: 0 }}>
            {t("cf.keyImmutableHint")}
          </p>
          </fieldset>
        </Modal>}

        <TableScroll label={t("fields.title")} resetKey={JSON.stringify([projectId, selectedNodeId])}>
        <table className="card custom-fields-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>{t("cf.colName")}</th>
              <th>{t("cf.keyLabel")}</th>
              <th>{t("cf.colType")}</th>
              <th>{t("cf.required")}</th>
              <th className="table-actions">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} style={{ padding: 0 }}>
                <LoadingBlock compact />
              </td></tr>
            )}
            {!isLoading && visibleRows.map((f) => (
              <tr key={f.id} className="row-hover">
                {/* 与其余七个列表页同一套行样式（第 42 轮）：整块重写而非正则替换 */}
                <td data-label={t("cf.colName")}>
                  <div className="row-title">
                    <span className="row-avatar" aria-hidden="true"><Icon name="sliders" size={13} /></span>
                    <span className="row-name">{f.name}</span>
                    {f.archivedAt && <span className="status-pill">{t("cf.archivedTag")}</span>}
                  </div>
                  {f.options.length > 0 && (
                    <div className="row-sub">
                      选项：{f.options.map((o) => o.label).join(" / ")}
                    </div>
                  )}
                </td>
                <td data-label={t("cf.keyLabel")} className="mono muted">{f.key}</td>
                <td data-label={t("cf.colType")}>{TYPE_LABEL[f.type] ? t(TYPE_LABEL[f.type]!) : f.type}</td>
                <td data-label={t("cf.required")}>{f.isRequired ? t("cf.yes") : "—"}</td>
                <td data-label={t("common.actions")} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {canManage && <Button size="sm" onClick={() => openEdit(f)}>{t("common.edit")}</Button>}{" "}
                  {canManage && !f.archivedAt && (
                    <Button variant="danger" size="sm" onClick={async () => { if (await confirmDialog(`${t("common.confirmArchive")} ${f.name}`, { danger: true })) archive.mutate(f.id); }}>{t("cf.archive")}</Button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !isError && (rows.length === 0 || visibleRows.length === 0) && (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: "center" }} className="muted">
                {rows.length === 0 ? t("cf.empty") : t("cf.noFieldsInType")}
              </td></tr>
            )}
          </tbody>
        </table>
        </TableScroll>
      </TreeLayout>

      <Modal open={!!editField} title={editField ? `${t("common.edit")} · ${editField.name}` : ""}
        onClose={closeEdit} width="sm" footer={<>
          <Button onClick={closeEdit} disabled={updateField.isPending}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={updateField.isPending} disabled={updateField.isPending || !editForm.name.trim()} onClick={() => updateField.mutate()}>{t("common.save")}</Button>
        </>}>
        {editError && <p className="field-error" role="alert">{editError}</p>}
        {editField && (
          <fieldset disabled={updateField.isPending} className="settings-form-fields" style={{ display: "grid", gap: 12 }}>
            <TextInput label={t("cf.nameLabel")} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <TextInput label={t("cf.keyLabel")} value={editField.key} disabled />
            <TextInput label={t("cf.typeLabel")} value={t(TYPE_LABEL[editField.type] ?? editField.type)} disabled />
            {["SINGLE_SELECT", "MULTI_SELECT"].includes(editField.type) && (
              <TextArea label={t("cf.optionsLabel")} rows={4} value={editForm.options}
                hint={<>{t("cf.optionsHint")}<code>{t("cf.optionsFormat")}</code>{t("cf.optionsHintTail")}</>}
                onChange={(e) => setEditForm({ ...editForm, options: e.target.value })} />
            )}
            <Checkbox checked={editForm.isRequired} onChange={(v) => setEditForm({ ...editForm, isRequired: v })}
              label={t("cf.requiredLabel")} />
            <TextInput label={t("cf.sortOrder")} type="number" value={String(editForm.sortOrder)}
              onChange={(e) => setEditForm({ ...editForm, sortOrder: Number(e.target.value) || 0 })} />
          </fieldset>
        )}
      </Modal>
    </div>
  );
}
