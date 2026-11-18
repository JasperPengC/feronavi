/**
 * 个人与实例设置。
 *
 * 页面只负责读取当前身份、编排区块和显示反馈；每个设置区块拥有自己的查询与保存状态。
 * 服务端权限仍是最终边界，前端权限仅用于避免展示用户无法操作的管理入口。
 *
 * 布局与「系统自检」一致：顶部 segmented tabs 切域，内容一次只呈现一个分组；
 * 不再用左侧锚点导航把所有分组堆成一条长页。
 */
import { useState, type ReactNode } from "react";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { Link } from "@tanstack/react-router";
import { PageHead } from "../components/Page.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { t, useLocale } from "../i18n/index.ts";
import { useActor } from "../lib/actor.ts";
import { AppearanceSettings } from "../components/settings/AppearanceSettings.tsx";
import { NotificationSettings } from "../components/settings/NotificationSettings.tsx";
import { SmtpSettings } from "../components/settings/SmtpSettings.tsx";
import { AiSettings } from "../components/settings/AiSettings.tsx";
import { WebhookSettings } from "../components/settings/WebhookSettings.tsx";
import { ImSettings } from "../components/settings/ImSettings.tsx";
import { SecuritySettings } from "../components/settings/SecuritySettings.tsx";
import { RetentionSettings } from "../components/settings/RetentionSettings.tsx";
import { IntegrationSettings } from "../components/settings/IntegrationSettings.tsx";
import { SsoSettings } from "../components/settings/SsoSettings.tsx";
import { ScimSettings } from "../components/settings/ScimSettings.tsx";
import { OrganizationSettings } from "../components/settings/OrganizationSettings.tsx";
import { StorageSettings } from "../components/settings/StorageSettings.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";

type SettingsTab = "personal" | "integrations" | "instance";

export function SettingsPage({ section = "personal" }: { section?: SettingsTab }) {
  useLocale();
  const actor = useActor();
  const has = (permission: string) => actor.permissions.includes(permission);
  const canIntegrations = has("setting:manage") || has("ai:configure") || has("integration:manage");
  const canInstance = has("setting:manage") || has("org:manage");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const activeTab: SettingsTab = section;
  const pageTitle = section === "integrations" ? t("se.groupIntegrations") : section === "instance" ? t("se.groupInstance") : t("se.groupPersonal");
  // 操作成功/失败一律走全局 toast；页面内只保留加载态/校验态，不再占用顶部空间
  const feedback = {
    onSuccess: (next: string) => toast.success(next),
    onError: (next: string) => toast.error(next),
  };

  const areas: { value: string; label: string; content: ReactNode }[] = section === "personal" ? [
    { value: "appearance", label: t("sections.appearance"), content: <AppearanceSettings {...feedback} /> },
    { value: "notifications", label: t("notif.title"), content: <NotificationSettings {...feedback} /> },
    { value: "security", label: t("sections.security"), content: <SecuritySettings {...feedback} /> },
  ] : section === "instance" ? [
    ...(has("org:manage") ? [{ value: "organization", label: t("sections.organization"), content: <OrganizationSettings {...feedback} /> }] : []),
    ...(has("setting:manage") ? [
      { value: "mail", label: t("sections.mail"), content: <SmtpSettings {...feedback} /> },
      { value: "storage", label: t("se.storageTitle"), content: <StorageSettings {...feedback} /> },
      { value: "retention", label: t("set.retention"), content: <RetentionSettings {...feedback} /> },
    ] : []),
  ] : [
    ...(has("ai:configure") ? [{ value: "ai", label: t("se.areaAi"), content: <AiSettings {...feedback} /> }] : []),
    ...(has("integration:manage") ? [{ value: "messaging", label: t("se.areaMessaging"), content: <><ImSettings {...feedback} /><WebhookSettings {...feedback} /><IntegrationSettings {...feedback} /></> }] : []),
    ...(has("setting:manage") ? [{ value: "access", label: t("se.areaAccess"), content: <><SsoSettings {...feedback} /><ScimSettings {...feedback} /></> }] : []),
  ];
  const selected = areas.find(area => area.value === selection[section])?.value ?? areas[0]?.value ?? "";
  const tabsId = `settings-${section}`;

  return (
    <div className={`page settings-page settings-page--${section}`}>
      <PageHead title={pageTitle} />

      <div className="settings-content">
        {((activeTab === "integrations" && !canIntegrations) || (activeTab === "instance" && !canInstance)) && (
          <>
            <StateBlock kind="restricted" title={t("se.restricted")} description={t("se.restrictedHint")} />
            <Link className="btn btn-sm" to="/settings/personal">{t("se.groupPersonal")}</Link>
          </>
        )}
        {areas.length > 0 && <>
          <PageTabs id={tabsId} label={pageTitle} tabs={areas} value={selected}
            onChange={value => setSelection(current => ({ ...current, [section]: value }))} />
          {areas.map(area => <TabPanel key={`${section}-${area.value}`} tabsId={tabsId} value={area.value} activeValue={selected}>
            <div className="settings-grid">{area.content}</div>
          </TabPanel>)}
        </>}

      </div>
    </div>
  );
}
