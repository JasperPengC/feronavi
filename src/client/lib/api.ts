/**
 * JSON / multipart API 客户端；二进制下载可直接使用 fetch。
 *
 * 两条约定：
 *   1 写请求自动带上 `X-CSRF-Token`（从 `csrf_token` Cookie 读，双提交模式）
 *   2 错误一律按后端的 `{ code, message, details }` 抛 `ApiError`，
 *     **不要在前端自己拼错误文案** —— 后端给什么就展示什么
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown | null;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown | null;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  /** `details.requiredFields`（迁移必填字段）——供看板拖拽弹窗用 */
  get requiredFields(): string[] {
    const d = this.details as { requiredFields?: string[] } | null;
    return d?.requiredFields ?? [];
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** 服务重启后旧 CSRF token 会失效；换新 token 后重试一次。 */
async function refreshCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(new URL("/api/v1/auth/csrf", window.location.origin), {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { csrfToken?: string };
    return data.csrfToken ?? null;
  } catch {
    return null;
  }
}

function isCsrfError(status: number, body: unknown): boolean {
  if (status !== 403) return false;
  const b = body as Partial<ApiErrorBody> | null;
  return typeof b?.message === "string" && /csrf/i.test(b.message);
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const sessionExpiredListeners = new Set<() => void>();
let sessionGeneration = 0;
let sessionCheck: { generation: number; promise: Promise<boolean> } | undefined;
const SESSION_WRITES = new Set(["/api/v1/auth/login", "/api/v1/auth/ldap/login", "/api/v1/auth/logout", "/api/v1/auth/logout-all", "/api/v1/auth/password/change"]);

/** 应用壳统一结束失效会话；API 层继续保留原始错误供调用方处理。 */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => { sessionExpiredListeners.delete(listener); };
}

async function checkSessionFailure(url: URL, status: number, generation: number): Promise<void> {
  if (generation !== sessionGeneration || !sessionExpiredListeners.size || (status !== 401 && status !== 403)) return;
  let expired = url.pathname === "/api/v1/auth/me";
  if (!expired) {
    // 未登录、权限不足与凭据错误可能共用状态码；复核身份，避免误退出有效会话。
    if (!sessionCheck || sessionCheck.generation !== generation) {
      const check = { generation, promise: fetch(new URL("/api/v1/auth/me", window.location.origin), {
        credentials: "same-origin", headers: { accept: "application/json" },
      }).then((response) => response.status === 401 || response.status === 403).catch(() => false) };
      sessionCheck = check;
      void check.promise.finally(() => { if (sessionCheck === check) sessionCheck = undefined; });
    }
    expired = await sessionCheck.promise;
  }
  if (expired && generation === sessionGeneration) {
    sessionGeneration += 1;
    sessionExpiredListeners.forEach((listener) => listener());
  }
}

/** JSON 和 multipart 共用同一次数限制、CSRF 恢复与错误转换。 */
async function request<T>(url: URL, init: RequestInit, failureLabel = "请求失败", raw = false): Promise<T> {
  const generation = sessionGeneration;
  const changesSession = init.method === "POST" && SESSION_WRITES.has(url.pathname);
  const assertCurrentSession = () => {
    if (!changesSession && generation !== sessionGeneration) throw new DOMException("会话已结束", "AbortError");
  };
  const headers = new Headers(init.headers);
  const write = WRITE_METHODS.has(init.method ?? "GET");
  const token = write ? readCookie("csrf_token") : null;
  if (token) headers.set("x-csrf-token", token);

  for (let attempt = 0; ; attempt += 1) {
    assertCurrentSession();
    const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
    if (response.ok) {
      assertCurrentSession();
      if (changesSession) sessionGeneration += 1;
    }
    if (raw && response.ok) return response as T;
    if (response.status === 204) return undefined as T;
    let payload: unknown;
    try { payload = await response.json(); } catch { /* 空响应或反向代理的非 JSON 响应 */ }
    if (attempt === 0 && write && isCsrfError(response.status, payload)) {
      const fresh = await refreshCsrfToken();
      if (fresh) {
        headers.set("x-csrf-token", fresh);
        continue;
      }
    }
    if (!response.ok) {
      await checkSessionFailure(url, response.status, generation);
      const body = (payload && typeof payload === "object" ? payload : {}) as Partial<ApiErrorBody>;
      throw new ApiError(response.status, {
        code: body.code ?? "INTERNAL",
        message: body.message ?? `${failureLabel}（HTTP ${response.status}）`,
        details: body.details ?? null,
      });
    }
    // Mutation 清缓存后仍会执行 onSuccess；不把旧账号响应交给这些回调。
    assertCurrentSession();
    return payload as T;
  }
}

/** 流式响应与 JSON 请求共享认证、CSRF 更新和错误转换。 */
export function apiStreamPost(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return request<Response>(new URL(path, window.location.origin), {
    method: "POST", headers: { accept: "text/event-stream", "content-type": "application/json" },
    body: JSON.stringify(body), signal,
  }, "请求失败", true);
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, unknown>; signal?: AbortSignal } = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const url = new URL(path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = { method, headers, credentials: "same-origin", signal: opts.signal };

  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  return request<T>(url, init);
}

export const apiGet = <T>(path: string, query?: Record<string, unknown>) => api<T>(path, { query });
export const apiPost = <T>(path: string, body?: unknown, signal?: AbortSignal) => api<T>(path, { method: "POST", body, signal });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
/**
 * DELETE。**可带请求体** —— 有些接口用 DELETE 表达"关闭某个能力"且需要复验凭据
 * （例如关闭双因素要带当前密码）。最初签名不支持 body，是真实缺口。
 */
export const apiDelete = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "DELETE", body });

/** multipart 上传：与 JSON 请求同源的 CSRF/错误处理，但 body 必须是 FormData。 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return request<T>(new URL(path, window.location.origin), {
    method: "POST", headers: { accept: "application/json" }, body: form,
  }, "上传失败");
}
