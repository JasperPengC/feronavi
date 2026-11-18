/** 公开邀请注册页（/invite/$token，总纲 5.11：7 天、单次使用） */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { LocaleSwitcher } from "./LocaleSwitcher.tsx";
import { LoadingBlock } from "../components/ui/StateBlock.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

export function InvitePage() {
  useLocale();
  const navigate = useNavigate();
  const { token } = useParams({ from: "/invite/$token" });
  const [valid, setValid] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    setValid(null); setLoadError(false);
    apiGet<{ valid: boolean }>(`/api/v1/invites/${token}`)
      .then((r) => { if (alive) setValid(r.valid); })
      .catch((e) => { if (alive) {
        if (e instanceof ApiError && [403, 404, 410].includes(e.status)) setValid(false);
        else setLoadError(true);
      } });
    return () => { alive = false; };
  }, [token, attempt]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiPost(`/api/v1/invites/${token}/accept`, { username, name, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("invite.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-auth-page public-invite-page">
      <DraftNavigationGuard dirty={!done && !!(username || name || password)} saving={busy} message={t("flows.discardDraft")} />
      <div className="card auth-card">
        <h1 className="page-title" style={{ margin: "0 0 4px" }}>{t("invite.joinTitle")}</h1>
        <p className="muted" style={{ margin: "0 0 20px", fontSize: "var(--text-sm)" }}>{t("invite.joinHint")}</p>
        {valid === null && !loadError && <LoadingBlock />}
        {loadError && <div><p className="field-error" role="alert">{t("common.loadFailedShort")}</p><Button onClick={() => setAttempt(n => n + 1)}>{t("common.reload")}</Button></div>}
        {valid === false && <div className="alert alert-error" role="alert">{t("invite.invalid")}</div>}
        {valid === true && !done && (
          <form onSubmit={submit}>
            {error && <div className="alert alert-error" style={{ marginBottom: 12 }} role="alert">{error}</div>}
            <TextInput id="inv-username" label={t("invite.username")} value={username} autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} required />
            <TextInput id="inv-name" label={t("invite.name")} value={name} onChange={(e) => setName(e.target.value)} required />
            <TextInput id="inv-password" label={t("invite.password")} type="password" value={password}
              autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} required />
            <Button variant="primary" type="submit" loading={busy} disabled={busy || password.length < 12}
              style={{ width: "100%", marginTop: 8 }}>{t("invite.accept")}</Button>
          </form>
        )}
        {done && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="alert alert-success" role="status">{t("invite.joined")}</div>
            <Button variant="primary" onClick={() => void navigate({ to: "/login" })}>{t("invite.goLogin")}</Button>
          </div>
        )}
      </div>
      <div className="public-display-controls"><LocaleSwitcher menu /><ThemeToggle syncPreference={false} /></div>
    </div>
  );
}
