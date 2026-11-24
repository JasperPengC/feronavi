import { t } from "../../i18n/index.ts";
import { Icon } from "../Icon.tsx";
import type { WorkbenchItem } from "../../lib/planning-api.ts";

export function WorkbenchItemRow({ item, onOpen }: { item: WorkbenchItem; onOpen: (id: string) => void }) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const overdue = item.dueDate !== null && item.dueDate < today;
  return (
    <div className="workbench-item-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
      <span className="mono muted" style={{ fontSize: "var(--text-xs)", flex: "none" }}>{item.key}</span>
      <button type="button" className="row-link" onClick={() => onOpen(item.id)}
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: 0, padding: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}>{item.title}</button>
      {item.priority && <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t(`prio.${item.priority}`)}</span>}
      {overdue ? (
        <span style={{ color: "var(--danger)", fontSize: "var(--text-xs)", flex: "none", display: "inline-flex", alignItems: "center", gap: 4 }} title={t("workbench.overdueTag")}><Icon name="info" size={12} />{t("workbench.overdue")}</span>
      ) : item.dueDate ? (
        <span className="muted" style={{ fontSize: "var(--text-xs)", flex: "none" }}>{item.dueDate}</span>
      ) : null}
    </div>
  );
}
