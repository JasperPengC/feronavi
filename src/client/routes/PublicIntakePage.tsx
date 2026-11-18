/** 匿名需求收集表单：不需要登录，按 token 拉 schema 后渲染并提交。 */
import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import { TextInput } from "../components/ui/TextInput.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { Button } from "../components/ui/Button.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";

interface Field { key: string; label: string; type: string; required?: boolean; options?: string[] }
export function PublicIntakePage() {
  useLocale();
  const { token } = useParams({ from: "/intake/$token" });
  const [form, setForm] = useState<{ name: string; schema: Field[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let alive = true;
    setForm(null); setError(null); setInvalid(false); setDone(false); setValues({});
    apiGet<{ name: string; schema: Field[] }>(`/api/v1/intake/${token}`)
      .then((r) => { if (alive) setForm({ name: r.name, schema: Array.isArray(r.schema) ? r.schema : [] }); })
      .catch((e) => { if (alive) { const unavailable = e instanceof ApiError && [403, 404, 410].includes(e.status); setInvalid(unavailable); setError(unavailable ? t("pi.invalid") : t("common.loadFailedShort")); } });
    return () => { alive = false; };
  }, [token, attempt]);

  async function submit() {
    if (!form || busy) return;
    const missing = form.schema.filter((f) => f.required && !String(values[f.key] ?? "").trim());
    if (missing.length) { setError(t("pi.required", { fields: missing.map((f) => f.label).join("、") })); return; }
    setBusy(true); setError(null);
    try {
      await apiPost(`/api/v1/intake/${token}/submissions`, values);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("pi.failed"));
    } finally { setBusy(false); }
  }

  return (
    <main className="public-intake">
      <DraftNavigationGuard dirty={!done && Object.values(values).some(Boolean)} saving={busy} message={t("flows.discardDraft")} />
      <div className="public-intake-card">
        <div className="public-intake-brand">{t("app.name")}</div>
        {done ? (
          <div className="public-intake-done">
            <h1>{t("pi.done")}</h1>
            <p className="muted">{t("pi.doneHint")}</p>
          </div>
        ) : !form ? (
          <div><p className={error ? "field-error" : "muted"} role={error ? "alert" : "status"}>{error ?? t("common.loading")}</p>
            {error && !invalid && <Button onClick={() => setAttempt(n => n + 1)}>{t("common.reload")}</Button>}</div>
        ) : (
          <>
            <h1>{form.name}</h1>
            <p className="muted">{t("pi.sub")}</p>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <div className="public-intake-fields">
              {form.schema.map((f) => String(f.type ?? "TEXT").toUpperCase() === "TEXTAREA" ? (
                <TextArea key={f.key} label={f.label} required={f.required} rows={5}
                  value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ) : String(f.type ?? "TEXT").toUpperCase() === "SELECT" ? (
                <label key={f.key} className="field">
                  <span className="field-label">{f.label}{f.required && <span aria-hidden="true"> *</span>}</span>
                  <select className="input" value={values[f.key] ?? ""} aria-required={f.required}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    <option value="">{t("common.selectPlaceholder")}</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              ) : (
                <TextInput key={f.key} label={f.label} required={f.required}
                  value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ))}
            </div>
            <Button variant="primary" loading={busy} disabled={busy} onClick={() => void submit()}>{t("pi.submit")}</Button>
          </>
        )}
      </div>
    </main>
  );
}
