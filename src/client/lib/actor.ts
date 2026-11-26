/**
 * Actor 上下文 —— 身份 + 权限集 + 数据范围
 *
 * ⚠️ 前端拿 Actor **只用于界面隐藏/禁用，不做判定**。
 *    判定永远在服务端（第 5.2 节纪律 1），UI 隐藏只是体验优化。
 */
import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "./api.ts";

export interface Actor {
  memberId: string;
  username: string;
  name: string;
  permissions: string[];
  dataScopes: { scopeType: "ORG" | "TEAM" | "PROJECT"; scopeId: string | null }[];
  mustChangePassword: boolean;
  locale: string;
  /** 账号主题偏好：外壳启动时应用（服务端 /auth/me 返回） */
  theme: string | null;
  density?: string | null;
  timezone: string | null;
}

export const ActorContext = createContext<Actor | null>(null);

export function useActor(): Actor {
  const a = useContext(ActorContext);
  if (!a) throw new Error("ActorContext 未注入：该组件必须在 _app 布局下使用");
  return a;
}

/** 界面隐藏用。**不要**用它替代服务端判定 */
export function useCan(perm: string): boolean {
  const a = useContext(ActorContext);
  return a?.permissions.includes(perm) ?? false;
}

/** 拉取当前身份。未登录时返回 null（而不是抛错），由路由自行决定跳登录 */
export function useActorQuery() {
  return useQuery<Actor | null>({
    queryKey: ["actor"],
    queryFn: async () => {
      try {
        return await apiGet<Actor>("/api/v1/auth/me");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 403 || e.status === 401)) return null;
        throw e;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}
