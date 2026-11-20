/**
 * 在线成员头像组（Round 25 长任务第 48 项）
 *
 * 数据源：`GET /api/v1/presence` 首屏快照 + SSE `presence` 事件触发失效重取。
 * 无 SSE 环境仍能工作（30s 轮询兜底）；没有人在线时不渲染（不占顶栏）。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api.ts";
import { t } from "../i18n/index.ts";
import { firstGrapheme } from "../lib/first-grapheme.ts";
import { useActor } from "../lib/actor.ts";

interface OnlineMember { memberId: string; name: string; username: string; lastSeen: number }

export function PresenceAvatars({ countOnly = false }: { countOnly?: boolean }) {
  const actor = useActor();
  const q = useQuery({
    queryKey: queryKeys.presence(),
    queryFn: () => apiGet<{ online: OnlineMember[]; count: number }>("/api/v1/presence"),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: false,
  });
  const online = q.data?.online ?? [];
  const others = online.filter((member) => member.memberId !== actor.memberId);
  if (online.length === 0 || (!countOnly && others.length === 0)) return null;
  return (
    <div className="presence-avatars" role="group" aria-label={t("presence.online", { n: String(online.length) })}>
      {!countOnly && others.slice(0, 3).map((m) => (
        <span key={m.memberId} className="presence-avatar" title={`${m.name} @${m.username}`} aria-label={`${m.name} @${m.username}`}>
          {firstGrapheme(m.name, m.username)}
        </span>
      ))}
      {!countOnly && others.length > 3 && <span className="presence-more">+{others.length - 3}</span>}
      <span className="presence-count">{t("presence.online", { n: String(online.length) })}</span>
    </div>
  );
}
