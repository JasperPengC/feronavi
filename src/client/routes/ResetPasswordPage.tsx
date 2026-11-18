/**
 * 重置密码页（第七期 D3）：消费邮件里的 `?token=` 链接。
 *
 * 用 URL 查询参数而不是路由参数 —— 邮件链接是外部生成的，查询串更宽容
 * （用户从邮件里复制粘贴时容易带上多余斜杠）。
 */
import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { apiPost, ApiError } from "../lib/api.ts";
import { t } from "../i18n/index.ts";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { token?: string };
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const token = search.token ?? "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (pw !== pw2) { setError(t("rp.mismatch")); return; }
    if (pw.length < 12) { setError(t("rp.tooShort")); return; }
    setBusy(true);
    try {
      await apiPost("/api/v1/auth/password/reset", { token, newPassword: pw });
      void navigate({ to: "/login", search: { passwordChanged: true }, replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("rp.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-auth-page">
      <form onSubmit={submit} className="card auth-card">
        <h1 className="page-title" style={{ margin: "0 0 4px" }}>{t("reset.title")}</h1>
        <p className="muted" style={{ margin: "0 0 20px", fontSize: "var(--text-sm)" }}>
          {t("rp.validHint")}
        </p>

        {!token && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
            {t("rp.noToken")}
          </div>
        )}
        {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

        <TextInput id="np" label={t("rp.newPassword")} type="password" value={pw} autoComplete="new-password" disabled={busy || !token}
          onChange={(e) => setPw(e.target.value)} />
        <TextInput id="np2" label={t("rp.confirmPassword")} type="password" value={pw2} autoComplete="new-password" disabled={busy || !token}
          onChange={(e) => setPw2(e.target.value)} />
        <Button variant="primary" type="submit" loading={busy} disabled={!token || !pw || busy} style={{ width: "100%" }}>
          {busy ? t("rp.submitting") : t("rp.title")}
        </Button>
      </form>
    </div>
  );
}
