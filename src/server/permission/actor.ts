/**
 * Actor —— 一次请求的身份上下文（身份 + 权限集 + 数据范围）
 *
 * 由 `GET /auth/me` 原样返回给前端（前端只拿它做**界面隐藏**，不做判定）。
 * ⚠️ 判定永远在服务端做（第 5.2 节：UI 只做隐藏，不做判定）。
 */

/**
 * 数据范围：ORG / TEAM / PROJECT / DEPARTMENT。
 * 部门项目和子团队在 loader 中按来源角色展开为内部授权。
 */
export type ScopeType = "ORG" | "TEAM" | "PROJECT" | "DEPARTMENT";

/** 一条角色指派 */
export interface ScopeGrant {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string | null;   // ORG 时为 null
  /** 部门/团队闭包展开授权（服务端内部用；不进入 /auth/me 的 dataScopes） */
  synthetic?: boolean;
}

export interface Actor {
  memberId: string;
  username: string;
  name: string;
  /** 权限动作集合（如 `work_item:update_own`）。判定只看它，不看角色名 */
  permissions: ReadonlySet<string>;
  /** 角色指派（含数据范围），用于按范围过滤查询 */
  grants: readonly ScopeGrant[];
  /**
   * **按角色**解析后的权限集（行业标准 scoped RBAC）：`can()` 只认「覆盖该资源的某个授权」
   * 对应的角色是否持有该权限，**不再用所有角色权限的并集**做跨范围放大。
   * 生产环境由 actor-loader 必填；手写 Actor（测试）缺省时回退到 `permissions` 并集。
   */
  rolePermissions?: ReadonlyMap<string, ReadonlySet<string>>;
  /** 是否必须改密后才能做其它操作（初始管理员首次登录） */
  mustChangePassword: boolean;
  locale: string;
  timezone: string | null;
  /** 账号主题偏好（member_preference.theme）—— 客户端启动时据此应用，避免"设置里改了界面不变" */
  theme: string | null;
  density?: string | null;
}

/** Actor 的可序列化形态（`GET /auth/me` 的响应体） */
export interface ActorDTO {
  memberId: string;
  username: string;
  name: string;
  permissions: string[];
  dataScopes: { scopeType: ScopeType; scopeId: string | null }[];
  mustChangePassword: boolean;
  locale: string;
  timezone: string | null;
  theme: string | null;
  density: string;
}

export function toDTO(actor: Actor): ActorDTO {
  return {
    memberId: actor.memberId,
    username: actor.username,
    name: actor.name,
    // 排序保证同一个人每次拿到的顺序一致，便于前端缓存与测试断言
    permissions: [...actor.permissions].sort(),
    dataScopes: actor.grants.filter((g) => !g.synthetic).map((g) => ({ scopeType: g.scopeType, scopeId: g.scopeId })),
    mustChangePassword: actor.mustChangePassword,
    locale: actor.locale,
    timezone: actor.timezone,
    theme: actor.theme,
    density: actor.density ?? "comfortable",
  };
}
