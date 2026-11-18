/**
 * 页面基元（前端长目标第 1 轮）
 *
 * 目的：让**每一页长得一样、写起来一样快**。规格（DESIGN-SPEC 第 3、5 节）要求
 * 各页复用同一套标题行、筛选行与列宽 —— 靠"每页自己写 div"是做不到的，必须有基元。
 *
 * 只用真实数据：`Metric` 的值必须来自接口，禁止用占位数字撑版面（有断言守）。
 */
import type { ReactNode } from "react";
import { t } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";
import { InfoTip } from "./ui/InfoTip.tsx";

/**
 * 页头 —— **照原型的 .page-header**（本轮用 Playwright 量得：flex / align-items:flex-end /
 * justify-content:space-between / gap:20px / margin-bottom:24px；内含
 * .eyebrow（10px、--blue-bright、700）、h1（30px、700、letter-spacing:-0.9px、mb 6px）与副标题）。
 * 此前我用 .page-head 且没有 eyebrow —— 这是「标题位置比原型高 34px」的直接原因。
 */

export function PageHead({ title, sub, hint, actions }: {
  eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; hint?: string; actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-row">
        <div className="page-heading">
          <span className="page-heading-mark" aria-hidden="true" />
          <div className="page-heading-copy">
            <div className="page-title-line">
              <h1 className="page-title">{title}</h1>
              {hint && <InfoTip text={hint} />}
            </div>
            {sub && <p className="page-sub">{sub}</p>}
          </div>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export interface MetricSpec {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** 宽指标：放胶囊/图表等横向内容 */
  wide?: boolean;
}

export function MetricRow({ items }: { items: MetricSpec[] }) {
  return (
    <div className="metric-row">
      {items.map((m, i) => (
        <div className={`metric${m.wide ? " metric-wide" : ""}`} key={i}>
          <span className="metric-label">{m.label}</span>
          <span className="metric-value">{m.value}</span>
          {m.hint && <span className="metric-hint">{m.hint}</span>}
        </div>
      ))}
    </div>
  );
}

/** 2/3 主列 + 1/3 辅列；窄屏自动堆叠。辅列不传则整宽。 */
export function PageGrid({ main, side }: { main: ReactNode; side?: ReactNode }) {
  if (!side) return <div className="page-full">{main}</div>;
  return (
    <div className="page-grid">
      <section className="main-col">{main}</section>
      <aside className="side-col">{side}</aside>
    </div>
  );
}

/** 工具条：筛选/视图切换统一用胶囊（规格第 5 节） */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function Chip({ active, children, onClick, title }: {
  active?: boolean; children: ReactNode; onClick?: () => void; title?: string;
}) {
  return (
    <button type="button" className="chip" aria-pressed={!!active} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/** 空态：必须给出**下一步动作**，不是一句"暂无数据" */
export function EmptyState({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-panel">
      <span className="empty-mark" aria-hidden="true"><Icon name="inbox" size={18} /></span>
      <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{title}</p>
      {hint && <p className="muted" style={{ margin: "0 0 16px", fontSize: "var(--text-sm)" }}>{hint}</p>}
      {action}
    </div>
  );
}

/** 统一的加载态（骨架，避免"卡住"错觉；动效见 shell.css 的 pulse-soft） */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => <div className="skeleton skeleton-row" key={i} />)}
      <span className="sr-only">{t("common.loadingShort")}</span>
    </div>
  );
}

/** 错误态：与 StateBlock 同一套语言；给出可执行建议/重试，不把原始异常甩给用户 */
export function ErrorState({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-state-block ui-state-error" role="alert">
      <span className="ui-state-mark" aria-hidden="true"><Icon name="x" size={18} /></span>
      <div className="ui-state-copy">
        <strong>{t("common.loadFailedShort")}</strong>
        <p>{message}</p>
        {action}
      </div>
    </div>
  );
}
