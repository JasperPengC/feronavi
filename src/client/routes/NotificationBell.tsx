/**
 * 通知铃铛（T6）：未读徽标 + 下拉列表。
 * 徽标数字必须与 aria-label 同时给出（纯数字对读屏没有意义）。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { t, useLocale, currentLocale } from "../i18n/index.ts";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "../lib/planning-api.ts";
import { Icon } from "../components/Icon.tsx";
import { Button } from "../components/ui/Button.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { ApiError } from "../lib/api.ts";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { NotificationAction } from "../components/NotificationAction.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";

export function NotificationBell() {
  useLocale();   // 订阅语言
  const [open, setOpen] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); anchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    dialogRef.current?.focus();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 文档契约：unreadCount 内嵌在列表返回体里 —— 一个请求同时喂铃铛与列表
  const list = useQuery({ queryKey: queryKeys.notifications(), queryFn: () => notifications.list(), refetchInterval: 30_000 });

  const markRead = useMutation({
    mutationFn: (id: string) => notifications.markRead([id]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.notifications() });
      await qc.invalidateQueries({ queryKey: ["notif-unread"] });
    },
    // 失败不能静默：铃铛里的「标为已读」点了没反应 = 用户无法判断是否成功
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("notif.actionFailed")),
  });

  const n = list.data?.unreadCount ?? 0;

  return (
    <><div className="notification-anchor" ref={anchorRef}>
      <Button size="sm" iconOnly className="notification-trigger" aria-label={list.isSuccess ? t("notif.bellLabel", { n }) : t("notif.title")}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" />{n > 0 && <span className="notification-count" aria-hidden="true">{n}</span>}
      </Button>
      {open && (
        <div ref={dialogRef} tabIndex={-1} className="notification-popover card" role="dialog" aria-label={t("notif.title")}>
          <div className="notification-popover-head">
            <strong>{t("notif.title")}</strong>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("notif.close")}</Button>
          </div>
          {list.isLoading && <LoadingBlock compact />}
          {list.isError && <StateBlock kind="error" title={t("notif.loadFailed")} action={() => void list.refetch()} actionLabel={t("common.reload")} />}
          {list.isSuccess && list.data.items.length === 0 && <div className="notification-empty">
            <strong>{t("notif.empty")}</strong><p className="muted">{t("notif.emptyHint")}</p>
          </div>}
          {(list.data?.items ?? []).slice(0, 20).map((x) => (
            <div className="notification-item" data-unread={!x.readAt ? "true" : "false"} key={x.id}>
              <div className="notification-item-title">
                {x.itemCount > 1 && <span className="muted">×{x.itemCount} </span>}
                {x.title}
              </div>
              <div className="muted notification-item-body">{x.body}</div>
              <div className="notification-item-meta">
                <span className="muted">
                  {new Date(x.createdAt).toLocaleString(currentLocale())}
                </span>
                {!x.readAt && (
                  <Button size="sm" variant="ghost" disabled={markRead.isPending} onClick={() => markRead.mutate(x.id)}>{t("notif.markRead")}</Button>
                )}
              </div>
              <NotificationAction link={x.link} onOpenWorkItem={(id) => {
                anchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
                setOpen(false); setOpenItemId(id);
              }} />
            </div>
          ))}
          <div className="notification-popover-footer"><Link to="/notifications" onClick={() => setOpen(false)}>{t("notif.viewAll")}</Link></div>
        </div>
      )}
    </div><WorkItemDrawer workItemId={openItemId} onClose={() => setOpenItemId(null)} /></>
  );
}
