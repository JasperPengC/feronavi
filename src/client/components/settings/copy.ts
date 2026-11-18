import type { Locale } from "../../i18n/index.ts";

export type SettingsCopyKey =
  | "channelsDescription"
  | "email"
  | "emailFollowHint"
  | "webhookLoadFailed"
  | "webhookDeleted"
  | "webhookDeleteFailed"
  | "skillLoadFailed"
  | "skillUpdated"
  | "skillUpdateFailed"
  | "usageLoadFailed"
  | "monthUsage"
  | "configuredModel"
  | "twoFactor"
  | "securityDescription"
  | "providerEmpty"
  | "flagsDescription"
  | "skillAppliesTo";

const COPY: Record<Locale, Record<SettingsCopyKey, string>> = {
  "zh-CN": {
    channelsDescription: "站内通知按类别控制。邮件投递由工作项关注渠道控制；需要实例已配置 SMTP。",
    email: "邮件",
    emailFollowHint: "随工作项关注设置",
    webhookLoadFailed: "Webhook 加载失败。请检查集成权限后重试。",
    webhookDeleted: "Webhook 已删除",
    webhookDeleteFailed: "Webhook 删除失败",
    skillLoadFailed: "Skill 加载失败。请检查 AI 配置权限后重试。",
    skillUpdated: "Skill 状态已更新",
    skillUpdateFailed: "Skill 更新失败",
    usageLoadFailed: "用量加载失败。",
    monthUsage: "本月用量：{tokens} tokens · {calls} 次调用 · {queries} 次检索",
    configuredModel: "已配置：{model}（{dimensions} 维）",
    twoFactor: "双因素认证",
    securityDescription: "管理双因素认证，或下载自己的数据副本。导出不包含密码与令牌等安全信息。",
    providerEmpty: "还没有供应商。添加后可选择默认模型。",
    flagsDescription: "管理自定义功能开关。当前没有系统功能使用这些开关，添加后需由对应扩展接入。",
    skillAppliesTo: "适用范围：{scope}",
  },
  "en-US": {
    channelsDescription: "In-app notifications are controlled by category. Email delivery is selected when following a work item and requires SMTP to be configured for this instance.",
    email: "Email",
    emailFollowHint: "Set when following a work item",
    webhookLoadFailed: "Could not load webhooks. Check integration access and try again.",
    webhookDeleted: "Webhook deleted",
    webhookDeleteFailed: "Could not delete webhook",
    skillLoadFailed: "Could not load skills. Check AI configuration access and try again.",
    skillUpdated: "Skill status updated",
    skillUpdateFailed: "Could not update skill",
    usageLoadFailed: "Could not load usage.",
    monthUsage: "Usage this month: {tokens} tokens · {calls} calls · {queries} searches",
    configuredModel: "Configured: {model} ({dimensions} dimensions)",
    twoFactor: "Two-factor authentication",
    securityDescription: "Manage two-factor authentication or download a copy of your data. Passwords and tokens are excluded from the export.",
    providerEmpty: "No providers yet. Add one to choose your default model.",
    flagsDescription: "Manage custom feature flags. No built-in features use these flags; extensions must connect to them after creation.",
    skillAppliesTo: "Applies to: {scope}",
  },
};

export function settingsCopy(locale: Locale, key: SettingsCopyKey, values: Record<string, string | number> = {}): string {
  return COPY[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}
