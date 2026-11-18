/** 日历页：月历，格子内显示工作项 */
import { queryKeys } from "../lib/query-keys.ts";
import { t, useLocale, currentLocale } from "../i18n/index.ts";
import { useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { calendar } from "../lib/planning-api.ts";
import { apiGet, ApiError } from "../lib/api.ts";
import { WorkItemViewHeader } from "../components/project/WorkItemViewHeader.tsx";
import { Icon } from "../components/Icon.tsx";
import { Button } from "../components/ui/Button.tsx";
import { toISODate } from "../components/DatePicker.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { Drawer } from "../components/ui/Drawer.tsx";
import { PagePagination } from "../components/ui/PagePagination.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { WorkItemEditor } from "../components/work-item/WorkItemEditor.tsx";

/**
 * ⚠️ 模块级数组里**不能直接调用 t()** —— 那会在模块导入时求值一次，
 * 语言被永久固定成"加载那一刻"的语言（切换语言不生效）。
 * 因此这里存**键**，渲染时再翻译。
 */
const WEEK_KEYS = ["cal.sun", "cal.mon", "cal.tue", "cal.wed", "cal.thu", "cal.fri", "cal.sat"];
const TYPE_LABEL_KEY: Record<string, string> = {
  REQUIREMENT: "type.REQUIREMENT", TASK: "type.TASK", DEFECT: "type.DEFECT", SUBTASK: "type.SUBTASK",
};

function dotClass(type: string): string {
  if (type === "DEFECT") return "dot-danger";
  if (type === "REQUIREMENT") return "dot-info";
  if (type === "SUBTASK") return "dot-neutral";
  return "dot-success";
}

export function CalendarPage() {
  useLocale();   // 订阅语言
  const { projectId } = useParams({ from: "/_app/projects/$projectId/calendar" });
  const [month, setMonth] = useState(() => toISODate(new Date()).slice(0, 7));
  const [openId, setOpenId] = useState<string | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [listDate, setListDate] = useState<string | null>(null);
  const [unscheduledPage, setUnscheduledPage] = useState(1);
  const workList = useRef<HTMLUListElement>(null);
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.calendar(projectId, month),
    queryFn: () => calendar(projectId!, month),
  });
  const unscheduled = useQuery({
    queryKey: queryKeys.calendarUnscheduled(projectId, unscheduledPage),
    queryFn: () => apiGet<{ rows: { id: string; key: string; title: string; type: string }[]; total: number }>(
      `/api/v1/projects/${projectId}/work-items`, { view: "table", unscheduled: true, page: unscheduledPage, pageSize: 30 }),
    enabled: listDate === "unscheduled",
  });

  const byDay = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y!, m! - 1, 1);
  const daysInMonth = new Date(y!, m!, 0).getDate();
  const leading = first.getDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = toISODate(new Date());
  const monthLabel = new Date(y!, m! - 1, 1).toLocaleDateString(currentLocale(), { year: "numeric", month: "long" });
  const shiftMonth = (delta: number) => {
    const next = new Date(y!, m! - 1 + delta, 1);
    setMonth(toISODate(next).slice(0, 7));
  };

  return (
    <div className="page project-refinement calendar-page">
      <WorkItemViewHeader projectId={projectId!} active="calendar"
        onCreate={() => setCreateDate(today)}
        onRefresh={() => void qc.invalidateQueries({ queryKey: queryKeys.calendar(projectId) })} />

      {isLoading && <LoadingBlock />}
      {isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={error instanceof ApiError ? error.message : undefined}
        action={() => void refetch()} actionLabel={t("common.reload")} />}

      {!isLoading && !isError && (
        <>
          <section className="panel calendar-page-panel">
            <div className="calendar-month-head">
              <strong aria-live="polite">{monthLabel}</strong>
              <div className="calendar-month-actions" role="group" aria-label={t("cal.monthNavigation")}>
                <Button size="sm" iconOnly variant="ghost" aria-label={t("cal.previousMonth")} onClick={() => shiftMonth(-1)}>
                  <Icon name="chevron-left" size={16} />
                </Button>
                <Button size="sm" onClick={() => setMonth(toISODate(new Date()).slice(0, 7))}>{t("cal.today")}</Button>
                <Button size="sm" iconOnly variant="ghost" aria-label={t("cal.nextMonth")} onClick={() => shiftMonth(1)}>
                  <Icon name="chevron-right" size={16} />
                </Button>
              </div>
            </div>
            <div className="calendar-grid">
            {WEEK_KEYS.map((w) => <div key={w} className="calendar-weekday">{t(w)}</div>)}
            {cells.map((date, i) => {
              const day = date ? byDay.get(date) : null;
              const isToday = date === today;
              return (
                <div key={i} className={`calendar-cell${isToday ? " is-today" : ""}`}>
                  {date && (
                    <>
                      <button type="button" className="calendar-date calendar-date-action muted" aria-label={`${date} · ${t("wie.create")}`} onClick={() => setCreateDate(date)}>
                        {Number(date.slice(-2))}
                      </button>
                      {(day?.items ?? []).slice(0, 3).map((it) => {
                        return (
                          <button type="button" className="calendar-item-action" key={it.id} title={it.title} aria-label={`${it.key} ${it.title}`}
                            onClick={() => setOpenId(it.id)}>
                            <span className={`dot ${dotClass(it.type)}`} />
                            <span className="mono">{it.key}</span>
                            <span className="muted">
                              {TYPE_LABEL_KEY[it.type] ? t(TYPE_LABEL_KEY[it.type]!) : it.type}
                            </span>
                          </button>
                        );
                      })}
                      {(day?.count ?? 0) > 3 && (
                        <button type="button" className="btn-link calendar-more-action" onClick={() => setListDate(date)}>{t("cal.moreItems", { n: day!.count - 3 })}</button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            </div>
          </section>
          {(data?.days ?? []).every((day) => day.items.length === 0) && <p className="muted">{t("cal.noMonthItems")}</p>}
          {/* 无日期项必须可见，否则用户不知道「还有 N 个没日期」 */}
          <p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: 12 }}>
            {t("cal.alsoOthers")} <strong>{data?.unscheduled ?? 0}</strong> {t("cal.noDateSuffix")}
            {Boolean(data?.unscheduled) && <Button size="sm" variant="ghost" onClick={() => { setUnscheduledPage(1); setListDate("unscheduled"); }}>{t("cal.unscheduled")}</Button>}
          </p>
        </>
      )}
      <Drawer open={listDate !== null && openId === null} title={listDate === "unscheduled" ? t("cal.unscheduled") : t("cal.dayItems", { date: listDate ?? "" })}
        onClose={() => setListDate(null)} footer={listDate === "unscheduled" && unscheduled.isSuccess && unscheduled.data.total > 30 ? <PagePagination page={unscheduledPage} pages={Math.ceil(unscheduled.data.total / 30)} total={unscheduled.data.total} onPage={next => {
          setUnscheduledPage(next);
          const body = workList.current?.closest(".ui-drawer-body");
          if (body) body.scrollTop = 0;
        }} /> : undefined}>
        {listDate === "unscheduled" && unscheduled.isLoading && <LoadingBlock compact />}
        {listDate === "unscheduled" && unscheduled.isError && <StateBlock kind="error" title={t("common.loadFailedShort")}
          action={() => void unscheduled.refetch()} actionLabel={t("common.reload")} />}
        <ul ref={workList} className="calendar-work-list">
          {(listDate === "unscheduled" ? unscheduled.data?.rows ?? [] : byDay.get(listDate ?? "")?.items ?? []).map((it) => (
            <li key={it.id}><button type="button" className="calendar-work-link" onClick={() => setOpenId(it.id)}>
              <span className="mono muted">{it.key}</span><span>{it.title}</span>
            </button></li>
          ))}
        </ul>
        {listDate === "unscheduled" && unscheduled.isSuccess && unscheduled.data.total === 0 && <StateBlock kind="empty" title={t("common.noData")} />}
      </Drawer>
      <WorkItemDrawer workItemId={openId} onClose={() => setOpenId(null)} />
      <WorkItemEditor open={!!createDate} projectId={projectId!} initialDueDate={createDate ?? undefined}
        onClose={() => setCreateDate(null)}
        onSaved={(item) => { setCreateDate(null); setOpenId(item.id); }} />
    </div>
  );
}
