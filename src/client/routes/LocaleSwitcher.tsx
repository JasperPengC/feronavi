/** 语言切换（未登录/向导场景）：登录后语言跟随账号偏好，此处仅供"还没有账号"的人选择 */
import { t, setLocalePreference, useLocale, SUPPORTED_LOCALES } from "../i18n/index.ts";
import { IconChoiceMenu } from "../components/ui/IconChoiceMenu.tsx";

export function LocaleSwitcher({ compact = false, menu = false }: { compact?: boolean; menu?: boolean }) {
  const current = useLocale();
  if (menu) return <IconChoiceMenu className="locale-menu" label={t("locale.group")} icon="globe"
    value={current} options={SUPPORTED_LOCALES} onChange={setLocalePreference} />;
  return (
    <div role="group" aria-label={t("locale.group")} style={{ display: "inline-flex", gap: 2, padding: 2, background: "var(--surface-raised)", borderRadius: "var(--radius-pill)" }}>
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l.value}
          type="button"
          aria-pressed={current === l.value}
          onClick={() => setLocalePreference(l.value)}
          style={{
            padding: compact ? "2px 8px" : "4px 10px", border: 0, borderRadius: "var(--radius-pill)",
            background: current === l.value ? "var(--primary-soft)" : "transparent",
            color: current === l.value ? "var(--primary-soft-text)" : "var(--text-muted)",
            fontSize: "var(--text-xs)", fontWeight: current === l.value ? 600 : 500,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
