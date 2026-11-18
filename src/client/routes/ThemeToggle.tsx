/** 单图标主题菜单；登录页仅保存本地选择。 */
import { useState } from "react";
import { applyTheme, readTheme, setTheme, type ThemeChoice } from "../lib/theme.ts";
import { apiPut } from "../lib/api.ts";
import { t } from "../i18n/index.ts";
import { IconChoiceMenu } from "../components/ui/IconChoiceMenu.tsx";

// 文案走 i18n（键在字典里，组件不写死语言）
/** 每档配一个图标（图标化后仍必须给 aria-label：读屏听到的是"浅色"，不是"图标"） */
const ICON: Record<string, "sun" | "moon" | "monitor"> = { light: "sun", dark: "moon", auto: "monitor" };
const OPTIONS: { value: ThemeChoice; key: string }[] = [
  { value: "light", key: "theme.light" },
  { value: "dark", key: "theme.dark" },
  { value: "auto", key: "theme.auto" },
];

export function ThemeToggle({ syncPreference = true }: { syncPreference?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme());

  // 系统主题监听由应用级注册（main.tsx）—— 组件卸载不应停止跟随系统

  function pick(v: ThemeChoice) {
    setChoice(v);
    setTheme(v);
    // 同步账号偏好（服务端值域 system/light/dark），否则刷新后会被旧偏好覆盖
    if (syncPreference) void apiPut("/api/v1/me/preferences", { theme: v === "auto" ? "system" : v }).catch(() => {});
    // 通知订阅者（图例等处需要立刻反映"生效主题"）
    window.dispatchEvent(new Event("feronavi:theme"));
  }


  return <IconChoiceMenu className="theme-menu" label={t("theme.group")} icon={ICON[choice] ?? "monitor"}
    value={choice} options={OPTIONS.map((option) => ({ value: option.value, label: t(option.key), icon: ICON[option.value] }))}
    onChange={pick} />;
}

export { applyTheme };
