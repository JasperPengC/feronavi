/** 需求收集表单设计器：字段 key/标签/类型/必填/选项，POST 真实 schema。 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Select } from "../Select.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { Icon } from "../Icon.tsx";

interface DraftField { key: string; label: string; type: "TEXT" | "TEXTAREA" | "SELECT"; required: boolean; options: string }
const DEFAULT: DraftField[] = [
  { key: "title", label: "标题", type: "TEXT", required: true, options: "" },
  { key: "detail", label: "详细描述", type: "TEXTAREA", required: false, options: "" },
];

export function IntakeFormBuilder({ open, projectId, onClose, onCreated }: {
  open: boolean; projectId: string; onClose: () => void; onCreated: (token: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [fields, setFields] = useState<DraftField[]>(DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => apiPost<{ form: { id: string }; submitToken: string }>(`/api/v1/projects/${projectId}/intake-forms`, {
      name: name.trim(),
      schema: fields.map((f) => ({
        key: f.key.trim(), label: f.label.trim(), type: f.type, required: f.required,
        ...(f.type === "SELECT" ? { options: f.options.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
      })),
    }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["intake-forms", projectId] });
      setError(null); setName(""); setFields(DEFAULT); onCreated(r.submitToken); onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("it.createFailed")),
  });
  const update = (i: number, patch: Partial<DraftField>) => setFields((fs) => fs.map((f, idx) => idx === i ? { ...f, ...patch } : f));

  return (
    <Drawer open={open} title={t("it.designTitle")} onClose={() => !create.isPending && onClose()} width="md" className="project-intake-builder">
      <div style={{ display: "grid", gap: 12 }}>
        <TextInput label={t("it.formName")} required value={name} onChange={(e) => setName(e.target.value)}
          placeholder={t("intake.formNamePlaceholder")} />
        <div className="intake-builder-fields">
          {fields.map((f, i) => (
            <div className="intake-builder-row" key={i}>
              <TextInput label={t("it.fieldKey")} value={f.key} onChange={(e) => update(i, { key: e.target.value })} />
              <TextInput label={t("it.fieldLabel")} value={f.label} onChange={(e) => update(i, { label: e.target.value })} />
              <Select label={t("it.fieldType")} value={f.type} ariaLabel={t("it.fieldType")}
                onChange={(v) => update(i, { type: v as DraftField["type"] })}
                options={[{ value: "TEXT", label: t("it.typeText") }, { value: "TEXTAREA", label: t("it.typeTextarea") }, { value: "SELECT", label: t("it.typeSelect") }]} />
              <div className="intake-builder-row-actions">
                <Checkbox checked={f.required} label={t("it.required")} size="sm" onChange={(v) => update(i, { required: v })} />
                <Button size="sm" variant="ghost" iconOnly aria-label={`${t("common.delete")} ${f.label || f.key}`}
                  disabled={fields.length <= 1} onClick={() => setFields(fields.filter((_, idx) => idx !== i))}>
                  <Icon name="trash" size={14} />
                </Button>
              </div>
              {f.type === "SELECT" && (
                <TextInput className="intake-builder-options" label={t("it.options")} value={f.options} onChange={(e) => update(i, { options: e.target.value })} placeholder="选项1, 选项2" />
              )}
            </div>
          ))}
        </div>
        <Button size="sm" onClick={() => setFields([...fields, { key: `field_${fields.length + 1}`, label: "", type: "TEXT", required: false, options: "" }])}>
          <Icon name="plus" size={14} />{t("it.addField")}
        </Button>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="drawer-actions">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={create.isPending} disabled={!name.trim() || fields.some((f) => !f.key.trim() || !f.label.trim())}
            onClick={() => create.mutate()}>{t("common.create")}</Button>
        </div>
      </div>
    </Drawer>
  );
}
