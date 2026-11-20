/**
 * 系统自检与运维页（第十四期；Round 94 仪表盘化）
 *
 * 定位：把"只有 SSH 才能看到"的状态搬到界面上 —— 实例与迁移、备份与恢复、AI 配置、
 * 我的安全。仪表盘化原则（用户要求）：
 *   1 先给**一眼能看懂的状态**（KPI 卡 + 异常置顶），再给明细；
 *   2 明细按主题分组，不把长段文字平铺；
 *   3 原始命令/升级步骤/调度间隔放 `<details>` 展开，不占主视觉；
 *   4 真实数据，不伪造"已同步/正常"等状态。
 *
 * 数据库级灾备仍由部署方执行；应用迁移包只覆盖产品支持的数据范围。
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkButton } from "../components/ui/LinkButton.tsx";
import { ArrowLink } from "../components/ui/ArrowLink.tsx";
import { Button } from "../components/ui/Button.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { PageHead } from "../components/Page.tsx";
import { useActor, useCan } from "../lib/actor.ts";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { FeatureFlagSettings } from "../components/settings/FeatureFlagSettings.tsx";
import { SystemBackupPanel } from "../components/system/SystemBackupPanel.tsx";
import { toast } from "../components/ui/Toast.tsx";

interface MigrationStatus {
  applied: number; files: number; consistent: boolean; latestAppliedAt: string | null;
  externalDatabase: boolean; upgradeFlow: string[]; notes: string[];
}
interface AiStatus { configured: boolean; dimensionOk: boolean; model?: string; dimensions?: number; message?: string }
interface TwoFaState { enabled: boolean; pending: boolean }
interface IpGeoStatus { available: boolean; source: "custom" | "bundled" | null; dataDate: string | null; sizeBytes: number | null; lastCheckAt: string | null; lastUpdateAt: string | null }
interface PlatformUpdateStatus { configured: boolean; current: string; latest: string | null; releaseUrl: string | null; hasUpdate: boolean; checkedAt: string | null; error: string | null }
interface OpsStatus {
  generatedAt: string;
  knowledge: { queries30d: number };
  jobs: Record<string, number>;
  webhooks: { endpoints: number; pending: number; retrying: number; dead: number; succeeded: number };
  retention: { auditDays: number; activityDays: number; auditRows: number; activityRows: number; exportHours: number; exportFiles: number; exportBytes: number };
  integrations: { total: number; active: number };
  featureFlags: { total: number; enabled: number };
  mcp: { clients: number; calls: number; policies: number };
  schedulers: { snapshotIntervalMs: number; retentionSweepIntervalMs: number; webhookRetryIntervalMs: number; integrationSyncIntervalMs: number; jobWorkerIntervalMs: number };
}
const fmtInterval = (ms: number) => (ms <= 0 ? "off" : ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)}h` : ms >= 60_000 ? `${Math.round(ms / 60_000)}min` : `${Math.round(ms / 1000)}s`);

const BACKUP_CMD = "DATABASE_URL=... DATA_DIR=/data ./scripts/backup.sh ./backups";
const RESTORE_STEPS = [
  "docker compose stop app",
  t("sys.step1"),
  'psql "$DATABASE_URL" < db.sql',
  t("sys.step2"),
  "docker compose up -d app && curl -fsS http://localhost:3000/api/v1/system/status",
];

function StatRow({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="sys-stat-row">
      <span className="muted">{label}</span>
      <strong className={danger ? "sys-stat-danger" : ""}>{value}</strong>
    </div>
  );
}

export function SystemPage() {
  const locale = useLocale();
  const actor = useActor();
  const canExport = useCan("setting:manage");
  const canOps = actor.permissions.includes("setting:manage");
  type SysTab = "overview" | "ops" | "data" | "integrations" | "security";
  const SYS_TABS: { id: SysTab; label: string }[] = [
    { id: "overview", label: t("sys.tabOverview") },
    { id: "ops", label: t("sys.tabOps") },
    { id: "data", label: t("sys.tabData") },
    { id: "integrations", label: t("sys.tabIntegrations") },
    { id: "security", label: t("sys.tabSecurity") },
  ];
  const [tab, setTab] = useState<SysTab>(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    return (SYS_TABS.some((x) => x.id === q) ? q : "overview") as SysTab;
  });
  const switchTab = (id: SysTab) => { setTab(id); window.history.replaceState(null, "", `/system?tab=${id}`); };
  const status = useQuery({ queryKey: ["sys-status"], queryFn: () => apiGet<{ ok: boolean; version: string }>("/api/v1/system/status") });
  const migrations = useQuery({ queryKey: ["sys-migrations"], queryFn: () => apiGet<MigrationStatus>("/api/v1/system/migrations") });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => apiGet<AiStatus>("/api/v1/knowledge/ai-status") });
  const twoFa = useQuery({ queryKey: ["2fa-state"], queryFn: () => apiGet<TwoFaState>("/api/v1/auth/2fa") });
  const ops = useQuery({ queryKey: ["sys-ops"], queryFn: () => apiGet<OpsStatus>("/api/v1/system/operations"), enabled: canOps, retry: false });
  const ipgeo = useQuery({ queryKey: ["sys-ipgeo"], queryFn: () => apiGet<IpGeoStatus>("/api/v1/system/ipgeo"), enabled: canOps, retry: false });
  const updateCheck = useQuery({ queryKey: ["sys-update-check"], queryFn: () => apiGet<PlatformUpdateStatus>("/api/v1/system/update-check"), enabled: canOps, retry: false });
  const qc = useQueryClient();
  const geoUpdate = useMutation({
    mutationFn: () => apiPost<IpGeoStatus>("/api/v1/system/ipgeo/update", {}),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["sys-ipgeo"] }); },
  });
  const updateNow = useMutation({
    mutationFn: () => apiPost<PlatformUpdateStatus>("/api/v1/system/update-check", {}),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["sys-update-check"] }); },
  });

  const m = migrations.data;
  const o = ops.data;
  const refreshAll = () => {
    void status.refetch(); void migrations.refetch(); void ai.refetch(); void twoFa.refetch(); void ops.refetch();
    if (canOps) { void ipgeo.refetch(); void updateCheck.refetch(); }
  };
  const overviewChecks = [status, migrations, ai, twoFa, ...(canOps ? [ops, ipgeo, updateCheck] : [])];
  const overviewError = overviewChecks.find((query) => query.isError)?.error;
  const overviewLoading = overviewChecks.some((query) => query.isPending || query.isFetching);

  const alerts: { tone: "danger" | "warning"; text: string }[] = [];
  if (status.data && !status.data.ok) alerts.push({ tone: "danger", text: t("sys.alertService") });
  if (m && !m.consistent) alerts.push({ tone: "danger", text: t("sys.alertMigration", { applied: m.applied, files: m.files }) });
  if (o && o.webhooks.dead > 0) alerts.push({ tone: "danger", text: t("sys.alertDeadWebhooks", { n: o.webhooks.dead }) });
  if (o && (o.jobs.DEAD ?? 0) > 0) alerts.push({ tone: "danger", text: t("sys.alertDeadJobs", { n: o.jobs.DEAD ?? 0 }) });
  if (m?.externalDatabase) alerts.push({ tone: "warning", text: t("sys.externalDb") });

  const jobs = o?.jobs ?? {};
  const deadWebhooks = o?.webhooks.dead ?? 0;
  const deadJobs = jobs.DEAD ?? 0;

  return (
    <div className="page sys-page">
      <PageHead title={t("sys.title")}
        actions={<Button size="sm" onClick={refreshAll}>{t("sys.refresh")}</Button>} />

      {/* 页签：一页一事（IA 规划 P1）——概览只留状态与 KPI，其余按域分页签 */}
      <PageTabs id="system" label={t("sys.tablist")} value={tab} onChange={switchTab} className="sys-tabbar"
        tabs={SYS_TABS.map(item => ({ value: item.id, label: item.label }))} />

      <TabPanel tabsId="system" value="overview" activeValue={tab} className="page-tab-panel--stack">{() => <>
      {overviewLoading && <LoadingBlock compact />}
      {overviewError && <StateBlock kind="error" title={t("common.loadFailedShort")}
        description={overviewError instanceof ApiError ? overviewError.message : undefined}
        action={refreshAll} actionLabel={t("common.reload")} />}
      {/* 异常置顶 / 全绿横幅 */}
      {alerts.length > 0 ? (
        <div className="sys-alert-stack" role="alert">
          {alerts.map((a, i) => (
            <div key={i} className={`sys-alert ${a.tone === "danger" ? "is-danger" : "is-warning"}`}>
              <span className="sys-alert-dot" aria-hidden="true" />
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      ) : !overviewLoading && !overviewError ? (
        <div className="sys-all-ok" role="status">
          <span className="sys-all-ok-dot" aria-hidden="true" />
          {t("sys.allOk")}
        </div>
      ) : null}

      {/* KPI */}
      <div className="sys-kpi-grid">
        <MetricCard label={t("sys.kpiService")} value={status.data ? (status.data.ok ? t("sys.ok") : t("sys.abnormal")) : "—"}
          detail={`${t("sys.version")}${status.data?.version ?? "—"}`} tone={status.data?.ok ? "success" : "warning"} />
        <MetricCard label={t("sys.kpiMigration")} value={m ? (m.consistent ? t("sys.consistent") : t("sys.inconsistent")) : "—"}
          detail={m ? `${t("sys.ledger")}${m.applied} / ${t("sys.files")}${m.files}` : "—"} tone={m?.consistent ? "success" : "warning"} />
        <MetricCard label={t("sys.kpiJobs")} value={o ? String((jobs.PENDING ?? 0) + (jobs.RUNNING ?? 0)) : "—"}
          detail={`${t("sys.opsJobsDead")} ${o ? deadJobs : "—"}`} tone={deadJobs > 0 ? "warning" : "neutral"} />
        <MetricCard label={t("sys.kpiDeadWebhooks")} value={o ? String(deadWebhooks) : "—"}
          detail={`${t("sys.opsPending")} ${o?.webhooks.pending ?? "—"} · ${t("sys.opsRetrying")} ${o?.webhooks.retrying ?? "—"}`}
          tone={deadWebhooks > 0 ? "warning" : "neutral"} />
      </div>

      <div className="sys-overview-details">
        <section className="card sys-section">
          <div className="sys-section-head">
            <h2>{t("sys.tabOverview")}</h2>
          </div>
          <div className="sys-groups sys-groups--compact">
            <div className="sys-group">
              <h3>{t("sys.kpiService")}</h3>
              <StatRow label={t("sys.version")} value={status.data?.version ?? "—"} />
              <StatRow label={t("sys.kpiMigration")} value={m ? (m.consistent ? t("sys.consistent") : t("sys.inconsistent")) : "—"} />
              <StatRow label={t("sys.ledger")} value={m ? m.applied : "—"} />
              <StatRow label={t("sys.files")} value={m ? m.files : "—"} />
            </div>
            <div className="sys-group">
              <h3>{t("sys.kpiJobs")} / {t("sys.kpiDeadWebhooks")}</h3>
              <StatRow label={t("sys.opsJobsPending")} value={jobs.PENDING ?? 0} />
              <StatRow label={t("sys.opsJobsRunning")} value={jobs.RUNNING ?? 0} />
              <StatRow label={t("sys.opsJobsDead")} value={deadJobs} danger={deadJobs > 0} />
              <StatRow label={t("sys.opsEndpoints")} value={o?.webhooks.endpoints ?? 0} />
              <StatRow label={t("sys.opsPending")} value={o?.webhooks.pending ?? 0} />
              <StatRow label={t("sys.opsRetrying")} value={o?.webhooks.retrying ?? 0} />
            </div>
          </div>
        </section>
        <section className="card sys-section">
          <div className="sys-section-head">
            <h2>{t("sys.tabIntegrations")}</h2>
          </div>
          <div className="sys-groups sys-groups--compact">
            <div className="sys-group">
              <h3>{t("sys.opsIntegrations")}</h3>
              <StatRow label={t("sys.opsIntegrations")} value={o ? `${o.integrations.active}/${o.integrations.total}` : "—"} />
              <StatRow label={t("sys.opsFlags")} value={o ? `${o.featureFlags.enabled}/${o.featureFlags.total}` : "—"} />
              <StatRow label={t("sys.opsMcp")} value={o ? `${o.mcp.clients}（${o.mcp.calls}）` : "—"} />
              <StatRow label={t("sys.opsKnowledge")} value={o ? o.knowledge.queries30d : "—"} />
            </div>
            <div className="sys-group">
              <h3>{t("sys.tabSecurity")}</h3>
              <StatRow label="2FA" value={twoFa.data?.enabled ? t("sys.ok") : "—"} />
              <StatRow label="AI" value={ai.data?.configured ? t("sys.ok") : "—"} />
              <StatRow label="IP Geo" value={ipgeo.data?.available ? t("sys.ok") : "—"} />
              <StatRow label={t("sys.version")} value={status.data?.version ?? "—"} />
            </div>
          </div>
        </section>
      </div>
      </>}</TabPanel>

      <TabPanel tabsId="system" value="ops" activeValue={tab} className="page-tab-panel--stack">{() => <>
      <div className="sys-dashboard-grid sys-dashboard-grid--single">
        <div className="sys-col sys-col-main">
        {/* 运维状态（保持原有验收文本） */}
        {canOps && (
          <section className="card sys-section sys-section--wide" aria-labelledby="sys-ops-title">
            <div className="sys-section-head">
              <div>
                <h2 id="sys-ops-title">{t("sys.ops")}</h2>
                <p className="muted">{locale === "zh-CN" ? "查看消息投递、后台任务、数据保留期与各项集成的运行状态。" : "View message delivery, background tasks, data retention and integration status."}</p>
              </div>
            </div>
            {ops.isLoading && <LoadingBlock compact />}
            {ops.isError && <p className="muted">{t("sys.opsLoadFailed")}</p>}
            {o && (
              <>
                <div className="sys-groups">
                  <div className="sys-group">
                    <h3>{t("sys.opsWebhook")}</h3>
                    <StatRow label={t("sys.opsEndpoints")} value={o.webhooks.endpoints} />
                    <StatRow label={t("sys.opsPending")} value={o.webhooks.pending} />
                    <StatRow label={t("sys.opsRetrying")} value={o.webhooks.retrying} />
                    <StatRow label={t("sys.opsDead")} value={o.webhooks.dead} danger={o.webhooks.dead > 0} />
                    <StatRow label={t("sys.opsSucceeded")} value={o.webhooks.succeeded} />
                  </div>
                  <div className="sys-group">
                    <h3>{t("sys.opsJobs")}</h3>
                    <StatRow label={t("sys.opsJobsPending")} value={jobs.PENDING ?? 0} />
                    <StatRow label={t("sys.opsJobsRunning")} value={jobs.RUNNING ?? 0} />
                    <StatRow label={t("sys.opsJobsDead")} value={deadJobs} danger={deadJobs > 0} />
                  </div>
                  <div className="sys-group">
                    <h3>{t("sys.opsRetention")}</h3>
                    <StatRow label={t("sys.opsAuditDays")} value={`${o.retention.auditDays} ${t("sys.opsDays")}`} />
                    <StatRow label={t("sys.opsActivityDays")} value={`${o.retention.activityDays} ${t("sys.opsDays")}`} />
                    <StatRow label={t("sys.opsRows")} value={`${o.retention.auditRows} / ${o.retention.activityRows}`} />
                    <StatRow label={t("sys.opsExportPkg")} value={`${o.retention.exportHours}h · ${o.retention.exportFiles} 个`} />
                  </div>
                  <div className="sys-group">
                    <h3>{t("sys.opsOthers")}</h3>
                    <StatRow label={t("sys.opsIntegrations")} value={`${o.integrations.active}/${o.integrations.total}`} />
                    <StatRow label={t("sys.opsFlags")} value={`${o.featureFlags.enabled}/${o.featureFlags.total}`} />
                    <StatRow label={t("sys.opsMcp")} value={`${o.mcp.clients}（${o.mcp.calls}）`} />
                    <StatRow label={t("sys.opsPolicies")} value={o.mcp.policies} />
                  </div>
                  <div className="sys-group">
                    <h3>{t("sys.opsKnowledge")}</h3>
                    <StatRow label={t("sys.opsQueries30d")} value={o.knowledge.queries30d} />
                  </div>
                </div>
                <div className="sys-scheduler-summary">
                  <StatRow label={t("sys.opsSchedulers")} value={`${t("sys.opsJobWorker")} ${fmtInterval(o.schedulers.jobWorkerIntervalMs)}`} />
                </div>
                <details className="sys-details">
                  <summary>{t("sys.schedulersTitle")}</summary>
                  <div className="sys-scheduler-grid">
                    <StatRow label={t("sys.opsSnapshot")} value={fmtInterval(o.schedulers.snapshotIntervalMs)} />
                    <StatRow label={t("sys.opsRetentionSweep")} value={fmtInterval(o.schedulers.retentionSweepIntervalMs)} />
                    <StatRow label={t("sys.opsWebhookRetry")} value={fmtInterval(o.schedulers.webhookRetryIntervalMs)} />
                    <StatRow label={t("sys.opsIntegrationSync")} value={fmtInterval(o.schedulers.integrationSyncIntervalMs)} />
                    <StatRow label={t("sys.opsJobWorker")} value={fmtInterval(o.schedulers.jobWorkerIntervalMs)} />
                  </div>
                </details>
              </>
            )}
            <details className="sys-details sys-backup-ops-details">
              <summary>{t("sys.backupOpsTitle")}</summary>
              <p className="muted">
                {t("sys.backupByDeployer")}<strong>{t("sys.backupThree")}</strong>{t("sys.backupWhy")}
              </p>
              <pre className="sys-pre" data-custom-scroll>{BACKUP_CMD}</pre>
              <h3>{t("sys.restoreSteps")}</h3>
              <ol className="muted sys-steps">{RESTORE_STEPS.map((step) => <li key={step}>{step}</li>)}</ol>
            </details>
          </section>
        )}
        </div>
      </div>
      </>}</TabPanel>

      <TabPanel tabsId="system" value="data" activeValue={tab} className="page-tab-panel--stack">{() => <>

        {/* 迁移与升级 */}
        <section className="card sys-section" aria-labelledby="sys-mig-title">
          <div className="sys-section-head"><h2 id="sys-mig-title">{t("sys.migrations")}</h2></div>
          {migrations.isLoading && <LoadingBlock compact />}
          {migrations.isError && <div role="alert"><p className="field-error">{migrations.error instanceof ApiError && migrations.error.status === 403 ? t("sys.migNeedPerm") : t("common.loadFailedShort")}</p><Button size="sm" onClick={() => void migrations.refetch()}>{t("common.reload")}</Button></div>}
          {m && (
            <>
              <div className="sys-groups sys-groups--compact">
                <div className="sys-group">
                  <StatRow label={t("sys.ledger")} value={`${m.applied} ${t("sys.rows")}`} />
                  <StatRow label={t("sys.files")} value={`${m.files} ${t("sys.items")}`} />
                  <StatRow label={t("sys.consistency")} value={m.consistent ? t("sys.consistent") : t("sys.inconsistent")} danger={!m.consistent} />
                </div>
              </div>
              {m.notes.map((n, i) => <div key={i} className={m.consistent ? "alert alert-info" : "alert alert-error"} style={{ marginTop: 10 }}>{n}</div>)}
              <details className="sys-details">
                <summary>{t("sys.upgradeSteps")}</summary>
                <ol className="muted sys-steps">{m.upgradeFlow.map((s) => <li key={s}>{s}</li>)}</ol>
              </details>
            </>
          )}
        </section>

        {canExport && <SystemBackupPanel />}
      </>}</TabPanel>

      <TabPanel tabsId="system" value="integrations" activeValue={tab} className="page-tab-panel--stack">{() => <>

        {/* IP 归属地库（内置 + 在线更新） */}
        {canOps && (
          <section className="card sys-section" aria-labelledby="sys-ipgeo-title">
            <div className="sys-section-head">
              <div>
                <h2 id="sys-ipgeo-title">{t("sys.ipgeoTitle")}</h2>
                <p className="muted">{t("sys.ipgeoSub")}</p>
              </div>
            </div>
            {ipgeo.isLoading && <LoadingBlock compact />}
            {ipgeo.isError && <p className="muted">{t("sys.loadFailedShort")}</p>}
            {ipgeo.data && (
              <>
                <div className="sys-ai-state">
                  {ipgeo.data.available
                    ? <><span>{ipgeo.data.source === "custom" ? t("sys.ipgeoSourceUpdated") : t("sys.ipgeoSourceBundled")}</span>
                        <span className="tag tag-success">{t("sys.ipgeoReady")}</span></>
                    : <span className="muted">{t("sys.ipgeoUnavailable")}</span>}
                </div>
                {ipgeo.data.available && (
                  <div>
                    <StatRow label={t("sys.ipgeoDataDate")} value={ipgeo.data.dataDate ? new Date(ipgeo.data.dataDate).toLocaleDateString() : "—"} />
                    <StatRow label={t("sys.ipgeoSize")} value={ipgeo.data.sizeBytes ? `${Math.round(ipgeo.data.sizeBytes / 1024)} KB` : "—"} />
                    <StatRow label={t("sys.ipgeoLastUpdate")} value={ipgeo.data.lastUpdateAt ? new Date(ipgeo.data.lastUpdateAt).toLocaleString() : t("sys.ipgeoNever")} />
                  </div>
                )}
                <div className="sys-actions">
                  <Button size="sm" variant="primary" loading={geoUpdate.isPending} onClick={() => geoUpdate.mutate()}>{t("sys.ipgeoUpdateNow")}</Button>
                  {geoUpdate.isError && <span className="field-error" role="alert">{geoUpdate.error instanceof ApiError ? geoUpdate.error.message : t("sys.ipgeoUpdateFailed")}</span>}
                  {geoUpdate.isSuccess && <span className="tag tag-success">{t("sys.ipgeoUpdateOk")}</span>}
                </div>
              </>
            )}
          </section>
        )}

        {/* 平台更新检查（只提示，不自动升级） */}
        {canOps && (
          <section className="card sys-section" aria-labelledby="sys-update-title">
            <div className="sys-section-head">
              <div>
                <h2 id="sys-update-title">{t("sys.updateTitle")}</h2>
                <p className="muted">{t("sys.updateSub")}</p>
              </div>
            </div>
            {updateCheck.isLoading && <LoadingBlock compact />}
            {updateCheck.data?.configured === false && <p className="muted">{t("sys.updateSourceUnset")}</p>}
            {updateCheck.data?.configured && (
              <>
                <div>
                  <StatRow label={t("sys.updateCurrent")} value={updateCheck.data.current} />
                  <StatRow label={t("sys.updateLatest")} value={updateCheck.data.latest ?? "—"} danger={updateCheck.data.hasUpdate} />
                  <StatRow label={t("sys.updateCheckedAt")} value={updateCheck.data.checkedAt ? new Date(updateCheck.data.checkedAt).toLocaleString() : "—"} />
                </div>
                <div className="sys-actions">
                  {updateCheck.data.hasUpdate
                    ? <span className="tag tag-warning">{t("sys.updateHasNew")}</span>
                    : <span className="tag tag-success">{t("sys.updateUpToDate")}</span>}
                  {updateCheck.data.releaseUrl && (
                    <ExternalLinkButton size="sm" href={updateCheck.data.releaseUrl}>{t("sys.updateReleaseNotes")}</ExternalLinkButton>
                  )}
                  <Button size="sm" loading={updateNow.isPending} onClick={() => updateNow.mutate()}>{t("sys.updateCheckNow")}</Button>
                  {updateNow.isError && <span className="field-error" role="alert">{updateNow.error instanceof ApiError ? updateNow.error.message : t("sys.updateCheckFailed")}</span>}
                </div>
                {updateCheck.data.error && <p className="muted sys-hint">{t("sys.updateCheckFailed")}（{updateCheck.data.error}）</p>}
              </>
            )}
          </section>
        )}

        {/* 功能开关：平台级实验/灰度配置，属于运维能力，不再放在用户设置 */}
        {canOps && (
          <div className="sys-feature-settings">
            <FeatureFlagSettings onSuccess={(m) => toast.success(m)} onError={(m) => toast.error(m)} />
          </div>
        )}

        {/* AI */}
        <section className="card sys-section" aria-labelledby="sys-ai-title">
          <div className="sys-section-head"><h2 id="sys-ai-title">AI（BYOK）</h2></div>
          {ai.data && (
            <div className="sys-ai-state">
              {ai.data.configured
                ? <><span>已配置：{ai.data.model}（{ai.data.dimensions} 维）</span><span className="tag tag-success">{t("sys.dimsOk")}</span></>
                : <span className="muted">{ai.data.message}</span>}
              {!ai.data.configured && <p className="muted">{t("sys.noAi")}</p>}
            </div>
          )}
        </section>
      </>}</TabPanel>

      <TabPanel tabsId="system" value="security" activeValue={tab} className="page-tab-panel--stack">{() => <>

        {/* 我的安全 */}
        <section className="card sys-section" aria-labelledby="sys-security-title">
          <div className="sys-section-head"><h2 id="sys-security-title">{t("sys.mySecurity")}</h2></div>
          <div className="sys-security-row">
            <span>双因素认证</span>
            {twoFa.data?.enabled ? <span className="tag tag-success">{t("sys.enabled")}</span>
              : twoFa.data?.pending ? <span className="tag tag-warning">{t("sys.pending")}</span>
              : <span className="tag">{t("sys.disabled")}</span>}
          </div>
          <p className="muted sys-hint">{t("sys.totpHint")}</p>
          <div className="sys-actions">
            <ExternalLinkButton size="sm" href="/api/v1/me/data-export" download>{t("sys.exportJson")}</ExternalLinkButton>
            <ArrowLink to="/settings">{t("sys.goSettings")}</ArrowLink>
            <ArrowLink to="/tokens">{t("sys.tokens")}</ArrowLink>
          </div>
        </section>
      </>}</TabPanel>

    </div>
  );
}
