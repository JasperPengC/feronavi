/** 我的工作台：四个分组 + 个人待办 */
import { queryKeys } from "../lib/query-keys.ts";
import { t as tr, useLocale } from "../i18n/index.ts";   // ⚠️ 本文件里 t 是待办对象，i18n 的 t 必须别名
import { PageHead } from "../components/Page.tsx";
import { Tooltip } from "../components/ui/Tooltip.tsx";
import { InfoTip } from "../components/ui/InfoTip.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { Button } from "../components/ui/Button.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { ArrowLink } from "../components/ui/ArrowLink.tsx";
import { useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workbench, todos, type Todo } from "../lib/planning-api.ts";
import { ApiError } from "../lib/api.ts";
import { DatePicker } from "../components/DatePicker.tsx";
import { Checkbox } from "../components/Checkbox.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { apiGet } from "../lib/api.ts";
import { relativeTime } from "../lib/time.ts";
import { Panel } from "../components/ui/Panel.tsx";
import { Icon } from "../components/Icon.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";

const PRIORITY_LABEL: Record<string, string> = {
  // 复用优先级词典（已核对 zh 值与原字面完全一致，不是"看起来差不多"就复用）
  LOWEST: "prio.LOWEST", LOW: "prio.LOW", MEDIUM: "prio.MEDIUM", HIGH: "prio.HIGH", URGENT: "prio.URGENT",
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ItemRow({ it, onOpen }: { it: { id: string; key: string; title: string; priority: string | null; dueDate: string | null; projectKey: string }; onOpen: (id: string) => void }) {
  const today = localDateKey();
  const overdue = it.dueDate !== null && it.dueDate < today;
  return (
    <div className="workbench-item-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
      <span className="mono muted" style={{ fontSize: "var(--text-xs)", flex: "none" }}>{it.key}</span>
      <button type="button" className="row-link" onClick={() => onOpen(it.id)}
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: 0, padding: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}>{it.title}</button>
      {it.priority && <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{tr(PRIORITY_LABEL[it.priority] ?? it.priority)}</span>}
      {/* 逾期：图标 + 文字，不只靠颜色 */}
      {overdue ? (
        <span style={{ color: "var(--danger)", fontSize: "var(--text-xs)", flex: "none", display: "inline-flex", alignItems: "center", gap: 4 }} title={tr("workbench.overdueTag")}><Icon name="info" size={12} />{tr("workbench.overdue")}</span>
      ) : it.dueDate ? (
        <span className="muted" style={{ fontSize: "var(--text-xs)", flex: "none" }}>{it.dueDate}</span>
      ) : null}
    </div>
  );
}

export function WorkbenchPage() {
  useLocale();   // 订阅语言，切换即时生效
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({ queryKey: queryKeys.workbench(), queryFn: workbench });
  const todoQ = useQuery({ queryKey: ["todos"], queryFn: () => todos.list() });
  /** 项目列表：工作台主列要放**真实密集表格**（原型"满"的原因就是它有一张 6 行表格） */
  const projectsQ = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => apiGet<{ items: { id: string; key: string; name: string; description: string | null;
      status: { name: string } | null; workItemCount: number; updatedAt: string | null }[] }>("/api/v1/projects"),
  });

  const firstProjectId = projectsQ.data?.items?.[0]?.id;
  /** 项目级活动趋势（第 55 轮）：工作台主面板 trend-chart 的真实数据源（按天，含 0 值日） */
  const seriesQ = useQuery({
    queryKey: queryKeys.activitySeries(firstProjectId),
    queryFn: () => apiGet<{ metric: string; points: { d: string; n: number }[]; series?: { activity: { d: string; n: number }[]; created: { d: string; n: number }[] } }>(
      `/api/v1/projects/${firstProjectId}/activity-series?days=28`),
    enabled: !!firstProjectId,
  });
  const addTodo = useMutation({
    mutationFn: () => todos.create({ title: newTitle, dueDate: newDue || null }),
    onSuccess: async () => {
      setNewTitle(""); setNewDue("");
      await qc.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("workbench.addFailed")),
  });

  const toggleTodo = useMutation({
    mutationFn: (t: Todo) => todos.update(t.id, { done: !t.done }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["todos"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("board.actionFailed")),
  });

  const removeTodo = useMutation({
    mutationFn: (id: string) => todos.remove(id),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["todos"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("board.actionFailed")),
  });

  const groups = data?.groups ?? [];
  const workItemCounts = {
    assigned: groups.find((group) => group.key === "assignedToMe")?.count ?? 0,
    overdue: groups.find((group) => group.key === "overdue")?.count ?? 0,
    dueSoon: groups.find((group) => group.key === "dueSoon")?.count ?? 0,
  };

  const attentionItems = (() => {
    const seen = new Set<string>();
    const source = [...(groups.find((g) => g.key === "overdue")?.items ?? []), ...(groups.find((g) => g.key === "dueSoon")?.items ?? []), ...(groups.find((g) => g.key === "assignedToMe")?.items ?? [])];
    return source.filter((item) => {
      const id = String(item.id ?? item.key ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 4) as { id: string; key: string; title: string; priority: string | null; dueDate: string | null; projectKey: string }[];
  })();

  // 指标只用真实数据：未完成待办 / 逾期 / 分组条数
  const openTodos = (todoQ.data ?? []).filter((x) => !x.done);

  return (
    <div className="page workbench-page">
      <PageHead title={tr("workbench.title")} sub={new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", weekday: "long" })} />
      {isError && <StateBlock kind="error" title={tr("common.loadFailedShort")} description={loadError instanceof ApiError ? loadError.message : undefined}
        action={() => void refetch()} actionLabel={tr("common.reload")} />}

      <div className="metric-grid workbench-metrics">
        {/* 四张指标卡直接呈现真实的工作项与待办数量。 */}
        {(() => {
          const allTodos = (todoQ.data ?? []).length;
          const doneTodos = (todoQ.data ?? []).filter((todo) => todo.done).length;
          const cards: { label: string; value: number; sub: string; tone: "neutral" | "primary" | "success" | "warning" }[] = [
            { label: tr("workbench.attentionAssigned"), value: workItemCounts.assigned, sub: tr("workbench.attentionAssignedHint"), tone: "primary" },
            { label: tr("workbench.overdueItems"), value: workItemCounts.overdue, sub: tr("workbench.overdueContext"), tone: "warning" },
            { label: tr("workbench.dueSoon"), value: workItemCounts.dueSoon, sub: tr("workbench.dueSoonHint"), tone: "neutral" },
            { label: tr("workbench.mAllTodos"), value: allTodos, sub: `${tr("workbench.completedTodos")} ${doneTodos}`, tone: "success" },
          ];
          return cards.map((c, index) => <MetricCard key={c.label} className="panel" label={c.label} value={(index === 3 ? !todoQ.isSuccess : !data || isError) ? "—" : c.value} detail={c.sub} tone={c.tone} />);
        })()}
      </div>

      {isLoading && <LoadingBlock />}

      {/* 先处理今日事项，再查看活动趋势与项目概况。 */}
      <div className="dashboard-grid workbench-top-grid">
        <article className="card panel workbench-focus-panel" data-custom-scroll>
          <div className="panel-title">
            <div>
              <strong style={{ fontSize: "var(--text-sm)" }}>{tr("workbench.attentionTitle")}<InfoTip text={tr("workbench.attentionSubtitle")} /></strong>
            </div>
          </div>
          {isLoading ? <LoadingBlock compact /> : isError ? null : attentionItems.length === 0 ? (
            <div className="workbench-focus-empty">
              <span className="workbench-focus-empty-mark" aria-hidden="true"><Icon name="calendar" size={18} /></span>
              <div>
                <strong>{tr("workbench.attentionEmptyTitle")}</strong>
                <p className="muted">{tr("workbench.attentionEmptyHint")}</p>
              </div>
            </div>
          ) : (
            <ul className="workbench-attention-list">
              {attentionItems.map((item) => {
                return (
                  <li key={item.id}>
                    <button type="button" className="workbench-attention-open" aria-label={item.title} onClick={() => setOpenItemId(item.id)}>
                    <span className={`workbench-attention-mark ${item.dueDate && item.dueDate < localDateKey() ? "is-overdue" : ""}`} aria-hidden="true"><Icon name="flag" size={14} /></span>
                    <span className="workbench-attention-copy">
                      <span className="workbench-attention-link">
                        {item.title}
                      </span>
                      <small>{item.projectKey} · {item.dueDate ? item.dueDate.slice(5) : tr("workbench.noDueDate")}</small>
                    </span>
                    <span className="workbench-attention-priority" data-priority={item.priority}>{item.priority ? tr(PRIORITY_LABEL[item.priority] ?? item.priority) : "—"}</span>
                    <span className="workbench-attention-arrow" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="card panel workbench-chart-panel">
          <div className="panel-title">
            <div>
              <strong style={{ fontSize: "var(--text-sm)" }}>{tr("workbench.trend")}{seriesQ.data?.metric && <InfoTip text={seriesQ.data.metric} />}</strong>
            </div>
          </div>
          {seriesQ.isLoading && <LoadingBlock compact />}
          {seriesQ.isError ? <StateBlock kind="error" title={tr("common.loadFailedShort")} action={() => void seriesQ.refetch()} actionLabel={tr("common.reload")} />
            : !seriesQ.isLoading && <TrendChart points={seriesQ.data?.points ?? []} series={seriesQ.data?.series} />}
        </article>
      </div>

      <div className="dashboard-grid workbench-lower-grid">
          <article className="card panel workbench-projects-panel" style={{ overflow: "hidden" }}>
            <div className="panel-title">
              <div>
                <strong style={{ fontSize: "var(--text-sm)" }}>{tr("nav.projects")}</strong>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: "var(--text-xs)" }}>{tr("pl.colUpdated")}</p>
              </div>
              <ArrowLink to="/projects">{tr("nav.projects")}</ArrowLink>
            </div>
            <div className="workbench-project-list">
              {projectsQ.isLoading && <LoadingBlock compact />}
              {projectsQ.isError && <StateBlock kind="error" title={tr("common.loadFailedShort")} action={() => void projectsQ.refetch()} actionLabel={tr("common.reload")} />}
              {projectsQ.isSuccess && projectsQ.data.items.length === 0 && <p className="muted">{tr("projects.empty")}</p>}
              {(projectsQ.data?.items ?? []).slice(0, 6).map((p) => (
                <div key={p.id} className="workbench-project-row row-hover">
                  <div className="row-title">
                    <span className="row-avatar" aria-hidden="true">{(p.name || p.key).slice(0, 1)}</span>
                    <span className="workbench-project-name">
                      <Link className="row-link row-name" to="/projects/$projectId/board" params={{ projectId: p.id }}>{p.name}</Link>
                      <span className="row-sub"><span className="mono">{p.key}</span></span>
                    </span>
                  </div>
                  <span>{p.status ? <span className="status-pill">{p.status.name}</span> : <span className="muted">—</span>}</span>
                  <span className="muted workbench-project-count">{p.workItemCount}</span>
                  <span className="muted workbench-project-time">{relativeTime(p.updatedAt)}</span>
                </div>
              ))}
            </div>
          </article>

        <div className="card panel" style={{ padding: 15 }}>
          <div className="panel-title">
            <div>
              <strong style={{ fontSize: "var(--text-sm)" }}>{tr("workbench.todos")}</strong>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: "var(--text-xs)" }}>{tr("workbench.mOpenTodos")} {openTodos.length}</p>
            </div>
          </div>
          <form className="workbench-todo-form" style={{ display: "flex", gap: 8, marginTop: 12 }}
            onSubmit={(e) => { e.preventDefault(); if (newTitle.trim() && !addTodo.isPending) addTodo.mutate(); }}>
            <TextInput aria-label={tr("workbench.todoPlaceholder")} placeholder={tr("workbench.todoPlaceholder")} value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)} />
            <DatePicker value={newDue} onChange={setNewDue} ariaLabel={tr("workbench.duePlaceholder")}
              placeholder={tr("workbench.duePlaceholder")} />
            <Tooltip content={tr("workbench.add")}>{(trigger) => (
              <Button {...trigger} variant="primary" iconOnly className="workbench-todo-add" type="submit"
                aria-label={addTodo.isPending ? tr("common.loading") : tr("workbench.add")}
                loading={addTodo.isPending} disabled={!newTitle.trim()}>
                {!addTodo.isPending && <Icon name="plus" size={16} />}
              </Button>
            )}</Tooltip>
          </form>
          <div style={{ marginTop: 12 }}>
            {todoQ.isLoading && <LoadingBlock compact />}
            {todoQ.isError && <StateBlock kind="error" title={tr("common.loadFailedShort")} action={() => void todoQ.refetch()} actionLabel={tr("common.reload")} />}
            {todoQ.isSuccess && (todoQ.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{tr("workbench.empty")}</p>}
            {(todoQ.data ?? []).map((todo) => (
              <div key={todo.id} className="workbench-todo-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <Checkbox checked={todo.done} disabled={toggleTodo.isPending} onChange={() => toggleTodo.mutate(todo)} ariaLabel={todo.title} size="sm" />
                <span className="workbench-todo-title" style={{ flex: 1, fontSize: "var(--text-sm)", textDecoration: todo.done ? "line-through" : "none", color: todo.done ? "var(--text-faint)" : "var(--text)" }}>{todo.title}</span>
                {todo.dueDate && <span className="muted workbench-todo-due" style={{ fontSize: "var(--text-xs)" }}>{todo.dueDate}</span>}
                <Tooltip content={tr("workbench.deleteTodo")}>{(trigger) => (
                  <Button {...trigger} variant="ghost" iconOnly className="workbench-todo-delete"
                    aria-label={tr("workbench.deleteTodo")} disabled={removeTodo.isPending}
                    onClick={async (event) => {
                      trigger.onClick?.(event);
                      if (await confirmDialog(tr("common.confirmDelete"), { danger: true })) removeTodo.mutate(todo.id);
                    }}>
                    <Icon name="trash" size={16} />
                  </Button>
                )}</Tooltip>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data?.crossDomain && (
        <Panel className="workbench-cross">
          <div className="panel-title">
            <div>
              <strong style={{ fontSize: "var(--text-sm)" }}>{tr("workbench.crossTitle")}<InfoTip text={tr("workbench.crossSubtitle")} /></strong>
            </div>
            <ArrowLink to="/projects">{tr("nav.projectsShort")}</ArrowLink>
          </div>
          <div className="workbench-cross-grid">
            <div className="workbench-cross-stat">
              <span>{tr("workbench.crossMyDefects")}</span>
              <strong>{data.crossDomain.myOpenDefects}</strong>
            </div>
            <div className="workbench-cross-stat">
              <span>{tr("workbench.crossOpenDefects")}</span>
              <strong>{data.crossDomain.defects.open}</strong>
              <small>{tr("workbench.crossDoneRate")} {data.crossDomain.defects.donePercent}%</small>
            </div>
            <div className="workbench-cross-stat">
              <span>{tr("workbench.crossP0")}</span>
              <strong className={data.crossDomain.defects.p0 > 0 ? "is-danger" : ""}>{data.crossDomain.defects.p0}</strong>
              <small>{tr("workbench.crossOverdueDefects")} {data.crossDomain.defects.overdue}</small>
            </div>
            <div className="workbench-cross-stat">
              <span>{tr("workbench.crossMilestones")}</span>
              <strong>{data.crossDomain.milestones.dueSoon + data.crossDomain.milestones.overdue}</strong>
              <small>{tr("workbench.crossMilestoneOverdue")} {data.crossDomain.milestones.overdue}</small>
            </div>
          </div>
          <ul className="workbench-cross-list">
            {data.crossDomain.milestones.items.length === 0 && (
              <li className="muted">{tr("workbench.crossNoMilestones")}</li>
            )}
            {data.crossDomain.milestones.items.map((m) => (
              <li key={m.id}>
                <Icon name="flag" size={13} />
                <Link to="/projects/$projectId/milestones/$milestoneId" params={{ projectId: m.projectId, milestoneId: m.id }}>{m.name}</Link>
                <span className="muted">{m.projectKey}</span>
                <span className={m.dueDate < localDateKey() ? "workbench-cross-overdue" : "muted"}>{m.dueDate}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="workbench-groups-grid">
          {groups.map((g) => (
            <div key={g.key} className="card panel" style={{ padding: 15 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }} aria-label={`${g.name}，共 ${g.count} 条`}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{g.name}</span>
                <span className="muted" style={{ fontSize: "var(--text-xs)" }}>（{g.count}）</span>
              </div>
              {g.count === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>{tr("workbench.none")}</p>}
              {(expandedGroups.includes(g.key) ? g.items : g.items.slice(0, 8)).map((it) => <ItemRow key={it.id} it={it} onOpen={setOpenItemId} />)}
              {g.items.length > 8 && <Button size="sm" variant="ghost" onClick={() => setExpandedGroups((keys) => keys.includes(g.key) ? keys.filter((key) => key !== g.key) : [...keys, g.key])}>
                {expandedGroups.includes(g.key) ? tr("workbench.showLess") : tr("workbench.showMore", { n: g.items.length - 8 })}
              </Button>}
            </div>
          ))}
      </div>
      <WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} />
    </div>
  );
}

/** 按天展示活动与新建数量，低频数据按周汇总。 */
function TrendChart({ points, series }: {
  points: { d: string; n: number }[];
  series?: { activity: { d: string; n: number }[]; created: { d: string; n: number }[] };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 210, PADL = 32, PADR = 8, PADT = 10, PADB = 22;
  const a = series?.activity ?? points;
  const c = series?.created ?? points.map((x) => ({ d: x.d, n: 0 }));
  const activeDays = points.filter((_, i) => (a[i]?.n ?? 0) + (c[i]?.n ?? 0) > 0).length;
  // 给低频但真实的活动保留可读的纵向尺度，避免单条记录被拉成占满整张图的尖峰。
  const observedMax = Math.max(0, ...a.map((x) => x.n), ...c.map((x) => x.n));
  const max = Math.max(5, Math.ceil(observedMax / 5) * 5);
  const step = points.length > 1 ? (W - PADL - PADR) / (points.length - 1) : 0;
  const xy = (arr: { n: number }[]) =>
    arr.map((x, i) => [PADL + i * step, H - PADB - (x.n / max) * (H - PADT - PADB)] as const);
  const path = (arr: { n: number }[]) => xy(arr).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const pa = path(a), pc = path(c);
  if (points.length === 0) return null;
  if (activeDays <= 3) return <SparseTrendChart points={points} activity={a} created={c} />;
  // 周刻度（每 7 天一个，与原型 chart-axis 的周刻度一致）
  const ticks = points.map((x, i) => ({ x: PADL + i * step, d: x.d })).filter((_, i) => i % 7 === 0 || i === points.length - 1);
  const hoverX = hover !== null ? PADL + hover * step : 0;
  return (
    <div className="workbench-trend chart-plot" onPointerLeave={() => setHover(null)}>
      <div className="chart-legend" style={{ display: "flex", gap: 14, marginBottom: 6, fontSize: "var(--text-xs)" }}>
        <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i style={{ width: 10, height: 2, background: "var(--blue)", display: "inline-block" }} />{tr("workbench.seriesActivity")}
        </span>
        <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i style={{ width: 10, height: 2, background: "var(--text-faint)", display: "inline-block" }} />{tr("workbench.seriesCreated")}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label={`${points.length} 天：活动 ${a.reduce((n, x) => n + x.n, 0)}、新建 ${c.reduce((n, x) => n + x.n, 0)}`}
        style={{ display: "block" }}>
        {/* 网格（照原型：极淡） */}
        {[0, 1, 2, 3, 4, 5].map((tick) => (
          <g key={tick}>
            <line x1={PADL} x2={W - PADR} y1={PADT + (tick / 5) * (H - PADT - PADB)} y2={PADT + (tick / 5) * (H - PADT - PADB)}
              stroke="var(--text)" strokeOpacity={0.12} strokeWidth={1} />
            <text x={PADL - 8} y={PADT + (tick / 5) * (H - PADT - PADB) + 3} fill="var(--text-faint)" fontSize={9} textAnchor="end">
              {Math.round(max * (1 - tick / 5))}
            </text>
          </g>
        ))}
        <path d={pc} fill="none" stroke="var(--text-faint)" strokeWidth={1.3} strokeLinejoin="round" />
        <path d={pa} fill="none" stroke="var(--blue)" strokeWidth={2.1} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <Tooltip key={p.d} followPointer className="chart-hover-tip" content={<>
            <strong>{p.d}</strong><span>{tr("workbench.seriesActivity")} {a[i]?.n ?? 0}</span><span>{tr("workbench.seriesCreated")} {c[i]?.n ?? 0}</span>
          </>}>
            {(trigger) => <rect {...trigger} x={PADL + i * step - step / 2} y={PADT} width={Math.max(6, step)} height={H - PADT - PADB}
              fill="transparent" pointerEvents="all" tabIndex={0} role="img" aria-label={`${p.d}，活动 ${a[i]?.n ?? 0}，新建 ${c[i]?.n ?? 0}`}
              onPointerEnter={(event) => { trigger.onPointerEnter?.(event); setHover(i); }}
              onFocus={(event) => { trigger.onFocus?.(event); setHover(i); }}
              onBlur={(event) => { trigger.onBlur?.(event); setHover(null); }} />}
          </Tooltip>
        ))}
        {hover !== null && (
          <g aria-hidden="true" pointerEvents="none">
            <line x1={hoverX} x2={hoverX} y1={PADT} y2={H - PADB} stroke="var(--primary)" strokeOpacity={0.35} strokeDasharray="3 3" />
            <circle cx={hoverX} cy={H - PADB - ((a[hover]?.n ?? 0) / max) * (H - PADT - PADB)} r={3.5} fill="var(--blue)" />
            <circle cx={hoverX} cy={H - PADB - ((c[hover]?.n ?? 0) / max) * (H - PADT - PADB)} r={3} fill="var(--text-faint)" />
          </g>
        )}
        {ticks.map((t) => (
          <text key={t.d} x={t.x} y={H - 6} fill="var(--text-faint)" fontSize={9}
            textAnchor={t.x < PADL + 8 ? "start" : (t.x > W - 20 ? "end" : "middle")}>{t.d.slice(5)}</text>
        ))}
      </svg>
    </div>
  );
}

function SparseTrendChart({ points, activity, created }: {
  points: { d: string; n: number }[];
  activity: { d: string; n: number }[];
  created: { d: string; n: number }[];
}) {
  const weeks = Array.from({ length: Math.ceil(points.length / 7) }, (_, week) => {
    const start = week * 7;
    return {
      label: points[start]?.d.slice(5) ?? "",
      range: `${points[start]?.d} – ${points[Math.min(start + 6, points.length - 1)]?.d}`,
      activity: activity.slice(start, start + 7).reduce((sum, point) => sum + point.n, 0),
      created: created.slice(start, start + 7).reduce((sum, point) => sum + point.n, 0),
    };
  });
  const max = Math.max(2, Math.ceil(Math.max(0, ...weeks.flatMap((week) => [week.activity, week.created])) / 2) * 2);
  const totalActivity = activity.reduce((sum, point) => sum + point.n, 0);
  const totalCreated = created.reduce((sum, point) => sum + point.n, 0);
  return (
    <div className="workbench-sparse-trend" role="group" aria-label={`${points.length} 天：活动 ${totalActivity}、新建 ${totalCreated}`}>
      <div className="workbench-trend-legend">
        <span><i className="is-activity" />{tr("workbench.seriesActivity")}</span>
        <span><i className="is-created" />{tr("workbench.seriesCreated")}</span>
      </div>
      <div className="workbench-sparse-scale" aria-hidden="true"><span>{max}</span><span>{max / 2}</span><span>0</span></div>
      <div className="workbench-sparse-weeks" style={{ "--week-count": weeks.length } as CSSProperties}>
        {weeks.map((week) => (
          <Tooltip key={week.label} followPointer className="chart-hover-tip" content={<>
            <strong>{week.range}</strong><span>{tr("workbench.seriesActivity")} {week.activity}</span><span>{tr("workbench.seriesCreated")} {week.created}</span>
          </>}>
            {(trigger) => <div {...trigger} className="workbench-sparse-week chart-tip-host" tabIndex={0}
              aria-label={`${week.range}，活动 ${week.activity}，新建 ${week.created}`}>
              <div className="workbench-sparse-bars" aria-hidden="true">
                <span className="workbench-sparse-bar is-activity" style={{ height: `${week.activity / max * 100}%` }} />
                <span className="workbench-sparse-bar is-created" style={{ height: `${week.created / max * 100}%` }} />
              </div>
              <small>{week.label}</small>
            </div>}
          </Tooltip>
        ))}
      </div>
      <p>{tr("workbench.sparseSummary", { days: String(points.length), activity: String(totalActivity), created: String(totalCreated) })}</p>
    </div>
  );
}
