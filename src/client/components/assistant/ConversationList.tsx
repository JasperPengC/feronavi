import { Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../Icon.tsx";
import { apiGet, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import type { RagConversationList } from "../../../shared/rag-conversations.ts";

export function ConversationList({ accountId, activeId, deleted, onDeletedChange, onSelect }: {
  accountId: string; activeId?: string; deleted: boolean; onDeletedChange: (value: boolean) => void; onSelect: () => void;
}) {
  const list = useInfiniteQuery({
    queryKey: ["rag-conversations", accountId, { deleted }], initialPageParam: 1,
    queryFn: ({ pageParam }) => apiGet<RagConversationList>("/api/v1/rag/conversations", { deleted, page: pageParam, pageSize: 50 }),
    getNextPageParam: (last) => last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return <div className="assistant-session-list">
    <div className="assistant-session-tabs" aria-label={t("assistant.history")}>
      <Button variant="ghost" size="sm" aria-pressed={!deleted} onClick={() => onDeletedChange(false)}>{t("assistant.history")}</Button>
      <Button variant="ghost" size="sm" aria-pressed={deleted} onClick={() => onDeletedChange(true)}>{t("assistant.deleted")}</Button>
    </div>
    {deleted && <p className="assistant-list-hint">{t("assistant.deletedHint")}</p>}
    {list.isPending && <p role="status" className="assistant-list-hint">{t("assistant.loading")}</p>}
    {list.isError && <div role="alert" className="assistant-list-hint"><p>{list.error instanceof ApiError ? list.error.message : t("assistant.listFailed")}</p><Button size="sm" onClick={() => void list.refetch()}>{t("kn.retry")}</Button></div>}
    {list.isSuccess && !items.length && <p className="assistant-list-hint">{t(deleted ? "assistant.noDeleted" : "assistant.noHistory")}</p>}
    <nav aria-label={t("assistant.history")} className="assistant-session-items">
      {items.map((conversation) => <Link key={conversation.id} to="/assistant" search={{ conversation: conversation.id }}
        onClick={onSelect} aria-current={activeId === conversation.id ? "page" : undefined} className="assistant-session-link" title={conversation.title}>
        <span className="assistant-session-title">{conversation.title}</span>
        <span className="assistant-session-scope"><Icon name={conversation.projectId ? "folder" : "layers"} size={12} /><span>{conversation.projectName ?? t(conversation.projectId ? "assistant.unavailable" : "assistant.all")}</span></span>
        <time dateTime={conversation.updatedAt}>{conversation.updatedAt.slice(0, 10)}</time>
      </Link>)}
    </nav>
    {list.hasNextPage && <Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("assistant.moreConversations")}</Button>}
  </div>;
}
