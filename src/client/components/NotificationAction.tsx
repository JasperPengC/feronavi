import { t } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";

/** 通知中的工作项地址是领域引用，使用已有详情抽屉打开。 */
export function NotificationAction({ link, onOpenWorkItem }: { link: string | null; onOpenWorkItem: (id: string) => void }) {
  if (!link) return null;
  const workItem = /^\/work-items\/([^/?#]+)(?:[?#].*)?$/.exec(link);
  if (workItem) return <a className="notification-text-action notification-open-action" aria-label={t("notif.openWorkItem")} title={t("notif.openWorkItem")} href={`/notifications?item=${encodeURIComponent(workItem[1]!)}`} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenWorkItem(workItem[1]!);
  }}><Icon name="arrow" size={16} /></a>;
  if (!/^(?:\/(?![/\\])|https?:\/\/)/i.test(link) || /[\u0000-\u0020\\]/.test(link)) return null;
  return <a className="notification-text-action notification-open-action" aria-label={t("notif.open")} title={t("notif.open")} href={link}><Icon name="arrow" size={16} /></a>;
}
