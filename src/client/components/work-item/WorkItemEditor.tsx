/**
 * 工作项编辑器（新建 / 编辑共用）
 *
 * 之前工作项只能通过「问题追踪」创建缺陷，看板/表格/项目概览没有新建入口；
 * 详情抽屉也只读。这里把 createWorkItemSchema / updateWorkItemSchema 的真实字段接起来，
 * 并保留乐观锁 version；保存失败按后端 message 原样展示。
 */
import { invalidateWorkItemQueries, queryKeys } from "../../lib/query-keys.ts";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "../../lib/api.ts";
import { useMarkdownImages } from "../../lib/useMarkdownImages.ts";
import { saveNewWorkItem, type CreatedWorkItemDraft } from "../../lib/save-work-item.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { MarkdownEditor } from "../ui/MarkdownEditor.tsx";
import { DraftNavigationGuard } from "../ui/DraftNavigationGuard.tsx";
import { Select } from "../Select.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { confirmDialog } from "../Dialog.tsx";
import type { ProductSummary } from "../../../shared/schemas/product.ts";
import { WorkItemPicker, type WorkItemOption } from "./WorkItemPicker.tsx";
import { WorkItemPlanningFields, type WorkItemPlanValues } from "./WorkItemPlanningFields.tsx";

const TYPES = ["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"] as const;
const PRIORITIES = ["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const SEVERITIES = ["S1", "S2", "S3", "S4"] as const;

export interface EditableWorkItem {
  id: string; projectId: string; type: string; title: string; description: string | null;
  priority: string | null; severity?: string | null; assigneeId: string | null;
  dueDate: string | null; startDate?: string | null; parentId?: string | null; version: number;
  productId?: string | null;
  milestoneId?: string | null; iterationId?: string | null; releaseId?: string | null; moduleId?: string | null;
}

export type WorkItemParent = WorkItemOption & Pick<EditableWorkItem, "type" | "priority" | "dueDate" | "startDate" | "milestoneId" | "iterationId" | "releaseId" | "moduleId">;

interface ProjectMember { id: string; name: string; username: string }

interface FormState extends WorkItemPlanValues {
  type: string; title: string; description: string; priority: string;
  severity: string; assigneeId: string; dueDate: string; startDate: string; parentId: string;
  productId: string;
}

const EMPTY: FormState = {
  type: "TASK", title: "", description: "", priority: "", severity: "",
  assigneeId: "", dueDate: "", startDate: "", parentId: "", productId: "",
  milestoneId: "", iterationId: "", releaseId: "", moduleId: "",
};

export function WorkItemEditor({
  open, projectId, workItem, initialDueDate, initialParent, initialPlanning, onClose, onSaved,
}: {
  open: boolean;
  projectId: string;
  initialDueDate?: string;
  initialPlanning?: Partial<Record<"milestoneId" | "iterationId" | "releaseId" | "moduleId", string>>;
  initialParent?: WorkItemParent;
  /** 传入 = 编辑；不传 = 新建 */
  workItem?: EditableWorkItem | null;
  onClose: () => void;
  onSaved?: (item: { id: string }) => void;
}) {
  const qc = useQueryClient();
  const editing = !!workItem;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [plansValid, setPlansValid] = useState(true);
  const formId = useId();
  const session = useRef<{ key: string; initial: FormState; version?: number } | null>(null);
  const confirming = useRef(false);
  const saveLock = useRef(false);
  const images = useMarkdownImages({ newWorkItem: !editing });
  const resetImages = images.reset;
  const createdDraft = useRef<CreatedWorkItemDraft | null>(null);

  useEffect(() => {
    if (!open) { session.current = null; createdDraft.current = null; resetImages(); return; }
    const key = workItem?.id ?? `${projectId}:${initialParent?.id ?? ""}`;
    if (session.current?.key === key) return;
    setError(null);
    createdDraft.current = null; resetImages();
    const initial = workItem ? {
      type: workItem.type,
      title: workItem.title,
      description: workItem.description ?? "",
      priority: workItem.priority ?? "",
      severity: workItem.severity ?? "",
      assigneeId: workItem.assigneeId ?? "",
      dueDate: workItem.dueDate ?? "",
      startDate: workItem.startDate ?? "",
      parentId: workItem.parentId ?? "",
      productId: workItem.productId ?? "",
      milestoneId: workItem.milestoneId ?? "", iterationId: workItem.iterationId ?? "",
      releaseId: workItem.releaseId ?? "", moduleId: workItem.moduleId ?? "",
    } : { ...EMPTY, dueDate: initialDueDate ?? initialParent?.dueDate ?? "", startDate: initialParent?.startDate ?? "",
      type: !initialParent || initialParent.type === "REQUIREMENT" ? "TASK" : "SUBTASK",
      parentId: initialParent?.id ?? "", priority: initialParent?.priority ?? "",
      milestoneId: initialParent?.milestoneId ?? initialPlanning?.milestoneId ?? "", iterationId: initialParent?.iterationId ?? initialPlanning?.iterationId ?? "",
      releaseId: initialParent?.releaseId ?? initialPlanning?.releaseId ?? "", moduleId: initialParent?.moduleId ?? initialPlanning?.moduleId ?? "" };
    session.current = { key, initial, version: workItem?.version };
    setForm(initial);
  }, [open, workItem, initialDueDate, initialParent, initialPlanning, projectId, resetImages]);

  const members = useQuery({
    queryKey: ["project-members", projectId],
    enabled: open && !!projectId,
    retry: false,
    queryFn: () => apiGet<{ members: ProjectMember[] }>(`/api/v1/projects/${projectId}/members`).then((r) => r.members ?? []),
    staleTime: 60_000,
  });

  const products = useQuery({ queryKey: ["project-products", projectId], enabled: open && form.type === "REQUIREMENT", retry: false,
    queryFn: () => apiGet<{ products: ProductSummary[] }>(`/api/v1/projects/${projectId}/products`, { includeArchived: true }).then(r => r.products) });
  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> & { description: string | null } = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority || null,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        startDate: form.startDate || null,
        parentId: form.parentId || null,
        milestoneId: form.milestoneId || null, iterationId: form.iterationId || null,
        releaseId: form.releaseId || null, moduleId: form.moduleId || null,
      };
      if (form.type === "DEFECT") body.severity = form.severity || null;
      if (form.type === "REQUIREMENT") body.productId = form.productId || null;
      if (editing && workItem) {
        const description = await images.persist(form.description, "WORK_ITEM", workItem.id);
        return apiPatch(`/api/v1/work-items/${workItem.id}`, { ...body, description: description.trim() || null, version: session.current?.version });
      }
      return saveNewWorkItem(createdDraft, projectId, { ...body, type: form.type }, images.persist);
    },
    onSuccess: async (saved) => {
      await Promise.all([
        invalidateWorkItemQueries(qc, (saved as { id?: string } | undefined)?.id ?? workItem?.id),
        qc.invalidateQueries({ queryKey: ["attachments", "WORK_ITEM"] }),
        qc.invalidateQueries({ queryKey: ["project-products", projectId] }),
      ]);
      onSaved?.(saved as { id: string });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t("wie.saveFailed")),
    onSettled: () => { saveLock.current = false; },
  });

  const memberOptions = [
    { value: "", label: t("wie.unassigned") },
    ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name || m.username, secondaryLabel: `@${m.username}` })),
  ];
  const disabled = !form.title.trim() || (form.type === "SUBTASK" && !form.parentId) || !plansValid || save.isPending;
  const dirty = !!session.current && JSON.stringify(form) !== JSON.stringify(session.current.initial);
  const submit = () => {
    if (disabled || saveLock.current) return;
    saveLock.current = true;
    save.mutate();
  };
  const requestClose = async () => {
    if (save.isPending || confirming.current) return;
    confirming.current = true;
    try {
      if (dirty && !await confirmDialog(t(createdDraft.current ? "md.closeCreated" : "flows.discardDraft"))) return;
      if (createdDraft.current) {
        await qc.invalidateQueries({ queryKey: queryKeys.board() });
        await qc.invalidateQueries({ queryKey: queryKeys.table() });
      }
      onClose();
    } finally { confirming.current = false; }
  };

  return (
    <Drawer
      open={open}
      title={editing ? t("wie.edit") : t("wie.create")}
      onClose={() => void requestClose()}
      width="lg"
      className="task-editor-drawer"
      footer={<div className="task-form-actions">
        <span className="task-form-shortcut">{t("flows.submitShortcut")}</span>
        <Button variant="ghost" onClick={() => void requestClose()} disabled={save.isPending}>{t("common.cancel")}</Button>
        <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={disabled}>
          {editing ? t("common.save") : t(createdDraft.current ? "md.continueSave" : "common.create")}
        </Button>
      </div>}
    >
      <DraftNavigationGuard dirty={dirty} saving={save.isPending} message={t(createdDraft.current ? "md.closeCreated" : "flows.discardDraft")} />
      <form id={formId} className="wie-form task-form" onSubmit={(event) => { event.preventDefault(); submit(); }}
        onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submit(); } }}>
        <fieldset className="task-form-fields" disabled={save.isPending}>
        {/* 标题放最前：主流工具的录入顺序是「先想清楚要做什么，再补属性」（走查 P3-9） */}
        <TextInput label={t("common.title")} required value={form.title} autoFocus
          onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("wie.titlePlaceholder")} />
        <MarkdownEditor label={t("common.description")} rows={5} value={form.description} images={images} disabled={save.isPending}
          onChange={(description) => setForm((current) => ({ ...current, description }))} />

        <fieldset className="task-form-group"><legend>{t("flows.assignment")}</legend><div className="wie-form-grid">
          <Select label={t("wiDetail.type")} value={form.type} ariaLabel={t("wiDetail.type")}
            disabled={editing || !!createdDraft.current} onChange={(v) => setForm({ ...form, type: v })}
            options={TYPES.map((x) => ({ value: x, label: t(`type.${x}`) }))} />
          {open && <WorkItemPicker projectId={projectId} value={form.parentId} onChange={parentId => setForm({ ...form, parentId })}
            label={t("wie.parent")} emptyLabel={t("wie.noParent")} excludeId={workItem?.id} selected={initialParent} required={form.type === "SUBTASK"} />}
          {form.type === "REQUIREMENT" && <Select label={t("product.attribution")} ariaLabel={t("product.attribution")} value={form.productId} searchable
            onChange={value => setForm({ ...form, productId: value })} disabled={products.isLoading || products.isError}
            error={products.isError ? <span>{t("common.loadFailedShort")} <Button size="sm" onClick={() => void products.refetch()}>{t("common.reload")}</Button></span> : undefined}
            options={[{ value: "", label: t("product.none") }, ...(products.data ?? []).filter(p => !p.archivedAt || p.id === session.current?.initial.productId).map(p => ({ value: p.id, label: p.name + (p.archivedAt ? ` · ${t("product.archived")}` : "") }))]} />}
          <Select label={t("common.priority")} value={form.priority} ariaLabel={t("common.priority")}
            onChange={(v) => setForm({ ...form, priority: v })}
            options={[{ value: "", label: t("wie.none") }, ...PRIORITIES.map((x) => ({ value: x, label: t(`prio.${x}`) }))]} />
          {form.type === "DEFECT" && (
            <Select label={t("common.severity")} value={form.severity} ariaLabel={t("common.severity")}
              onChange={(v) => setForm({ ...form, severity: v })}
              options={[{ value: "", label: t("wie.none") }, ...SEVERITIES.map((x) => ({ value: x, label: x }))]} />
          )}
          <Select label={t("common.assignee")} value={form.assigneeId} ariaLabel={t("common.assignee")} searchable
            onChange={(v) => setForm({ ...form, assigneeId: v })} options={memberOptions} />
          <DatePicker label={t("common.startDate")} value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })}
            ariaLabel={t("common.startDate")} placeholder={t("common.pickDate")} clearable />
          <DatePicker label={t("common.dueDate")} value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })}
            ariaLabel={t("common.dueDate")} placeholder={t("common.pickDate")} clearable />
        </div></fieldset>

        {open && <WorkItemPlanningFields projectId={projectId} values={form} existing={editing ? session.current?.initial : undefined}
          onChange={(field, value) => setForm(current => ({ ...current, [field]: value }))} onValidityChange={setPlansValid} />}

        </fieldset>
        {error && createdDraft.current && <p className="muted" role="status">{t("md.createdRetry")}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
        {save.isPending && <p className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("common.saving")}</p>}
      </form>
    </Drawer>
  );
}
