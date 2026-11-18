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

/** JSON 和 multipart 共用同一次数限制、CSRF 恢复与错误转换。 */
async function request<T>(url: URL, init: RequestInit, failureLabel = "请求失败"): Promise<T> {
  const headers = new Headers(init.headers);
  const write = WRITE_METHODS.has(init.method ?? "GET");
  const token = write ? readCookie("csrf_token") : null;
  if (token) headers.set("x-csrf-token", token);

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
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
      const body = (payload && typeof payload === "object" ? payload : {}) as Partial<ApiErrorBody>;
      throw new ApiError(response.status, {
        code: body.code ?? "INTERNAL",
        message: body.message ?? `${failureLabel}（HTTP ${response.status}）`,
        details: body.details ?? null,
      });
    }
    return payload as T;
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, unknown> } = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const url = new URL(path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = { method, headers, credentials: "same-origin" };

  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  return request<T>(url, init);
}

export const apiGet = <T>(path: string, query?: Record<string, unknown>) => api<T>(path, { query });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
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
