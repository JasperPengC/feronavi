import { useId } from "react";
import { t, useLocale } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";
import { InfoTip } from "./ui/InfoTip.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

type TrendDay = { date: string; created: number; resolved: number };
const severities = ["S1", "S2", "S3", "S4"];

export function IssueInsights({ trend, severity, isGlobal }: {
  trend: TrendDay[]; severity: Record<string, number>; isGlobal: boolean;
}) {
  const locale = useLocale();
  const id = useId();
  const created = trend.reduce((sum, day) => sum + day.created, 0);
  const resolved = trend.reduce((sum, day) => sum + day.resolved, 0);
  const hasActivity = created + resolved > 0;
  const peak = Math.max(1, ...trend.flatMap(day => [day.created, day.resolved]));
  const ceiling = peak <= 2 ? peak : Math.ceil(peak / 2) * 2;
  const ticks = ceiling > 1 ? [ceiling, ceiling / 2, 0] : [1, 0];
  const axisNumber = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const countNumber = new Intl.NumberFormat(locale);
  const dateCount = Math.min(4, trend.length);
  const dates = new Set(Array.from({ length: dateCount }, (_, i) =>
    Math.round(i * (trend.length - 1) / Math.max(1, dateCount - 1))));
  const total = Object.values(severity).reduce((sum, count) => sum + count, 0);
  const levels = [...severities, ...Object.keys(severity).filter(key => !severities.includes(key) && severity[key]! > 0)];

  return <div id="issues-insights" className="issues-insights">
    <section aria-labelledby={`${id}-trend`}>
      <header className="issues-insight-heading">
        <h3 id={`${id}-trend`}>{t("issues.trendTitle")}</h3>
        <InfoTip text={isGlobal ? t("issues.trendHintGlobal") : t("issues.trendHint")} />
      </header>
      {hasActivity ? <>
        <div className="issues-trend-legend">
          <span><i className="is-created" />{t("issues.trendCreated")}<strong>{countNumber.format(created)}</strong></span>
          <span><i className="is-resolved" />{t("issues.trendResolved")}<strong>{countNumber.format(resolved)}</strong></span>
        </div>
        <div className="issues-trend-chart">
          <div className="issues-trend-grid" aria-hidden="true">
            {ticks.map(tick => <div key={tick}><span>{axisNumber.format(tick)}</span><i /></div>)}
          </div>
          <div className="issues-trend" role="group" aria-label={t("issues.trendDaily")}>
            {trend.map(day => <Tooltip key={day.date} followPointer className="chart-hover-tip" content={<>
              <strong>{day.date}</strong><span>{t("issues.trendCreated")} {countNumber.format(day.created)}</span><span>{t("issues.trendResolved")} {countNumber.format(day.resolved)}</span>
            </>}>
              {trigger => <div {...trigger} className="issues-trend-day chart-tip-host" tabIndex={0}
                aria-label={t("issues.trendDay", { date: day.date, created: day.created, resolved: day.resolved })}>
                <div className="issues-trend-bars" aria-hidden="true">
                  <span className="issues-trend-bar is-created" style={{ height: `${day.created / ceiling * 100}%` }} />
                  <span className="issues-trend-bar is-resolved" style={{ height: `${day.resolved / ceiling * 100}%` }} />
                </div>
              </div>}
            </Tooltip>)}
          </div>
          <div className="issues-trend-dates" style={{ gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {trend.map((day, index) => dates.has(index) && <span key={day.date} style={{ gridColumn: index + 1 }}>{day.date.slice(-5)}</span>)}
          </div>
        </div>
      </> : <div className="issues-trend-empty"><Icon name="chart" size={20} /><p>{t("issues.trendEmpty")}</p></div>}
    </section>
    <section aria-labelledby={`${id}-severity`}>
      <header className="issues-insight-heading"><h3 id={`${id}-severity`}>{t("issues.severityTitle")}</h3></header>
      <p className="issues-insight-caption">{t("issues.severityScope")}</p>
      {total > 0 ? <ul className="issues-severity" aria-label={t("issues.severityTitle")}>
        {levels.map(level => {
          const count = severity[level] ?? 0;
          const percent = Math.round(count / total * 100);
          return <li key={level} data-severity={level}>
            <span className="issues-sev-label">{level === "none" ? t("issues.severityUnset") : level}</span>
            <span className="issues-sev-track" aria-hidden="true"><span style={{ width: `${count / total * 100}%` }} /></span>
            <strong>{countNumber.format(count)}</strong><small>{percent}%</small>
          </li>;
        })}
      </ul> : <p className="issues-severity-empty">{t("issues.severityEmpty")}</p>}
    </section>
  </div>;
}
