/**
 * 通知中心（前端长目标第 6 轮）
 *
 * 此前只有顶栏一个红点，**没有页面** —— 用户看到"有 3 条未读"却点不进去。
 * 一个请求同时喂列表与未读数（`unreadCount` 内嵌在列表返回体里，见契约），避免两处不一致。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHead, EmptyState, Loading, ErrorState } from "../components/Page.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { notifications } from "../lib/planning-api.ts";
import { NotificationAction } from "../components/NotificationAction.tsx";
import { Icon } from "../components/Icon.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { Button } from "../components/ui/Button.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { ApiError } from "../lib/api.ts";
import { t, useLocale, currentLocale } from "../i18n/index.ts";

interface Row {
  id: string; title: string; body: string | null; category: string; link: string | null;
  readAt: string | null; createdAt: string; itemCount?: number;
}

/** 分类标签走词典（字典存键，渲染时翻译） */
const CAT_LABEL: Record<string, string> = {
  MENTION: "notif.catMention", ASSIGN: "notif.catAssign", TRANSITION: "notif.catTransition",
  FIELD_CHANGE: "notif.catFieldChange", ANNOUNCEMENT: "notif.catAnnouncement",
};

export function NotificationsPage() {
  useLocale();   // 订阅语言，切换即时生效
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const { item } = useSearch({ strict: false }) as { item?: string };
  useEffect(() => { if (item) setOpenItemId(item); }, [item]);

  const list = useQuery({
    queryKey: queryKeys.notifications(unreadOnly),
    queryFn: () => notifications.list(unreadOnly),
  });
  const markRead = useMutation({
    mutationFn: (ids: string[]) => notifications.markRead(ids),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: queryKeys.notifications() }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("notif.actionFailed")),
  });
  const markAll = useMutation({
    mutationFn: () => notifications.markAllRead(),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: queryKeys.notifications() }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("notif.actionFailed")),
  });

  const rows = (list.data?.items ?? []) as Row[];
  const unread = list.data?.unreadCount ?? 0;

  return (
    <div className="page collection-page notifications-page">
      <PageHead
        title={t("notif.title")}
      />

      <div className="toolbar notif-toolbar">
        <div className="ui-segmented" role="group" aria-label={t("notif.title")}>
        <button type="button" className="ui-segmented-item" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{t("notif.all")}</button>
        <button type="button" className="ui-segmented-item" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>{t("notif.unreadOnly")}</button>
        </div>
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("notif.mUnread")} {unread} · {t("notif.mListed")} {rows.length}</span>
        <Button size="sm" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()} style={{ marginLeft: "auto" }}>
          {t("notif.markAll")}
        </Button>
      </div>

      <Panel padding="none">
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState message={t("notif.loadFailed")} action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>} /> : rows.length === 0
          ? <EmptyState
              title={unreadOnly ? t("notif.emptyUnread") : t("notif.empty")}
              hint={t("notif.emptyHint")}
            />
          : (
            <ul className="notif-list">
              {rows.map((n) => (
                <li key={n.id} data-unread={n.readAt ? "false" : "true"}>
                  <span className="notif-dot" aria-hidden="true" />
                  <div className="notif-main">
                    <div className="notif-head">
                      <span className="tag">{CAT_LABEL[n.category] ? t(CAT_LABEL[n.category]!) : n.category}</span>
                      <strong>{n.title}</strong>
                      {typeof n.itemCount === "number" && n.itemCount > 1 && <span className="tag">×{n.itemCount}</span>}
                      <span className="muted" style={{ marginLeft: "auto", fontSize: "var(--text-xs)" }}>
                        {new Date(n.createdAt).toLocaleString(currentLocale())}
                      </span>
                    </div>
                    {n.body && <p className="notif-body">{n.body}</p>}
                    <div className="notif-actions">
                      {!n.readAt && (
                        <button type="button" className="notification-text-action" disabled={markRead.isPending || markAll.isPending} onClick={() => markRead.mutate([n.id])}><Icon name="check" size={14} />{t("notif.markRead")}</button>
                      )}
                      <NotificationAction link={n.link} onOpenWorkItem={setOpenItemId} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Panel>
      <WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} />
    </div>
  );
}
