import type { ReactNode } from "react";
import { InfoTip } from "../ui/InfoTip.tsx";

export function SettingsSection({
  title,
  description,
  hint,
  children,
  actions,
  footer,
  className = "",
  fullWidth = false,
  variant = "card",
  leading,
  status,
}: {
  title: ReactNode;
  description?: ReactNode;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** 卡片底部固定操作区：同排卡片的保存按钮对齐同一底线 */
  footer?: ReactNode;
  className?: string;
  fullWidth?: boolean;
  variant?: "card" | "row";
  leading?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <section className={["settings-section", variant === "row" ? "settings-section--row" : "", fullWidth ? "settings-section--full" : "", className].filter(Boolean).join(" ")}>
      <div className="settings-section__head">
        {leading && <span className="settings-section__leading" aria-hidden="true">{leading}</span>}
        <div className="settings-section__heading">
          <h2 className="settings-section__title">{title}{hint && <InfoTip text={hint} />}{status && <span className="settings-section__status">{status}</span>}</h2>
          {description && <p className="settings-section__description">{description}</p>}
        </div>
        {actions && <div className="settings-section__actions">{actions}</div>}
      </div>
      <div className="settings-section__body">{children}</div>
      {footer && <div className="settings-section__footer">{footer}</div>}
    </section>
  );
}

export function SettingsListState({ children, tone = "muted", action }: { children: ReactNode; tone?: "muted" | "error"; action?: ReactNode }) {
  return (
    <div className={`settings-list-state settings-list-state--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <span>{children}</span>
      {action}
    </div>
  );
}
