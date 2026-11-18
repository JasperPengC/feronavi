import { t } from "../i18n/index.ts";
import { Button } from "./ui/Button.tsx";
import { ExternalLinkButton } from "./ui/LinkButton.tsx";

/** 通知中的工作项地址是领域引用，使用已有详情抽屉打开。 */
export function NotificationAction({ link, onOpenWorkItem }: { link: string | null; onOpenWorkItem: (id: string) => void }) {
  if (!link) return null;
  const workItem = /^\/work-items\/([^/?#]+)(?:[?#].*)?$/.exec(link);
  if (workItem) return <Button size="sm" variant="ghost" onClick={() => onOpenWorkItem(workItem[1]!)}>{t("notif.openWorkItem")}</Button>;
  return <ExternalLinkButton size="sm" href={link}>{t("notif.open")}</ExternalLinkButton>;
}
