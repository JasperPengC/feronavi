/** API 令牌的前端封装（第六期） */
import { apiGet, apiPost, apiDelete } from "./api.ts";

export interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  tier: "READ_ONLY" | "READ_WRITE" | "ADMIN";
  projectWhitelist: string[];
  allowedIpCidrs: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const tokens = {
  list: () => apiGet<TokenRow[]>("/api/v1/tokens"),
  /** ⚠️ 明文只在这个响应里出现一次，页面必须提示用户立刻保存 */
  create: (body: { name: string; tier: string; projectWhitelist?: string[]; expiresAt?: string | null }) =>
    apiPost<{ token: string; row: TokenRow }>("/api/v1/tokens", body),
  revoke: (id: string) => apiDelete(`/api/v1/tokens/${id}`),
};
