/**
 * 时间线页（规划）—— 第 31 轮**整块重写**，照原型的 `planning` 结构。
 *
 * 原型实测（Playwright 读渲染结果）：
 *   · `planning-layout` 是 **2 栏网格**（"712.9px 332.7px"）；
 *   · 左栏 `calendar-panel`（713 宽、高 425）**内含两件**：`week-strip`（7 个 day-cell，
 *     每个 90×67、pad "8px 7px"、radius 12）与 `timeline`（3 行，条 248×26、**radius 999px**、pad "0px 9px"）；
 *   · 右栏是「即将到来的节点」面板（333×425、pad 18px、radius 14px）。
 *
 * ⚠️ 为什么"整块重写"而不是逐行改：此前 6 轮里有 5 次用「正则切边界 / 按行移动标签」改结构，
 * 每次都把文件改坏（tsc 报错、十几个测试文件失败）—— **结构性改动要用整体替换，不是文本手术**。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { timeline } from "../lib/planning-api.ts";
import { apiGet, apiPatch, ApiError } from "../lib/api.ts";
import { WorkItemViewHeader } from "../components/project/WorkItemViewHeader.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { t, useLocale } from "../i18n/index.ts";
import { InfoTip } from "../components/ui/InfoTip.tsx";
import { DatePicker, toISODate } from "../components/DatePicker.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { WorkItemEditor } from "../components/work-item/WorkItemEditor.tsx";

export function TimelinePage() {
  useLocale();   // 订阅语言，切换即时生效
  const { projectId } = useParams({ from: "/_app/projects/$projectId/timeline" });
  // ⚠️ 日期默认值一律用本地时区（toISODate）；toISOString() 是 UTC，东八区 0-8 点会整体偏移一天
  const today = toISODate(new Date());
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return toISODate(d); });
  const [to, setTo] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 2); return toISODate(d); });
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const qc = useQueryClient();
  const dragRef = useRef<{ id: string; pointerX: number; start: string; due: string; trackWidth: number } | null>(null);

  const validRange = Boolean(from && to && from <= to);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.timeline(projectId, from, to),
    queryFn: () => timeline(projectId!, from, to),
    enabled: validRange,
  });

  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const span = Math.max(end - start, 1);
  const pct = (d: string) => {
    const ms = new Date(d).getTime();
    return Math.min(100, Math.max(0, ((ms - start) / span) * 100));
  };

  const rows = data?.rows ?? [];

  const msPerDay = 86_400_000;
  const spanDays = Math.max(1, Math.round((end - start) / msPerDay));
  const stepDays = spanDays <= 21 ? 2 : spanDays <= 90 ? 7 : 30;
  const axisTicks: { iso: string; label: string; left: number }[] = [];
  for (let offset = 0; offset <= spanDays; offset += stepDays) {
    const d = new Date(start + offset * msPerDay);
    axisTicks.push({
      iso: toISODate(d),
      label: stepDays >= 30
        ? d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })
        : `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`,
      left: (offset / spanDays) * 100,
    });
  }
  if (axisTicks.length === 0 || axisTicks[axisTicks.length - 1]!.left < 100) {
    // 终点标签右对齐，为相邻日期保留可读间距。
    if (axisTicks.length > 1 && axisTicks[axisTicks.length - 1]!.left > 90) axisTicks.pop();
    axisTicks.push({ iso: to, label: to.slice(5), left: 100 });
  }

  function shiftDate(date: string, days: number) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  async function dropBar(e: React.DragEvent<HTMLDivElement>) {
    const d = dragRef.current; dragRef.current = null;
    e.preventDefault();
    if (!d) return;
    const days = Math.round((e.clientX - d.pointerX) / Math.max(1, d.trackWidth / spanDays));
    if (!days) return;
    try {
      const detail = await apiGet<{ version: number; startDate: string | null; dueDate: string | null }>(`/api/v1/work-items/${d.id}`);
      await apiPatch(`/api/v1/work-items/${d.id}`, {
        version: detail.version,
        startDate: shiftDate(detail.startDate ?? d.start, days),
        dueDate: shiftDate(detail.dueDate ?? d.due, days),
      });
      setDragError(null);
      await qc.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
    } catch (err) {
      setDragError(err instanceof ApiError ? err.message : t("tl.rescheduleFailed"));
    }
  }

  return (
    <div className="page project-refinement timeline-page">
      <WorkItemViewHeader projectId={projectId!} active="timeline"
        onCreate={() => setCreateOpen(true)}
        onRefresh={() => void qc.invalidateQueries({ queryKey: queryKeys.timeline(projectId) })} />
      <div className="timeline-filterbar">
        <label className="muted">{t("tl.from")}
          <DatePicker value={from} onChange={setFrom} ariaLabel={t("tl.from")} placeholder={t("common.pickDate")} /></label>
        <label className="muted">{t("tl.to")}
          <DatePicker value={to} onChange={setTo} ariaLabel={t("tl.to")} placeholder={t("common.pickDate")} /></label>
        <span className="timeline-help"><InfoTip text={t("tl.help")} /></span>
      </div>

      {dragError && <div className="alert alert-error" role="alert" style={{ marginBottom: 10 }}>{dragError}</div>}

      {isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
      {!validRange && <StateBlock kind="error" title={t("tl.invalidRange")} />}
      {isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={error instanceof ApiError ? error.message : undefined}
        action={() => void refetch()} actionLabel={t("common.reload")} />}

      {validRange && !isLoading && !isError && rows.length === 0 && (
        <div className="work-items-surface empty"><StateBlock kind="empty" title={t("tl.empty")} /></div>
      )}

      {validRange && !!rows.length && (
        <div className="timeline-board" role="group" aria-label={t("nav.timeline")} tabIndex={0}>
          <div className="timeline-axis-row">
            <div className="timeline-axis-label">{t("nav.timeline")}</div>
            <div className="timeline-axis-track">
              {axisTicks.map((tick) => (
                <span key={tick.iso} className="timeline-axis-tick" style={{ left: `${tick.left}%` }}>{tick.label}</span>
              ))}
            </div>
          </div>
          {rows.map((r) => {
            const kind = r.kind === "milestone" ? t("tl.kindMilestone") : r.kind === "iteration" ? t("tl.kindIteration") : r.kind;
            return (
              <div className="timeline-row" key={`${r.kind}:${r.id}`}>
                <div className="timeline-row-label">
                  <span className="timeline-row-name">{r.name}</span>
                  <span className="timeline-row-kind">{kind}</span>
                </div>
                <div className="timeline-row-track"
                  style={{ minHeight: Math.max(52, 14 + r.bars.length * 30) }}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => void dropBar(e)}>
                  {axisTicks.map((tick) => (
                    <span key={tick.iso} className="timeline-grid-line" style={{ left: `${tick.left}%` }} aria-hidden="true" />
                  ))}
                  {today >= from && today <= to && (
                    <span className="timeline-today-line" title={t("tl.today")} style={{ left: `${pct(today)}%` }} aria-hidden="true" />
                  )}
                  {r.bars.length === 0 && <span className="timeline-row-empty">{t("tl.noItems")}</span>}
                  {r.bars.map((b, i) => {
                    const left = pct(b.startDate);
                    const right = pct(b.dueDate);
                    const width = Math.max(right - left, 0.7);
                    return (
                      <div key={b.id} className={`timeline-bar${width < 8 ? " is-short" : ""}`} title={`${b.key} ${b.title}（${b.startDate} → ${b.dueDate}）`}
                        draggable={!b.id.includes(":")}
                        onDragStart={(e) => {
                          if (b.id.includes(":")) { e.preventDefault(); return; }
                          const track = e.currentTarget.parentElement!.getBoundingClientRect();
                          dragRef.current = { id: b.id, pointerX: e.clientX, start: b.startDate, due: b.dueDate, trackWidth: track.width };
                        }}
                        onDragEnd={() => { dragRef.current = null; }}
                        onClick={() => { if (!b.id.includes(":")) setOpenId(b.id); }} role={b.id.includes(":") ? undefined : "button"} tabIndex={b.id.includes(":") ? undefined : 0}
                        onKeyDown={(e) => { if (!b.id.includes(":") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpenId(b.id); } }}
                        style={{ left: `${left}%`, width: `${width}%`, top: 10 + i * 30 }}>
                        <span className="timeline-bar-text">{b.key} · {b.title}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <WorkItemDrawer workItemId={openId} onClose={() => setOpenId(null)} />
      <WorkItemEditor open={createOpen} projectId={projectId!} initialDueDate={from}
        onClose={() => setCreateOpen(false)} onSaved={(item) => { setCreateOpen(false); setOpenId(item.id); }} />
    </div>
  );
}
