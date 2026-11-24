/** 登录页 */
import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, apiGet, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import { LocaleSwitcher } from "./LocaleSwitcher.tsx";
import { BrandMark } from "../components/BrandMark.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { useDocumentTitle, useOrg } from "../lib/useOrg.ts";
import { Checkbox } from "../components/Checkbox.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { toast } from "../components/ui/Toast.tsx";
import type { Actor } from "../lib/actor.ts";

import { authNavigationSearch, normalizeAuthReturnTo, readSsoReturnTo, SSO_RETURN_KEY } from "../lib/auth-navigation.ts";

export function LoginPage() {
  useLocale();   // 订阅语言：未登录页面也要能即时切换
  const org = useOrg();
  const orgName = org.data?.name?.trim();
  useDocumentTitle(t("login.title"));
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.search });
  const [ssoReturnTo] = useState(() => readSsoReturnTo());
  const returnTo = normalizeAuthReturnTo(search.returnTo ?? ssoReturnTo);
  const passwordChanged = authNavigationSearch(search).passwordChanged === true;
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 自助找回（第七期）：只在实例已配 SMTP 时显示入口 —— 规范要求"配了 SMTP 才自动启用"
  const [resetEnabled, setResetEnabled] = useState<boolean | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [providers, setProviders] = useState<{ id: string; kind: string; label: string }[]>([]);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ldapProviders, setLdapProviders] = useState<{ id: string; label: string }[]>([]);
  const [ldapId, setLdapId] = useState("");
  const [ldapMode, setLdapMode] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet<{ providers: { id: string; kind: string; label: string }[] }>("/api/v1/auth/sso/providers")
      .then((r) => { if (alive) setProviders(r.providers ?? []); })
      .catch(() => { if (alive) setProviders([]); });
    apiGet<{ providers: { id: string; label: string }[] }>("/api/v1/auth/ldap/providers")
      .then((r) => {
        if (!alive) return;
        setLdapProviders(r.providers ?? []);
        if ((r.providers ?? []).length > 0) setLdapId(r.providers[0]!.id);
      })
      .catch(() => { if (alive) setLdapProviders([]); });
    return () => { alive = false; };
  }, []);

  // 回调失败只会带 sso_error=1（不泄露原因），在登录页给一个稳定提示。
  useEffect(() => { if (search.sso_error) setError(t("login.ssoFailed")); }, [search.sso_error]);

  async function startSso(id: string) {
    setError(null);
    setSsoBusy(true);
    try {
      const r = await apiPost<{ authorizationUrl: string }>(`/api/v1/auth/sso/${id}/start`, {
        redirectUri: `${window.location.origin}/api/v1/auth/sso/callback`,
      });
      try { sessionStorage.setItem(SSO_RETURN_KEY, JSON.stringify({ returnTo, startedAt: Date.now() })); } catch { /* 存储不可用不阻止企业登录。 */ }
      window.location.href = r.authorizationUrl;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("login.ssoFailed"));
      setSsoBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    apiGet<{ passwordResetEnabled?: boolean }>("/api/v1/setup/state")
      .then((st) => { if (alive) setResetEnabled(st.passwordResetEnabled === true); })
      .catch(() => { if (alive) setResetEnabled(false); });
    return () => { alive = false; };
  }, []);

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotBusy(true);
    setForgotMsg(null);
    try {
      const r = await apiPost<{ ok: boolean; enabled: boolean; message?: string }>(
        "/api/v1/auth/password/forgot", { identifier: username });
      // ⚠️ 服务端响应恒为 ok（防账号枚举）—— 界面也不得暗示"这个账号不存在"
      setForgotMsg(r.message ?? t("login.forgotSent"));
    } catch {
      setForgotMsg(t("login.forgotFailed"));
    } finally {
      setForgotBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (ldapMode) {
        await apiPost("/api/v1/auth/ldap/login", { idpId: ldapId, username, password, totpCode: totpCode || undefined });
      } else {
        await apiPost("/api/v1/auth/login", { username, password, remember, totpCode: totpCode || undefined });
      }
      // 成功登录可能换成另一账号；清空旧业务缓存并取消旧查询后再获取身份。
      qc.clear();
      const me = await qc.fetchQuery({
        queryKey: ["actor"],
        queryFn: () => apiGet<Actor>("/api/v1/auth/me"),
      });
      readSsoReturnTo(true);
      if (me.mustChangePassword) {
        await navigate({ to: "/change-password", search: { returnTo }, replace: true });
      } else {
        toast.success(t("login.succeeded"));
        await navigate({ href: returnTo, replace: true });
      }
    } catch (err) {
      // ⚠️ 后端保证「用户名不存在」与「密码错误」返回**完全相同**的响应，
      //    前端也不要区分 —— 区分就等于把枚举接口暴露给攻击者
      setError(err instanceof ApiError ? err.message : t("login.failed"));
      if (err instanceof ApiError && (err.details as { twoFactorRequired?: boolean } | null)?.twoFactorRequired)
        setTwoFactorRequired(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <header className="login-header">
        <div className="auth-logo">
          <BrandMark className="auth-logo-mark" />
          <span className="auth-logo-word">Feronavi</span>
        </div>
        <div className="login-display-controls">
          <LocaleSwitcher menu />
          <ThemeToggle syncPreference={false} />
        </div>
      </header>

      <main className="login-main">
        <aside className="login-brand-panel" aria-label="Feronavi">
          <div className="login-brand-visual" aria-hidden="true">
            <img className="login-brand-art login-art-dark" src="/brand/login-sculpture.svg" width={704} height={560} alt="" draggable={false} />
            <img className="login-brand-art login-art-light" src="/brand/login-sculpture-light.svg" width={704} height={560} alt="" draggable={false} />
          </div>
          <div className="login-brand-copy">
            <h2>{t("login.brandTitle")}</h2>
            <p>{t("login.brandSubtitle")}</p>
          </div>
        </aside>
        <div className="login-panel">
          <div className="login-heading">
            <h1>{t("login.welcome")}</h1>
            <p>{orgName ? t("login.toOrg", { org: orgName }) : t("login.welcomeHint")}</p>
          </div>

          {passwordChanged && <div className="alert alert-info" role="status" style={{ marginBottom: 16 }}>{t("pwd.changed")}</div>}
          {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

          {ldapMode && (
            <div className="auth-sso" style={{ marginBottom: 12 }}>
              <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 8px" }}>
                {t("login.ldapWith", { provider: ldapProviders.find((p) => p.id === ldapId)?.label ?? "LDAP" })}
              </p>
              <button type="button" className="btn-link" onClick={() => { setLdapMode(false); setError(null); }}>{t("login.ldapBack")}</button>
            </div>
          )}
          <form onSubmit={submit} className="auth-form">
            <TextInput id="username" label={t("login.username")} value={username} autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} required autoFocus />
            <TextInput id="password" label={t("login.password")} type="password" value={password}
              autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} required />
            {(ldapMode || twoFactorRequired) && (
              <TextInput id="totp" label={t(ldapMode ? "login.ldapTotp" : "login.totp")} value={totpCode} autoComplete="one-time-code" inputMode="numeric"
                onChange={(e) => setTotpCode(e.target.value)} hint={t(ldapMode ? "login.ldapTotpHint" : "login.totpHint")} />
            )}
            {!ldapMode && (
              <div className="auth-form-row">
                <Checkbox checked={remember} onChange={setRemember} label={t("login.remember")} />
              </div>
            )}

            <Button variant="primary" type="submit" loading={busy} disabled={busy} style={{ width: "100%" }}>
              {busy ? t("login.submitting") : ldapMode ? t("login.ldapSubmit") : t("login.submit")}
            </Button>
          </form>
          {returnTo !== "/projects" && <p className="login-return-hint">{t("login.returnHint")}</p>}

          {ldapProviders.length > 0 && !ldapMode && (
            <div className="auth-sso">
              <p className="auth-divider"><span>{t("login.ldapOr")}</span></p>
              {ldapProviders.map((p) => (
                <Button key={p.id} size="sm" disabled={ssoBusy} style={{ width: "100%", marginBottom: 6 }}
                  onClick={() => { setLdapMode(true); setLdapId(p.id); setError(null); }}>{t("login.ldapWith", { provider: p.label })}</Button>
              ))}
            </div>
          )}

          {providers.length > 0 && !ldapMode && (
            <div className="auth-sso">
              <p className="auth-divider"><span>{t("login.ssoOr")}</span></p>
              {providers.map((p) => (
                <Button key={p.id} size="sm" disabled={ssoBusy} style={{ width: "100%", marginBottom: 6 }}
                  onClick={() => void startSso(p.id)}>{t("login.ssoWith", { provider: p.label })}</Button>
              ))}
            </div>
          )}

          {resetEnabled && (
            <div className="auth-forgot">
              <button type="button" className="btn-link" aria-expanded={forgotOpen} aria-controls="login-recovery-form" onClick={() => setForgotOpen(!forgotOpen)}>
                {forgotOpen ? t("login.collapse") : t("login.forgot")}
              </button>
              {forgotOpen && (
                <form id="login-recovery-form" onSubmit={submitForgot} style={{ marginTop: 10, textAlign: "left" }}>
                  <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 8px" }}>
                    {t("login.forgotHint")}
                  </p>
                  <Button size="sm" type="submit" disabled={!username.trim() || forgotBusy}>
                    {forgotBusy ? t("login.forgotSending") : t("login.forgotSubmit")}
                  </Button>
                  {forgotMsg && (
                    <p className="muted" role="status" style={{ fontSize: "var(--text-xs)", marginTop: 8 }}>{forgotMsg}</p>
                  )}
                </form>
              )}
            </div>
          )}
        </div>

      </main>
      <footer className="login-footer"><span className="login-footer-name">Feronavi</span><span>{t("login.brandFooter")}</span></footer>
    </div>
  );
}
