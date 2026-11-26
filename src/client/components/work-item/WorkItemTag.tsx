import { t } from "../../i18n/index.ts";

type Tone = "neutral" | "danger" | "warning" | "primary" | "info" | "success";
const priorities: Record<string, Tone> = { URGENT: "danger", HIGH: "warning", MEDIUM: "primary", LOW: "info", LOWEST: "neutral" };
const severities: Record<string, Tone> = { S1: "danger", S2: "warning", S3: "primary", S4: "neutral" };

/** 统一工作项标签语义；保留状态原名，不能只依赖颜色传递信息。 */
export function WorkItemTag({ kind, value, label, stateKey }: {
  kind: "priority" | "status" | "severity"; value?: string | null; label?: string | null; stateKey?: string | null;
}) {
  if (!value && !label) return <span className="muted">—</span>;
  let tone: Tone = "neutral";
  if (kind === "priority") tone = priorities[value ?? ""] ?? "neutral";
  if (kind === "severity") tone = severities[value ?? ""] ?? "neutral";
  if (kind === "status") {
    if (/CANCEL|REJECT|WONT_FIX|DUPLICATE/iu.test(stateKey ?? "")) tone = "neutral";
    else if (/BLOCK|FAILED/iu.test(stateKey ?? "")) tone = "danger";
    else if (/REVIEW|VERIFY|TEST|WAIT|PENDING_APPROVAL/iu.test(stateKey ?? "")) tone = "warning";
    else if (value === "IN_PROGRESS") tone = "primary";
    else if (value === "DONE" || value === "TERMINAL") tone = "success";
  }
  const text = label || (kind === "priority" && value && priorities[value] ? t(`prio.${value}`) : value);
  return <span className="wi-tag" data-kind={kind} data-tone={tone} title={text ?? undefined}>
    <span className="wi-tag-dot" aria-hidden="true" />{text}
  </span>;
}
