import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * 洞察页（第十期 W7）：燃尽图 + 累积流 + 可配置挂件
 *
 * 三处刻意的设计：
 *   1 图表用**内联 SVG**，不引图表库 —— 依赖越少越能自托管，也便于用项目自己的令牌上色
 *   2 每张图都有 **`<details>` 表格兜底**：图表对读屏与色盲用户不友好，数据必须能"读"出来
 *   3 明确标注数据来源（`live` 实时推算 / `snapshot` 快照），并显示口径说明 ——
 *      指标最怕"图对了但没人知道怎么算的"
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useState } from "react";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { planning } from "../lib/planning-api.ts";
import { insight, type Burndown, type CumulativeFlow } from "../lib/insight-api.ts";
import { apiGet, apiPost, apiDelete, ApiError } from "../lib/api.ts";
import { confirmDialog } from "../components/Dialog.tsx";
import { PageHead } from "../components/Page.tsx";
import { Icon } from "../components/Icon.tsx";
import { Tooltip } from "../components/ui/Tooltip.tsx";
import { InfoTip } from "../components/ui/InfoTip.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { t as tr, useLocale } from "../i18n/index.ts";   // ⚠️ t 另有含义，i18n 用别名 tr
import { Select } from "../components/Select.tsx";
import { Button } from "../components/ui/Button.tsx";
import { LinkButton } from "../components/ui/LinkButton.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";

const W = 640, H = 200, PAD = 28;

/** 折线图：实际剩余 vs 理想线 */
function BurndownChart({ data }: { data: Burndown }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = data.points;
  /**
   * 空数据提示：项目没有工作项时，燃尽图会是一条贴底的平线 —— 那是**正确但难懂**的画法。
   * 不解释的话用户会以为图坏了。这里明说原因与下一步。
   */
  const empty = pts.every((p) => (p.scope ?? 0) === 0 && (p.remaining ?? 0) === 0);
  const max = Math.max(1, ...pts.map((p) => Math.max(p.scope, p.ideal)));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, pts.length - 1);
  const y = (v: number) => H - PAD - (v * (H - PAD * 2)) / max;
  const line = (get: (p: typeof pts[number]) => number) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");


  if (empty) return <div className="insight-chart-empty">{tr("in.burndownEmptyShort")}</div>;

  return (
    <div className="insight-chart chart-plot" onPointerLeave={() => setHover(null)}>
      
      <svg viewBox={`0 0 ${W} ${H}`} role="img" width="100%" height={H}
        aria-label={`燃尽图：${data.iteration.name}，${pts.length} 天，末日剩余 ${pts[pts.length - 1]?.remaining ?? 0} 点`}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border-strong)" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border-strong)" />
        {/* 理想线用虚线 + 次要文字色，避免与实际的强调色混淆 */}
        <path d={line((p) => p.ideal)} fill="none" stroke="var(--text-faint)" strokeWidth={2} strokeDasharray="4 4" />
        <path d={line((p) => p.remaining)} fill="none" stroke="var(--primary)" strokeWidth={2.5} />
        {pts.map((p, i) => (
          <Tooltip key={p.date} followPointer className="chart-hover-tip" content={<>
            <strong>{p.date}</strong><span>{tr("in.actualRemaining")} {p.remaining}</span>
            <span>{tr("in.colScope")} {p.scope} · {tr("in.colDone")} {p.done}</span>
          </>}>
            {(trigger) => <rect {...trigger} x={x(i) - Math.max(4, (W - PAD * 2) / Math.max(1, pts.length - 1) / 2)} y={PAD}
              width={Math.max(8, (W - PAD * 2) / Math.max(1, pts.length - 1))} height={H - PAD * 2} fill="transparent" pointerEvents="all"
              role="img" aria-label={`${p.date}，剩余 ${p.remaining}`} tabIndex={0}
              onPointerEnter={(event) => { trigger.onPointerEnter?.(event); setHover(i); }}
              onFocus={(event) => { trigger.onFocus?.(event); setHover(i); }}
              onBlur={(event) => { trigger.onBlur?.(event); setHover(null); }} />}
          </Tooltip>
        ))}
        {hover !== null && pts[hover] && (
          <g aria-hidden="true" pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - PAD} stroke="var(--primary)" strokeOpacity={0.3} strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(pts[hover]!.remaining)} r={3.5} fill="var(--primary)" />
          </g>
        )}
        <text x={PAD} y={PAD - 10} fontSize={11} fill="var(--text-muted)">点数上限 {max}</text>
      </svg>
      <div className="muted" style={{ fontSize: "var(--text-xs)", display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span><span style={{ color: "var(--primary)" }}>━</span> {tr("in.actualRemaining")}</span>
        <span><span style={{ color: "var(--text-faint)" }}>┄</span> {tr("in.idealLine")}</span>
        <span>{data.points.some((p) => p.source === "live") ? <InfoTip text={tr("in.liveNote")} label="数据来源说明" /> : tr("in.allSnapshot")}</span>
      </div>
    </div>
  );
}

/** 累积流：按状态类别的堆叠柱 */
function CumulativeFlowChart({ data }: { data: CumulativeFlow }) {
  const series = data.series;
  const maxTotal = Math.max(1, ...series.map((s) => s.total));
  const bw = (W - PAD * 2) / Math.max(1, series.length);
  const COLORS: Record<string, string> = {
    NOT_STARTED: "var(--neutral)", IN_PROGRESS: "var(--primary)", TERMINAL: "var(--success)",
  };
  const LABEL: Record<string, string> = { NOT_STARTED: tr("in.stNotStarted"), IN_PROGRESS: tr("in.stInProgress"), TERMINAL: tr("in.stDone") };


  if (!series.length || series.every((point) => point.total === 0)) return <div className="insight-chart-empty">{tr("in.widgetFlowEmpty")}</div>;

  return (
    <div className="chart-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" width="100%" height={H}
        aria-label={`累积流图：${data.iteration.name}，${series.length} 天，末日共 ${series[series.length - 1]?.total ?? 0} 个工作项`}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border-strong)" />
        {series.map((s, i) => {
          let acc = 0;
          return data.categories.map((c) => {
            const v = Number(s[c] ?? 0);
            if (!v) return null;
            const h = (v * (H - PAD * 2)) / maxTotal;
            const yTop = H - PAD - h - acc;
            acc += h;
            return (
              <Tooltip key={`${s.date}-${c}`} followPointer className="chart-hover-tip" content={<>
                <strong>{s.date}</strong><span>{LABEL[c] ?? c} {v}</span><span>{tr("in.colTotal")} {s.total}</span>
              </>}>
                {(trigger) => <rect {...trigger} x={PAD + i * bw + 1} y={yTop} width={Math.max(1, bw - 2)} height={h}
                  fill={COLORS[c] ?? "var(--text-faint)"} pointerEvents="all" tabIndex={0} role="img"
                  aria-label={`${s.date}，${LABEL[c] ?? c} ${v}`} />}
              </Tooltip>
            );
          });
        })}
      </svg>
      <div className="muted" style={{ fontSize: "var(--text-xs)", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {data.categories.map((c) => (
          <span key={c}><span style={{ color: COLORS[c] ?? "var(--text-faint)" }}>■</span> {LABEL[c] ?? c}</span>
        ))}
      </div>
    </div>
  );
}

/** 表格兜底：图表读不出来时，数据仍可读 */
function DataTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="insight-data-table">
      <summary style={{ cursor: "pointer", fontSize: "var(--text-xs)" }} className="muted">{tr("in.viewTable")}</summary>
      <TableScroll label={tr("in.viewTable")} className="data-scroll--embedded">
      <table className="insight-values-table">
        <thead><tr>{headers.map((h, i) => <th key={h} className={rows.some(r => typeof r[i] === "number") ? "table-number" : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => <td key={j} className={typeof c === "number" ? "table-number" : undefined}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
    </details>
  );
}

export function InsightPage() {
  useLocale();   // 订阅语言，切换即时生效
  const { projectId } = useParams({ from: "/_app/projects/$projectId/insights" });
  const [section, setSection] = useState("iteration");
  const [iterationId, setIterationId] = useState<string | null>(null);

  const iters = useQuery({
    queryKey: queryKeys.iterations(projectId),
    queryFn: () => planning.list("iteration", projectId),
  });
  const current = iters.data?.some((iteration) => iteration.id === iterationId) ? iterationId : iters.data?.[0]?.id ?? null;

  const bd = useQuery({ queryKey: queryKeys.burndown(current), queryFn: () => insight.burndown(current!), enabled: !!current });
  const cf = useQuery({ queryKey: queryKeys.cumulativeFlow(current), queryFn: () => insight.cumulativeFlow(current!), enabled: !!current });
  const bdData = bd.data;
  const cfData = cf.data;

  return (
    <div className={`page project-refinement insight-page${section === "activity" ? " data-page" : ""}`}>
      <PageHead title={tr("insight.title")} hint={tr("in.lede")} />
      <PageTabs id="insight" label={tr("insight.title")} value={section} onChange={setSection} tabs={[
        { value: "iteration", label: tr("sections.iteration") },
        { value: "dashboards", label: tr("sections.dashboard") },
        { value: "activity", label: tr("in.devActivity") },
      ]} />
      <TabPanel tabsId="insight" value="iteration" activeValue={section}>

      {iters.isLoading && <LoadingBlock />}
      {iters.isError && <StateBlock kind="error" title={tr("common.loadFailedShort")} description={iters.error instanceof ApiError ? iters.error.message : undefined}
        action={() => void iters.refetch()} actionLabel={tr("common.reload")} />}
      {iters.isSuccess && (iters.data ?? []).length === 0 && (
        <section className="insight-iterations-empty">
          <div>
            <h2>{tr("in.emptyTitle")}</h2>
            <p>{tr("in.noIterations")}</p>

          </div>
          <LinkButton to="/projects/$projectId/milestones" params={{ projectId }}>{tr("in.createIteration")}</LinkButton>
        </section>
      )}

      {current && (
        <section className="insight-iteration-section">
          <div className="insight-section-head">
            <h2>{tr("in.iterationProgress")}</h2>
            <Select label={tr("in.iterationContext")} ariaLabel={tr("in.iterationContext")} value={current} onChange={setIterationId}
              options={(iters.data ?? []).map((iteration) => ({ value: iteration.id, label: iteration.name }))} />
          </div>
          <div className="insight-chart-grid">
          <section className="insight-chart-card">
            <strong style={{ fontSize: "var(--text-sm)" }}>{tr("in.burndown")}{bdData?.metric && <InfoTip text={bdData.metric} label="燃尽图口径" />}</strong>
            {bdData ? (
              <>
                <BurndownChart data={bdData} />
                <DataTable
                  headers={[tr("in.colDate"), tr("in.colScope"), tr("in.colDone"), tr("in.colRemaining"), tr("in.colIdeal"), tr("in.colSource")]}
                  rows={bdData.points.map((p) => [p.date, p.scope, p.done, p.remaining, p.ideal, p.source === "live" ? tr("in.srcLive") : tr("in.srcSnapshot")])}
                />
              </>
            ) : bd.isError ? <StateBlock kind="error" title={tr("common.loadFailedShort")} description={bd.error instanceof ApiError ? bd.error.message : undefined}
              action={() => void bd.refetch()} actionLabel={tr("common.reload")} /> : <LoadingBlock compact />}
          </section>

          <section className="insight-chart-card">
            <strong style={{ fontSize: "var(--text-sm)" }}>{tr("in.cumulativeFlow")}{cfData?.metric && <InfoTip text={cfData.metric} label="累积流口径" />}</strong>
            {cfData ? (
              <>
                <CumulativeFlowChart data={cfData} />
                <DataTable
                  headers={[tr("in.colDate2"), ...cfData.categories.map((category) => ({ NOT_STARTED: tr("in.stNotStarted"), IN_PROGRESS: tr("in.stInProgress"), TERMINAL: tr("in.stDone") })[category] ?? category), tr("in.colTotal")]}
                  rows={cfData.series.map((s) => [String(s.date), ...cfData.categories.map((c) => Number(s[c] ?? 0)), s.total])}
                />
              </>
            ) : cf.isError ? <StateBlock kind="error" title={tr("common.loadFailedShort")} description={cf.error instanceof ApiError ? cf.error.message : undefined}
              action={() => void cf.refetch()} actionLabel={tr("common.reload")} /> : <LoadingBlock compact />}
          </section>
          </div>
        </section>
      )}
      </TabPanel>
      <TabPanel tabsId="insight" value="dashboards" activeValue={section}>
        <DashboardSection projectId={projectId} iterations={iters.data ?? []} currentIterationId={current} />
      </TabPanel>
      <TabPanel tabsId="insight" value="activity" activeValue={section}><DevActivity projectId={projectId} /></TabPanel>
    </div>
  );
}


/**
 * 研发活跃度（按成员聚合的提交/PR/评审）。
 * 读取 dev_activity_daily 日聚合；集成同步状态及数据来源由接口 note 提供。
 */
function DevActivity({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: ["dev-activity", projectId],
    queryFn: () => apiGet<{ members: { memberId: string; name: string; commits: number; prs: number; reviews: number; days: number }[]; note: string }>(
      `/api/v1/projects/${projectId}/dev-activity`),
    retry: false,
  });
  const rows = q.data?.members ?? [];
  return (
    <section className="insight-activity insight-section data-fill">
      <div className="panel-head">
        <h2 className="panel-title">{tr("in.devActivity")}<InfoTip text={`${tr("in.devActivitySub")} ${tr("in.devHint")}`} /></h2>
      </div>
      {q.isLoading && <LoadingBlock compact />}
      {q.isError && <StateBlock kind={q.error instanceof ApiError && q.error.status === 403 ? "restricted" : "error"}
        title={q.error instanceof ApiError && q.error.status === 403 ? tr("in.noPermission") : tr("common.loadFailedShort")}
        action={() => void q.refetch()} actionLabel={tr("common.reload")} />}
      {q.isSuccess && rows.length === 0 && (
        <p className="insight-empty-copy">{tr("in.devEmpty")}</p>
      )}
      {rows.length > 0 && (
        <TableScroll label={tr("in.devActivity")} resetKey={projectId}>
        <table className="table dev-activity-table">
          <thead><tr><th>{tr("in.member")}</th><th className="table-number">{tr("in.commits")}</th><th className="table-number">PR</th><th className="table-number">{tr("in.reviews")}</th><th className="table-number">{tr("in.activeDays")}</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.memberId}>
                <td className="table-primary">{m.name}</td>
                <td className="table-number">{m.commits}</td>
                <td className="table-number">{m.prs}</td>
                <td className="table-number">{m.reviews}</td>
                <td className="table-number muted">{m.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      )}
    </section>
  );
}


/**
 * 仪表盘（dashboards + dashboard-widgets）
 *
 * 后端支持 6 种 widget：BURNDOWN / CUMULATIVE_FLOW / ACTIVITY_HEATMAP / PIE / LIST / COUNT。
 * 六类挂件均由下方 WidgetBody 渲染；燃尽/累积流需要迭代上下文。
 */
const WIDGET_KINDS: { type: string; label: string }[] = [
  { type: "BURNDOWN", label: "in.widgetBurndown" },
  { type: "CUMULATIVE_FLOW", label: "in.widgetFlow" },
  { type: "ACTIVITY_HEATMAP", label: "in.widgetHeatmap" },
  { type: "PIE", label: "in.widgetPie" },
  { type: "LIST", label: "in.widgetList" },
  { type: "COUNT", label: "in.widgetCount" },
];

function DashboardSection({ projectId, iterations, currentIterationId }: {
  projectId: string;
  iterations: { id: string; name: string }[];
  currentIterationId: string | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [widgetIteration, setWidgetIteration] = useState("");

  const list = useQuery({
    queryKey: ["dashboards", projectId],
    queryFn: () => apiGet<{ dashboards: { id: string; name: string; isDefault: boolean; projectId: string | null }[] }>(`/api/v1/dashboards?projectId=${projectId}`),
    retry: false,
  });
  const dashes = list.data?.dashboards ?? [];
  // 默认展示第一个仪表盘；用户点选后以点选为准（不在渲染期 setState）
  const activeId = pickedId ?? dashes[0]?.id ?? null;

  const detail = useQuery({
    queryKey: ["dashboard", activeId],
    queryFn: () => apiGet<{ id: string; name: string; widgets: { id: string; type: string; sortOrder: number }[] }>(`/api/v1/dashboards/${activeId}`),
    enabled: !!activeId,
  });

  const createDash = useMutation({
    mutationFn: () => apiPost<{ id: string }>("/api/v1/dashboards", { name, projectId }),
    onSuccess: async (d) => { setName(""); setCreating(false); setConfiguring(true); setPickedId(d.id); await qc.invalidateQueries({ queryKey: ["dashboards", projectId] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("in.createFailed2")),
  });
  const addWidget = useMutation({
    // 燃尽/累积流需要迭代上下文，其余类型忽略该字段
    mutationFn: (type: string) => apiPost(`/api/v1/dashboards/${activeId}/widgets`,
      { type, config: { iterationId: widgetIteration || currentIterationId || "" } }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["dashboard", activeId] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("in.addWidgetFailed2")),
  });
  const dropWidget = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/dashboard-widgets/${id}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["dashboard", activeId] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("board.actionFailed")),
  });

  const widgets = detail.data?.widgets ?? [];
  const kindLabel = (type: string) => { const kind = WIDGET_KINDS.find((k) => k.type === type); return kind ? tr(kind.label) : type; };

  return (
    <section className="insight-dashboard insight-section">
      <div className="insight-section-head">
        <h2>{tr("in.dashboard")}<InfoTip text={tr("in.dashboardSub")} /></h2>
        <div className="insight-section-actions">
          {dashes.length > 0 && <Select ariaLabel={tr("in.chooseDashboard")} value={activeId ?? ""} onChange={setPickedId}
            options={dashes.map((dash) => ({ value: dash.id, label: dash.name }))} />}
          <Button size="sm" aria-expanded={creating} onClick={() => setCreating((value) => !value)}><Icon name="plus" size={14} />{tr("in.newDashboard")}</Button>
          {activeId && <Button size="sm" aria-expanded={configuring} onClick={() => setConfiguring((value) => !value)}><Icon name="settings" size={14} />{tr(configuring ? "in.finishConfigure" : "in.configure")}</Button>}
        </div>
      </div>
      {creating && <form className="insight-dashboard-create" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !createDash.isPending) createDash.mutate(); }}>
        <TextInput label={tr("insight.dashNameLabel")} placeholder={tr("insight.dashNamePlaceholder")} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" disabled={!name.trim() || createDash.isPending}>{tr("common.create")}</Button>
        <Button variant="ghost" onClick={() => setCreating(false)}>{tr("common.cancel")}</Button>
      </form>}
      {list.isSuccess && dashes.length === 0 && <p className="insight-empty-copy">{tr("in.noDashboards")}</p>}
      {list.isLoading && <LoadingBlock compact />}
      {list.isError && <StateBlock kind="error" title={tr("common.loadFailedShort")} action={() => void list.refetch()} actionLabel={tr("common.reload")} />}

      {activeId && (
        <>
          {configuring && <div className="insight-widget-config">
            <div className="insight-section-head">
              <strong>{tr("in.addWidget")}</strong>
              {iterations.length > 0 && <Select label={tr("insight.widgetIteration")} ariaLabel={tr("insight.widgetIteration")} size="sm"
                value={widgetIteration || currentIterationId || ""} onChange={setWidgetIteration}
                options={iterations.map((iteration) => ({ value: iteration.id, label: iteration.name }))} />}
            </div>
            <div className="insight-widget-options">
              {WIDGET_KINDS.map((kind) => <Button size="sm" key={kind.type}
                disabled={addWidget.isPending || ((kind.type === "BURNDOWN" || kind.type === "CUMULATIVE_FLOW") && !iterations.some((iteration) => iteration.id === (widgetIteration || currentIterationId)))}
                onClick={() => addWidget.mutate(kind.type)}><Icon name="plus" size={14} />{tr(kind.label)}</Button>)}
            </div>
          </div>}

          {detail.isLoading && <LoadingBlock compact />}
          {detail.isError && <StateBlock kind="error" title={tr("common.loadFailedShort")} action={() => void detail.refetch()} actionLabel={tr("common.reload")} />}
          {detail.isSuccess && widgets.length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>{tr("in.dashEmpty")}</p>}
          <div className="insight-widget-grid">
            {widgets.map((w) => (
              <section key={w.id} className="widget-card" data-widget-type={w.type}>
                <div className="insight-widget-head">
                  <strong style={{ fontSize: "var(--text-sm)" }}>{kindLabel(w.type)}</strong>
                  {configuring && <Button size="sm" variant="ghost" disabled={dropWidget.isPending} title={tr("insight.removeWidget")} onClick={async () => { if (await confirmDialog(tr("insight.removeWidgetConfirm"), { danger: true })) dropWidget.mutate(w.id); }}>{tr("in.remove2")}</Button>}
                </div>
                <div className="widget-canvas">
                  <WidgetBody dashboardId={activeId} widgetId={w.id} type={w.type} />
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 四类挂件的真实渲染（第 20 轮）—— 数据来自
 * `GET /api/v1/dashboards/:id/widgets/:wid/data`（本轮新增的真实聚合端点）。
 * 口径由服务端在 `metric` 字段里说明；**这里不编数、不画假图**：
 * 没有数据时显示服务端给的口径说明，而不是画一个空的坐标系。
 */
function WidgetBody({ dashboardId, widgetId, type }: { dashboardId: string; widgetId: string; type: string }) {
  const q = useQuery({
    queryKey: queryKeys.widgetData(widgetId),
    queryFn: () => apiGet<{ type: string; metric: string; data: unknown }>(
      `/api/v1/dashboards/${dashboardId}/widgets/${widgetId}/data`),
    retry: false,
  });
  if (q.isLoading) return <LoadingBlock compact />;
  if (q.isError) return <StateBlock kind="error" title={tr("common.loadFailedShort")} description={q.error instanceof ApiError ? q.error.message : undefined}
    action={() => void q.refetch()} actionLabel={tr("common.reload")} />;

  // ⚠️ 后端两种返回形状：四类聚合是 { type, metric, data }；燃尽/累积流直接返回图表对象
  // （{ iteration, metric, points } / { metric, categories, series }）—— 这里都要兼容。
  const payload = q.data as (Record<string, unknown> & { metric?: string; data?: unknown }) | undefined;
  const metric = payload?.metric ?? "";
  const note = <span className="muted widget-note">{metric}</span>;
  const metricHelp = metric && <div className="insight-widget-caption">{tr("in.metricInfo")}<InfoTip text={metric} label={tr("in.metricInfo")} /></div>;
  const raw = payload && ("points" in payload || "series" in payload) ? payload : payload?.data;
  const d = raw as {
    total?: number;
    slices?: { label: string; value: number }[];
    rows?: { key: string; title: string; priority: string | null }[];
    cells?: { date: string; value: number }[];
    points?: unknown[];
    series?: unknown[];
  } | null | undefined;
  if (!d) return <p className="muted" style={{ fontSize: "var(--text-xs)" }}>{metric || tr("in.widgetNoData")}</p>;

  // 燃尽 / 累积流：后端按 widget.config.iterationId 返回与页面同口径的数据，这里复用同一套图表
  if (type === "BURNDOWN" && Array.isArray(d.points)) {
    return <><BurndownChart data={d as unknown as Burndown} />{metricHelp}</>;
  }
  if (type === "CUMULATIVE_FLOW" && Array.isArray(d.series)) {
    return <><CumulativeFlowChart data={d as unknown as CumulativeFlow} />{metricHelp}</>;
  }

  if (type === "COUNT") {
    return (
      <div className="insight-count">
        <strong>{d.total ?? 0}</strong>
        {note}
      </div>
    );
  }
  if (type === "PIE") {
    const slices = d.slices ?? [];
    const sum = slices.reduce((n, x) => n + x.value, 0) || 1;
    return (
      <div className="insight-distribution">
        {slices.map((x) => (
          <div key={x.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-xs)" }}>
            <span style={{ width: 64 }} className="muted">{["URGENT", "HIGH", "MEDIUM", "LOW", "LOWEST"].includes(x.label) ? tr(`board.priority.${x.label}`) : x.label === "—" ? tr("in.unspecified") : x.label}</span>
            <span style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--bg-subtle)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.round((x.value / sum) * 100)}%`, background: "var(--primary)" }} />
            </span>
            <span style={{ width: 32, textAlign: "right" }}>{x.value}</span>
          </div>
        ))}
        {note}
      </div>
    );
  }
  if (type === "LIST") {
    return (
      <div className="insight-item-list">
        {(d.rows ?? []).map((r) => (
          <div key={r.key} className="row-title" style={{ fontSize: "var(--text-sm)" }}>
            <span className="row-name">{r.title}</span>
            <span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{r.key}</span>
          </div>
        ))}
        {note}
      </div>
    );
  }
  // ACTIVITY_HEATMAP：按日期的小方块，颜色深浅 = 当日创建数（同一份真实聚合）
  const cells = d.cells ?? [];
  const max = Math.max(1, ...cells.map((c) => c.value));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {cells.map((c) => (
          <span key={c.date} role="img" title={`${c.date} · ${c.value}`} aria-label={`${c.date} · ${c.value}`}
            style={{ width: 12, height: 12, borderRadius: 3, background: "var(--primary)", opacity: 0.25 + 0.75 * (c.value / max) }} />
        ))}
      </div>
      {note}
    </div>
  );
}
