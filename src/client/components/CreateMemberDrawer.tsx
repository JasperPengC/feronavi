import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createMemberSchema, type CreateMemberInput } from "../../shared/schemas/member.ts";
import { t } from "../i18n/index.ts";
import { apiPost, ApiError } from "../lib/api.ts";
import { useSettingsDraft } from "./settings/SettingsDraft.tsx";
import { Button } from "./ui/Button.tsx";
import { Drawer } from "./ui/Drawer.tsx";
import { TextInput } from "./ui/TextInput.tsx";
import { toast } from "./ui/Toast.tsx";

const emptyForm: CreateMemberInput = { name: "", username: "", email: "", password: "" };
type FieldName = keyof CreateMemberInput;

export function CreateMemberDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const formId = useId();
  const qc = useQueryClient();
  const submitting = useRef(false);
  const [values, setValues] = useState(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const reset = () => { setValues(emptyForm); setErrors({}); setError(null); setShowPassword(false); };
  const create = useMutation({
    mutationFn: (input: CreateMemberInput) => apiPost<{ id: string; username: string }>("/api/v1/members", input),
    onSuccess: (_member, input) => {
      void qc.invalidateQueries({ queryKey: ["members"] });
      toast.success(t("members.created", { name: input.name }));
      reset();
      onCreated();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t("members.createFailed")),
    onSettled: () => { submitting.current = false; },
  });
  const draft = useSettingsDraft(open, values, create.isPending);
  const requestClose = () => {
    if (submitting.current) return;
    void draft.leave(() => { reset(); onClose(); });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    const parsed = createMemberSchema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldName;
        next[key] = t(`members.invalid.${key}`);
      }
      setErrors(next);
      document.getElementById(`${formId}-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setErrors({});
    submitting.current = true;
    create.mutate(parsed.data);
  };
  return <>
    {draft.guard}
    <Drawer open={open} title={t("members.create")} onClose={requestClose} width="sm" footer={<div className="member-create-actions">
      <Button variant="ghost" onClick={requestClose} disabled={create.isPending}>{t("common.cancel")}</Button>
      <Button variant="primary" type="submit" form={formId} loading={create.isPending}>{t("members.create")}</Button>
    </div>}>
      <form id={formId} aria-label={t("members.create")} className="member-create-form" onSubmit={submit} noValidate>
        <p className="member-create-intro">{t("members.createHint")}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        {(["name", "username", "email", "password"] as const).map(key => {
          const hint = key === "username" ? t("members.usernameHint") : key === "password" ? t("members.passwordHint") : undefined;
          const describedBy = errors[key] || hint ? `${formId}-${key}-help` : undefined;
          return <TextInput key={key} id={`${formId}-${key}`} label={t(`members.field.${key}`)} name={key}
            type={key === "password" ? showPassword ? "text" : "password" : key === "email" ? "email" : "text"}
            autoComplete={key === "password" ? "new-password" : key === "username" ? "off" : key}
            autoCapitalize={key === "username" || key === "email" ? "none" : undefined}
            spellCheck={key === "username" || key === "email" || key === "password" ? false : undefined}
            maxLength={key === "name" ? 100 : key === "username" ? 32 : 200}
            required disabled={create.isPending} value={values[key]} aria-describedby={describedBy}
            hint={hint && <span id={describedBy}>{hint}</span>}
            error={errors[key] && <span id={describedBy}>{errors[key]}</span>}
            onChange={event => { setValues(current => ({ ...current, [key]: event.target.value })); setErrors(current => ({ ...current, [key]: undefined })); }} />;
        })}
        <label className="member-create-password-toggle"><input type="checkbox" checked={showPassword} disabled={create.isPending} onChange={event => setShowPassword(event.target.checked)} />{t("members.showPassword")}</label>
        <p className="member-create-note">{t("members.firstLoginHint")}</p>
      </form>
    </Drawer>
  </>;
}
