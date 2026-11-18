/**
 * 统一错误契约（REST 第 0 节 / 第 13 节；与 MCP 完全一致）
 *
 * 稳定错误码——**这些字符串是对外契约的一部分，不许改**：
 *   VALIDATION FORBIDDEN NOT_FOUND CONFLICT VERSION_CONFLICT
 *   BLOCKED_BY_PREREQUISITE RATE_LIMITED INTERNAL
 *
 * HTTP 状态码映射：
 *   400 VALIDATION · 401 未登录 · 403 FORBIDDEN/NOT_FOUND
 *   404 **仅用于路由不存在** · 409 CONFLICT/VERSION_CONFLICT
 *   422 BLOCKED_BY_PREREQUISITE · 429 RATE_LIMITED · 500 INTERNAL
 */

export const ERROR_CODES = [
  "VALIDATION", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
  "VERSION_CONFLICT", "BLOCKED_BY_PREREQUISITE", "COMMAND_CONFIRMATION_REQUIRED", "RATE_LIMITED", "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details: unknown | null;
}

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 403,          // ⚠️ 刻意不是 404：资源不可见与不存在必须无法区分
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  BLOCKED_BY_PREREQUISITE: 422,
  COMMAND_CONFIRMATION_REQUIRED: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** 领域错误：抛它，由统一错误处理器转成响应 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown | null;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, details: unknown | null = null) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
    this.httpStatus = STATUS[code];
  }
}

/**
 * 越权/不可见的统一入口。
 *
 * ⚠️ 刻意不区分「无权访问」与「资源不存在」——两者返回**完全相同**的响应体，
 * 否则调用方可以通过错误码或文案差异探测资源是否存在（枚举攻击）。
 */
export function forbidden(): DomainError {
  return new DomainError("FORBIDDEN", "无权访问该资源", null);
}

export const notFoundRoute = (): DomainError =>
  new DomainError("INTERNAL", "路由不存在", null);

export const unauthorized = (): DomainError =>
  new DomainError("FORBIDDEN", "未登录或会话已失效", null);
