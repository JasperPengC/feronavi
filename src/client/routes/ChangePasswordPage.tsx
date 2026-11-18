/** 首次登录强制改密 / 主动改密 */
import { t, useLocale } from "../i18n/index.ts";
import { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, ApiError } from "../lib/api.ts";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { BrandMark } from "../components/BrandMark.tsx";
import { Icon } from "../components/Icon.tsx";
import { normalizeAuthReturnTo } from "../lib/auth-navigation.ts";

export function ChangePasswordPage() {
  useLocale();   // 订阅语言
  const navigate = useNavigate();
  const returnTo = useRouterState({ select: (state) => normalizeAuthReturnTo(state.location.search.returnTo) });
  const qc = useQueryClient();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ok = currentPassword.length > 0 && newPassword.length >= 12 && newPassword === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await apiPost("/api/v1/auth/password/change", { currentPassword, newPassword });
      // 改密后服务端会吊销全部会话，必须重新登录
      await qc.cancelQueries();
      qc.clear();
      await navigate({ to: "/login", search: { returnTo, passwordChanged: true }, replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pwd.failed"));
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-simple-shell public-auth-page">
      <div className="auth-simple-brand">
        <BrandMark className="auth-logo-mark" />
        <span className="auth-logo-word">Feronavi</span>
      </div>
      <form onSubmit={submit} className="card auth-card">
        <h1 className="page-title" style={{ margin: "0 0 4px" }}>{t("pwd.title")}</h1>
        <p className="muted" style={{ margin: "0 0 20px", fontSize: "var(--text-sm)" }}>
          {t("pw.reloginHint")}
        </p>
        {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
        <TextInput id="cur" label={t("pwd.current")} type="password" autoComplete="current-password"
          value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        <TextInput id="new" label={t("pwd.new")} type="password" autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)} required />
        <TextInput id="cfm" label={t("pwd.confirm")} type="password" autoComplete="new-password"
          value={confirm}
          error={confirm && newPassword !== confirm ? t("pwd.mismatch") : undefined}
          onChange={(e) => setConfirm(e.target.value)} required />
        <ul className="pwd-rules" aria-label={t("pwd.title")}>
          <li data-ok={newPassword.length >= 12 ? "true" : "false"}>
            <Icon name={newPassword.length >= 12 ? "check" : "x"} size={12} />{t("pwd.minHint")}
          </li>
          <li data-ok={!!confirm && newPassword === confirm ? "true" : "false"}>
            <Icon name={confirm && newPassword === confirm ? "check" : "x"} size={12} />{t("pwd.matchHint")}
          </li>
        </ul>
        <Button variant="primary" type="submit" loading={busy} disabled={!ok || busy} style={{ width: "100%" }}>
          {busy ? t("pwd.submitting") : t("pwd.submit")}
        </Button>
      </form>
      <p className="auth-simple-foot">{t("login.brandFooter")}</p>
    </div>
  );
}
