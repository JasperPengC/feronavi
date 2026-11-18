import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";

export type StateBlockKind = "loading" | "empty" | "error" | "restricted";

export function StateBlock({
  kind,
  title,
  description,
  action,
  actionLabel,
}: {
  kind: StateBlockKind;
  title: ReactNode;
  description?: ReactNode;
  action?: () => void;
  actionLabel?: ReactNode;
}) {
  return (
    <div className={`ui-state-block ui-state-${kind}`} role={kind === "error" ? "alert" : undefined} aria-busy={kind === "loading" ? "true" : undefined}>
      <span className="ui-state-mark" aria-hidden="true">
        {kind === "loading" ? "" : <Icon name={kind === "error" ? "x" : kind === "restricted" ? "shield" : "inbox"} size={18} />}
      </span>
      <div className="ui-state-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
        {action && actionLabel && <Button size="sm" variant="secondary" onClick={action}>{actionLabel}</Button>}
      </div>
    </div>
  );
}

/** 统一加载态：页面级或卡片内嵌（compact） */
export function LoadingBlock({ label, compact = false }: { label?: ReactNode; compact?: boolean }) {
  return (
    <div className={`ui-loading${compact ? " ui-loading-compact" : ""}`} role="status" aria-busy="true" aria-live="polite">
      <span className="ui-loading-spinner" aria-hidden="true" />
      <span className="ui-loading-label">{label ?? t("common.loading")}</span>
    </div>
  );
}
