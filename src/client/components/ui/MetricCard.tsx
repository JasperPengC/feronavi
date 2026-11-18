import type { ReactNode } from "react";
import { Icon, type IconName } from "../Icon.tsx";

const ICON_BY_TONE: Record<string, IconName> = {
  neutral: "grid", primary: "activity", success: "check", warning: "info",
};

/** 标签、数值和状态图标沿用工作台的圆润卡片结构。 */
export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  visual,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning";
  visual?: ReactNode;
  className?: string;
}) {
  return (
    <article className={["ui-panel", "ui-panel-padding-md", "metric-card", "ui-metric-card", `ui-metric-${tone}`, className].filter(Boolean).join(" ")}>
      <span className="ui-metric-icon" aria-hidden="true"><Icon name={ICON_BY_TONE[tone] ?? "grid"} size={18} /></span>
      <span className="ui-metric-copy">
        <span className="ui-metric-label">{label}</span>
        <span className="ui-metric-line">
          <strong className="ui-metric-value">{value}</strong>
          {detail && <span className="ui-metric-detail">{detail}</span>}
        </span>
      </span>
      {visual && <span className="ui-metric-visual" aria-hidden="true">{visual}</span>}
    </article>
  );
}
