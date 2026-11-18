/**
 * 相对时间（"4 分钟前"）—— 外壳重做第 20 轮。
 *
 * 用内置 `Intl.RelativeTimeFormat` 而不是自己拼字符串：
 * 它**自带本地化**（中文"3 分钟前" / 英文"3 minutes ago"），因此**不需要新增词典键** ——
 * 少一批键就少一类"漏译/缺键"问题（本会话已因缺键吃过一次亏）。
 */
import { currentLocale } from "../i18n/index.ts";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
  ["second", 1000],
];

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = t - Date.now();           // 负数 = 过去
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (abs >= ms || unit === "second") return rtf.format(Math.round(diff / ms), unit);
  }
  return "—";
}
