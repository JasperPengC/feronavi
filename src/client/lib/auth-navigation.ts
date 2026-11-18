/** 只允许返回应用内页面，避免外部跳转、认证循环与 API 地址。 */
export function normalizeAuthReturnTo(value: unknown): string {
  const fallback = "/projects";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const target = new URL(value, window.location.origin);
    const decodedPath = decodeURIComponent(target.pathname);
    if (target.origin !== window.location.origin || /[\\\u0000-\u001f\u007f]/.test(decodedPath)) return fallback;
    if (!/^\/(?:projects|workbench|issues|members|settings|admin|system|tokens|portfolios|announcements|notifications|changelog)(?:\/|$)/.test(decodedPath)) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return fallback; }
}

export function authNavigationSearch(search: Record<string, unknown>): {
  returnTo?: string; passwordChanged?: boolean; sso_error?: string;
} {
  return {
    returnTo: typeof search.returnTo === "string" ? normalizeAuthReturnTo(search.returnTo) : undefined,
    passwordChanged: search.passwordChanged === true || search.passwordChanged === "true" ? true : undefined,
    sso_error: search.sso_error === "1" || search.sso_error === 1 ? "1" : undefined,
  };
}

export const SSO_RETURN_KEY = "feronavi.auth.sso-return";
/** 企业登录要离开应用；目标只保留在当前标签页，且十分钟后过期。 */
export function readSsoReturnTo(consume = false): string | undefined {
  try {
    const raw = sessionStorage.getItem(SSO_RETURN_KEY);
    if (!raw) return;
    const value = JSON.parse(raw) as { returnTo?: unknown; startedAt?: unknown };
    const valid = typeof value.startedAt === "number" && Date.now() - value.startedAt >= 0 && Date.now() - value.startedAt < 10 * 60_000;
    if (consume || !valid) sessionStorage.removeItem(SSO_RETURN_KEY);
    return valid ? normalizeAuthReturnTo(value.returnTo) : undefined;
  } catch {
    try { sessionStorage.removeItem(SSO_RETURN_KEY); } catch { /* 浏览器可能禁用存储。 */ }
    return;
  }
}
