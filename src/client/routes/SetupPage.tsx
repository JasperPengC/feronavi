/**
 * 安装向导（6 步）
 *
 * 交互硬要求（Spec 第 5.2 节）：
 *   - 第 5 步「测试连接」失败**不阻塞**后续（SMTP 可跳过）
 *   - 第 6 步提交期间按钮置灰 + 转圈，**禁止重复提交**（否则可能建出两个管理员）
 *   - 错误统一展示后端返回的 message，**不自己拼文案**
 *
 * 布局（Round 20 重设计）：左侧竖向步骤条（品牌 + 六步状态）+ 右侧内容区 + 底部操作栏，
 * 整体在视口内居中、内容区可滚动。此前的横向圆点进度条在宽屏上把内容挤得很空、语言切换器
 * 孤零零飘在页面顶部，重设计后语言切换并入顶部品牌行。
 */
import { t as tr, useLocale } from "../i18n/index.ts";   // ⚠️ t 另有含义，i18n 用别名 tr
import { LocaleSwitcher } from "./LocaleSwitcher.tsx";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { BrandMark } from "../components/BrandMark.tsx";
import { Icon } from "../components/Icon.tsx";
import { Select } from "../components/Select.tsx";
import { Checkbox } from "../components/Checkbox.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { timeZoneOptions } from "../components/timezones.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface PrecheckItem { key: string; ok: boolean; message: string }

/** 步骤标题 / 说明走词典键（在组件内取，语言切换即时生效） */
const STEP_KEYS = ["su.stepCheck", "su.dbLabel", "su.stepAdmin", "su.stepOrg", "su.stepIntegrations", "su.stepDone"];
const STEP_DESC_KEYS = ["su.descCheck", "su.descDb", "su.descAdmin", "su.descOrg", "su.descIntegrations", "su.descDone"];

export function SetupPage() {
  useLocale();   // 向导发生在还没有账号时，语言只能靠本地选择
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 第 1 步
  const [items, setItems] = useState<PrecheckItem[]>([]);
  const [precheckLoading, setPrecheckLoading] = useState(true);
  // 第 2 步
  const [dbInfo, setDbInfo] = useState<null | {
    ok: boolean; current?: boolean; host?: string; database?: string; user?: string; maskedUrl?: string;
    version?: string; major?: number; compatible?: boolean; recommended?: boolean; error?: string;
    extensions?: { vector: boolean; zhparser: boolean; pgTrgm: boolean };
  }>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbMode, setDbMode] = useState<"current" | "external">("current");
  const [dbForm, setDbForm] = useState({ host: "", port: "5432", database: "", user: "", password: "", ssl: "prefer" });
  const [dbTest, setDbTest] = useState<typeof dbInfo>(null);
  const [dbTesting, setDbTesting] = useState(false);
  // 第 3、4 步
  const [admin, setAdmin] = useState({ username: "", email: "", password: "", confirm: "", name: "" });
  const [org, setOrg] = useState({ name: "", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai", kind: "COMPANY" as "COMPANY" | "OPC", seedDepartments: true });
  // 第 5 步（全部可跳过）
  const [smtp, setSmtp] = useState({ host: "", port: "587", user: "", password: "", from: "" });
  const [storage, setStorage] = useState({
    kind: "local" as "local" | "s3", endpoint: "", region: "us-east-1", bucket: "",
    accessKey: "", secretKey: "", forcePathStyle: true, prefix: "",
  });

  useEffect(() => {
    if (step !== 1) return;
    setPrecheckLoading(true);
    apiGet<{ items: PrecheckItem[] }>("/api/v1/setup/precheck")
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : tr("su.checkFailedShort")))
      .finally(() => setPrecheckLoading(false));
  }, [step]);

  useEffect(() => {
    if (step !== 2 || dbInfo) return;
    setDbLoading(true);
    apiGet<NonNullable<typeof dbInfo>>("/api/v1/setup/database")
      .then((r) => setDbInfo(r))
      .catch((e) => setDbInfo({ ok: false, error: e instanceof ApiError ? e.message : tr("su.dbLoadFailed") }))
      .finally(() => setDbLoading(false));
  }, [step, dbInfo]);

  useEffect(() => {
    if (!dbInfo?.ok) return;
    const host = dbInfo.host ?? "";
    const idx = host.lastIndexOf(":");
    setDbForm((f) => ({
      ...f,
      host: idx > 0 ? host.slice(0, idx) : host,
      port: idx > 0 ? host.slice(idx + 1) : f.port,
      database: dbInfo.database ?? f.database,
      user: dbInfo.user ?? f.user,
    }));
  }, [dbInfo]);

  const dbUrl = buildPgUrl(dbForm);
  const dbFormValid = !!(dbForm.host.trim() && dbForm.database.trim() && dbForm.user.trim()
    && /^\d+$/.test(dbForm.port) && Number(dbForm.port) > 0 && Number(dbForm.port) <= 65535);

  async function testDb() {
    setError(null); setDbTesting(true); setDbTest(null);
    try {
      setDbTest(await apiPost<NonNullable<typeof dbInfo>>("/api/v1/setup/database/test", { url: dbUrl }));
    } catch (e) {
      setDbTest({ ok: false, error: e instanceof ApiError ? e.message : tr("su.dbTestFailed") });
    } finally { setDbTesting(false); }
  }

  const precheckOk = items.length > 0 && items.every((i) => i.ok);
  const passwordOk = admin.password.length >= 12 && admin.password === admin.confirm;
  const stepTitles = STEP_KEYS.map((k) => tr(k));
  const stepDescriptions = STEP_DESC_KEYS.map((k) => tr(k));

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/v1/setup/complete", {
        admin: { username: admin.username, email: admin.email, password: admin.password, name: admin.name },
        org,
        integrations: {
          storage,
          smtp: smtp.host
            ? { host: smtp.host, port: Number(smtp.port) || 587, user: smtp.user || null, password: smtp.password || null, from: smtp.from || null }
            : null,
        },
      });
      void navigate({ to: "/login" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("su.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  const canNext =
    (step === 1 && precheckOk) ||
    (step === 2 && dbMode === "current") ||
    (step === 3 && admin.username.length >= 3 && admin.email.includes("@") && passwordOk && admin.name.length > 0) ||
    (step === 4 && org.name.trim().length > 0) ||
    step === 5;

  return (
    <div className="setup-page">
      <header className="setup-topbar">
        <div className="product-mark setup-brand">
          <BrandMark className="brand-mark" />
          <strong>{tr("app.name")}</strong>
          <span className="setup-brand-tag">{tr("app.tagline")}</span>
        </div>
        <div className="public-display-controls"><LocaleSwitcher menu /><ThemeToggle syncPreference={false} /></div>
      </header>

      <main className="setup-main">
        <div className="setup-frame">
          <aside className="setup-rail" aria-label={tr("su.wizardEyebrow")}>
            <ol className="setup-steps">
              {stepTitles.map((title, i) => {
                const n = i + 1;
                const state = n < step ? "done" : n === step ? "current" : "todo";
                return (
                  <li key={title} className="setup-step" data-state={state}
                    aria-current={n === step ? "step" : undefined} title={title}>
                    <span className="setup-step-marker" aria-hidden="true">
                      {state === "done" ? <Icon name="check" size={13} /> : n}
                    </span>
                    <span className="setup-step-text"><strong>{title}</strong></span>
                  </li>
                );
              })}
            </ol>
            <p className="setup-rail-foot">{tr("su.wizardFoot")}</p>
          </aside>

          <section className="setup-content">
            <header className="setup-content-head">
              <h1 className="page-title setup-title">{step}. {stepTitles[step - 1]}</h1>
              <p className="setup-sub">{stepDescriptions[step - 1]}</p>
            </header>

            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="setup-body">
              {step === 1 && (
                <div>
                  {precheckLoading && <p className="muted">{tr("su.checking")}</p>}
                  <ul className="setup-checks">
                    {items.map((i) => (
                      <li key={i.key} className="setup-check" data-ok={i.ok ? "true" : "false"}>
                        <span className="setup-check-mark" aria-hidden="true">
                          <Icon name={i.ok ? "check" : "x"} size={13} />
                        </span>
                        <span>{i.message}</span>
                      </li>
                    ))}
                  </ul>
                  {!precheckLoading && !precheckOk && (
                    <div className="alert" style={{ marginTop: 16 }}>{tr("su.checkFailed")}</div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div>
                  <div className="setup-db-choice" role="radiogroup" aria-label={tr("su.dbModeTitle")}>
                    <button type="button" role="radio" aria-checked={dbMode === "current"}
                      className={`setup-db-choice-card${dbMode === "current" ? " is-active" : ""}`}
                      onClick={() => { setDbMode("current"); setDbTest(null); }}>
                      <span className="setup-db-choice-radio" aria-hidden="true">{dbMode === "current" ? "●" : "○"}</span>
                      <span><strong>{tr("su.dbModeCurrent")}</strong><small>{tr("su.dbModeCurrentHint")}</small></span>
                      <span className="tag tag-success">{tr("su.dbModeInUse")}</span>
                    </button>
                    <button type="button" role="radio" aria-checked={dbMode === "external"}
                      className={`setup-db-choice-card${dbMode === "external" ? " is-active" : ""}`}
                      onClick={() => { setDbMode("external"); setDbTest(null); }}>
                      <span className="setup-db-choice-radio" aria-hidden="true">{dbMode === "external" ? "●" : "○"}</span>
                      <span><strong>{tr("su.dbModeExternal")}</strong><small>{tr("su.dbModeExternalHint")}</small></span>
                    </button>
                  </div>
                  {dbMode === "external" && (
                    <div className="alert alert-warning" role="note" style={{ marginTop: 12 }}>
                      {tr("su.dbModeExternalWarn")}
                    </div>
                  )}
                  {dbMode === "current" && <div className="alert setup-note">{tr("su.dbNoEmbedded")}</div>}
                  {dbLoading && <p className="muted">{tr("common.loading")}</p>}
                  {dbMode === "current" && dbInfo && !dbInfo.ok && <p className="field-error" role="alert">{dbInfo.error ?? tr("su.dbLoadFailed")}</p>}
                  {dbMode === "current" && dbInfo?.ok && (
                    <div className="setup-db-card" style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="setup-db-name">{tr("su.dbCurrent")}</span>
                        <span className={`tag ${dbInfo.compatible ? "tag-success" : "tag-danger"}`} title={dbInfo.version}>
                          {dbInfo.version?.match(/^PostgreSQL\s+[\d.]+/u)?.[0] || dbInfo.version || "PostgreSQL"}
                        </span>
                        <span className="muted mono">{dbInfo.maskedUrl}</span>
                      </div>
                      <dl className="setup-db-facts">
                        <div><dt>{tr("su.dbHost")}</dt><dd className="mono">{dbInfo.host} / {dbInfo.database}</dd></div>
                        <div><dt>{tr("su.dbUser")}</dt><dd className="mono">{dbInfo.user}</dd></div>
                        <div><dt>{tr("su.dbExtensions")}</dt><dd className="setup-ext-list">
                          <span className={dbInfo.extensions?.vector ? "tag tag-success" : "tag tag-warning"}>pgvector {dbInfo.extensions?.vector ? "✓" : "×"}</span>
                          <span className={dbInfo.extensions?.zhparser ? "tag tag-success" : "tag tag-warning"}>zhparser {dbInfo.extensions?.zhparser ? "✓" : "×"}</span>
                          <span className={dbInfo.extensions?.pgTrgm ? "tag tag-success" : "tag tag-warning"}>pg_trgm {dbInfo.extensions?.pgTrgm ? "✓" : "×"}</span>
                        </dd></div>
                      </dl>
                      <p className="muted" style={{ margin: "10px 0 0", fontSize: "var(--text-xs)", lineHeight: 1.6 }}>
                        <strong>{tr("su.dbVersionRequirement")}</strong>
                        {dbInfo.compatible ? tr("su.dbVersionOk") : tr("su.dbVersionBad")}
                        {!dbInfo.extensions?.vector && <> · {tr("su.dbVectorImpact")}</>}
                        {!dbInfo.extensions?.zhparser && <> · {tr("su.dbZhparserImpact")}</>}
                      </p>
                    </div>
                  )}

                  {dbMode === "external" && (
                    <p className="muted" style={{ marginTop: 8, fontSize: "var(--text-xs)" }}>
                      {tr("su.dbCurrentStillUsing")} <code className="mono">{dbInfo?.maskedUrl ?? "—"}</code>
                    </p>
                  )}
                  {dbMode === "external" && (
                  <details className="setup-details" open>
                    <summary>{tr("su.dbExternalTitle")}</summary>
                    <p className="muted setup-db-hint">{tr("su.dbExternalHint")}</p>
                    <div className="setup-form-grid setup-db-form">
                      <TextInput label={tr("su.dbHostLabel")} value={dbForm.host} placeholder="db.example.com"
                        onChange={(e) => setDbForm({ ...dbForm, host: e.target.value })} />
                      <TextInput label={tr("su.dbPort")} value={dbForm.port} inputMode="numeric" placeholder="5432"
                        onChange={(e) => setDbForm({ ...dbForm, port: e.target.value.replace(/\D/g, "") })} />
                      <TextInput label={tr("su.dbName")} value={dbForm.database} placeholder="feronavi"
                        onChange={(e) => setDbForm({ ...dbForm, database: e.target.value })} />
                      <TextInput label={tr("su.dbUserLabel")} value={dbForm.user} placeholder="feronavi"
                        onChange={(e) => setDbForm({ ...dbForm, user: e.target.value })} />
                      <TextInput label={tr("su.dbPassword")} type="password" autoComplete="new-password" value={dbForm.password}
                        placeholder={tr("su.dbPasswordHint")} onChange={(e) => setDbForm({ ...dbForm, password: e.target.value })} />
                      <Select label={tr("su.dbSsl")} value={dbForm.ssl} ariaLabel={tr("su.dbSsl")}
                        onChange={(v) => setDbForm({ ...dbForm, ssl: v })}
                        options={[
                          { value: "disable", label: tr("su.dbSslDisable") },
                          { value: "prefer", label: tr("su.dbSslPrefer") },
                          { value: "require", label: tr("su.dbSslRequire") },
                          { value: "verify-full", label: tr("su.dbSslVerify") },
                        ]} />
                    </div>
                    <div className="setup-db-preview">
                      <span>{tr("su.dbPreview")}</span>
                      <code>{dbFormValid ? maskPgUrl(dbUrl) : tr("su.dbFormRequired")}</code>
                    </div>
                    <div className="setup-db-actions">
                      <Button variant="primary" loading={dbTesting} disabled={!dbFormValid || dbTesting} onClick={() => void testDb()}>
                        {tr("su.dbTest")}
                      </Button>
                    </div>
                    {dbTest && (
                      <div style={{ marginTop: 12 }}>
                        {dbTest.ok ? (
                          <div className="setup-db-card">
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span className="tag tag-success">{tr("su.dbTestOk")}</span>
                              <span className="mono">{dbTest.version}</span>
                              <span className={dbTest.compatible ? "tag tag-success" : "tag tag-danger"}>{dbTest.compatible ? tr("su.dbVersionOkShort") : tr("su.dbVersionBadShort")}</span>
                            </div>
                            <p className="muted" style={{ margin: "8px 0 0", fontSize: "var(--text-xs)" }}>
                              {tr("su.dbExtensionSummary", {
                                vector: dbTest.extensions?.vector ? "✓" : "×",
                                zhparser: dbTest.extensions?.zhparser ? "✓" : "×",
                                trgm: dbTest.extensions?.pgTrgm ? "✓" : "×",
                              })}
                            </p>
                            <p className="muted" style={{ margin: "8px 0 0", fontSize: "var(--text-xs)" }}>{tr("su.dbTestRestart")}</p>
                            <pre className="setup-db-env">DATABASE_URL={dbUrl}</pre>
                          </div>
                        ) : <p className="field-error" role="alert">{dbTest.error ?? tr("su.dbTestFailed")}</p>}
                      </div>
                    )}
                  </details>
                  )}
                </div>
              )}

              {step === 3 && (
                <div>
                  <TextInput id="s-user" label={tr("su.username")} hint={tr("su.usernameRule")} autoComplete="off"
                    value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value.toLowerCase() })} />
                  <TextInput id="s-name" label={tr("su.displayName")} value={admin.name}
                    onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
                  <TextInput id="s-email" label={tr("su.email")} type="email" value={admin.email}
                    onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
                  <TextInput id="s-pass" label={tr("su.password")} type="password" autoComplete="new-password"
                    value={admin.password}
                    error={admin.password.length > 0 && admin.password.length < 12 ? tr("su.passwordRule") : undefined}
                    hint={admin.password.length > 0 && admin.password.length < 12 ? undefined : tr("su.passwordRule")}
                    onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
                  <TextInput id="s-confirm" label={tr("su.confirmPassword")} type="password" autoComplete="new-password"
                    value={admin.confirm}
                    error={admin.confirm.length > 0 && admin.password !== admin.confirm ? tr("su.passwordMismatch") : undefined}
                    onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} />
                </div>
              )}

              {step === 4 && (
                <div>
                  <div className="setup-db-choice" role="radiogroup" aria-label={tr("su.orgKindTitle")}>
                    <button type="button" role="radio" aria-checked={org.kind === "COMPANY"}
                      className={`setup-db-choice-card${org.kind === "COMPANY" ? " is-active" : ""}`}
                      onClick={() => setOrg({ ...org, kind: "COMPANY" })}>
                      <span className="setup-db-choice-radio" aria-hidden="true">{org.kind === "COMPANY" ? "●" : "○"}</span>
                      <span><strong>{tr("su.orgKindCompany")}</strong><small>{tr("su.orgKindCompanyHint")}</small></span>
                    </button>
                    <button type="button" role="radio" aria-checked={org.kind === "OPC"}
                      className={`setup-db-choice-card${org.kind === "OPC" ? " is-active" : ""}`}
                      onClick={() => setOrg({ ...org, kind: "OPC" })}>
                      <span className="setup-db-choice-radio" aria-hidden="true">{org.kind === "OPC" ? "●" : "○"}</span>
                      <span><strong>{tr("su.orgKindOpc")}</strong><small>{tr("su.orgKindOpcHint")}</small></span>
                    </button>
                  </div>
                  <TextInput id="o-name" label={tr("su.orgName")} value={org.name}
                    onChange={(e) => setOrg({ ...org, name: e.target.value })} />
                  <div className="setup-form-grid">
                    <Select label={tr("su.locale")} value={org.defaultLocale} ariaLabel={tr("su.locale")}
                      onChange={(v) => setOrg({ ...org, defaultLocale: v })}
                      options={[{ value: "zh-CN", label: tr("su.zhCN") }, { value: "en-US", label: "English" }]} />
                    <Select searchable label={tr("su.timezone")} hint={tr("su.timezoneRule")} value={org.defaultTimezone}
                      ariaLabel={tr("su.timezone")}
                      onChange={(v) => setOrg({ ...org, defaultTimezone: v })}
                      options={timeZoneOptions()} />
                  </div>
                  <Checkbox checked={org.seedDepartments} onChange={(v) => setOrg({ ...org, seedDepartments: v })}
                    label={tr("su.seedDepartments")} hint={tr("su.seedDepartmentsHint")} />
                </div>
              )}

              {step === 5 && (
                <div>
                  <h2 className="setup-group-title">{tr("su.smtp")}</h2>
                  <div className="setup-form-grid">
                    <TextInput id="m-host" label={tr("su.smtpHost")} value={smtp.host} placeholder={tr("setup.skipHint")}
                      onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
                    {smtp.host ? (
                      <TextInput id="m-port" label={tr("su.smtpPort")} value={smtp.port}
                        onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} />
                    ) : null}
                    {smtp.host ? (
                      <TextInput id="m-from" label={tr("su.smtpFrom")} value={smtp.from}
                        onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} />
                    ) : null}
                  </div>
                  <h2 className="setup-group-title">{tr("su.storage")}</h2>
                  <Select label={tr("su.storageMode")} value={storage.kind} ariaLabel={tr("su.storageMode")}
                    onChange={(v) => setStorage({ ...storage, kind: v as "local" | "s3" })}
                    options={[{ value: "local", label: tr("su.storageLocal") },
                      { value: "s3", label: tr("su.storageS3") }]} />
                  {storage.kind === "s3" && (
                    <div className="setup-form-grid setup-s3-grid">
                      <TextInput id="s3-endpoint" label={tr("su.s3Endpoint")} placeholder="https://s3.example.com"
                        value={storage.endpoint} onChange={(e) => setStorage({ ...storage, endpoint: e.target.value })} />
                      <TextInput id="s3-region" label={tr("su.s3Region")} placeholder="us-east-1"
                        value={storage.region} onChange={(e) => setStorage({ ...storage, region: e.target.value })} />
                      <TextInput id="s3-bucket" label={tr("su.s3Bucket")} placeholder="feronavi-attachments"
                        value={storage.bucket} onChange={(e) => setStorage({ ...storage, bucket: e.target.value })} />
                      <TextInput id="s3-prefix" label={tr("su.s3Prefix")} placeholder="optional/prefix"
                        value={storage.prefix} onChange={(e) => setStorage({ ...storage, prefix: e.target.value })} />
                      <TextInput id="s3-access" label={tr("su.s3AccessKey")} value={storage.accessKey}
                        onChange={(e) => setStorage({ ...storage, accessKey: e.target.value })} />
                      <TextInput id="s3-secret" label={tr("su.s3SecretKey")} type="password" value={storage.secretKey}
                        onChange={(e) => setStorage({ ...storage, secretKey: e.target.value })} />
                      <Checkbox label={tr("su.s3ForcePathStyle")} checked={storage.forcePathStyle}
                        onChange={(v) => setStorage({ ...storage, forcePathStyle: v })} />
                    </div>
                  )}
                </div>
              )}

              {step === 6 && (
                <div>
                  <div className="alert setup-note">
                    {tr("su.reviewHint")}<strong>{tr("su.onceOnly")}</strong>
                  </div>
                  <dl className="setup-review">
                    <div><dt>{tr("su.admin")}</dt><dd>{admin.name}（{admin.username}）</dd></div>
                    <div><dt>{tr("su.emailLabel")}</dt><dd>{admin.email}</dd></div>
                    <div><dt>{tr("su.org")}</dt><dd>{org.name} · {org.kind === "OPC" ? tr("su.orgKindOpc") : tr("su.orgKindCompany")}</dd></div>
                    <div><dt>{tr("su.localeTimezone")}</dt><dd>{org.defaultLocale} · {org.defaultTimezone}</dd></div>
                    <div><dt>SMTP</dt><dd>{smtp.host || tr("su.notConfigured")}</dd></div>
                  </dl>
                </div>
              )}
            </div>

            <footer className="setup-actions">
              {step === 2 && dbMode === "external" && (
                <span className="setup-actions-note">{tr("su.dbModeNextBlocked")}</span>
              )}
              <Button disabled={step === 1 || busy} onClick={() => { setError(null); setStep(step - 1); }}>
                {tr("su.prev")}
              </Button>
              <span className="setup-actions-spacer" />
              {step < 6 ? (
                <Button variant="primary" disabled={!canNext} onClick={() => { setError(null); setStep(step + 1); }}>
                  {tr("su.next")}
                </Button>
              ) : (
                <Button variant="primary" loading={busy} disabled={busy} onClick={() => void submit()}>
                  {busy ? tr("su.creating") : tr("su.finish")}
                </Button>
              )}
            </footer>
          </section>
        </div>
      </main>
    </div>
  );
}


function maskPgUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.username}${u.password ? ":***" : ""}@${u.host}${u.pathname}${u.search}`;
  } catch { return "postgres://***"; }
}

function buildPgUrl(f: { host: string; port: string; database: string; user: string; password: string; ssl: string }): string {
  const host = f.host.trim().replace(/^\[|\]$/g, "");
  const hostPart = host.includes(":") ? `[${host}]` : host;
  const user = encodeURIComponent(f.user.trim());
  const pass = f.password ? `:${encodeURIComponent(f.password)}` : "";
  const dbName = f.database.trim().replace(/^\//, "");
  const ssl = f.ssl && f.ssl !== "prefer" ? `?sslmode=${encodeURIComponent(f.ssl)}` : "";
  return `postgres://${user}${pass}@${hostPart}:${f.port}/${dbName}${ssl}`;
}
