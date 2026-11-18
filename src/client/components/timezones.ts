/**
 * 时区选项（IANA 全量，供可搜索下拉使用）
 *
 * 为什么不再让人手输：时区是**有限枚举**（IANA 数据库），手输最容易写错拼写或写出不存在的名字；
 * 设置页旧实现是自由文本 + placeholder "Asia/Shanghai" —— 用户反馈"是不是下拉选择更合理"，判断成立。
 * 用 `Intl.supportedValuesOf("timeZone")` 取浏览器内置列表（与运行时一致），常用时区置顶；
 * 老浏览器没有该 API 时退回一份常用清单。
 */
import type { SelectOption } from "./Select.tsx";

/** 常用时区置顶（自托管团队的常见选择） */
const COMMON = [
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Seoul",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo",
  "Australia/Sydney", "Pacific/Auckland", "UTC",
];

export function timeZoneOptions(): SelectOption[] {
  const supportedOf = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const all = typeof supportedOf === "function" ? supportedOf.call(Intl, "timeZone") : COMMON;
  if (!all.includes("UTC")) all.push("UTC");
  const rest = all.filter((z) => !COMMON.includes(z)).sort();
  return [...COMMON, ...rest].map((z) => ({ value: z, label: z }));
}
