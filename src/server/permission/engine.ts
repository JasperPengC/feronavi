/**
 * 权限引擎 —— 判定与数据范围过滤的**唯一入口**（第 5.2 节纪律）
 *
 * 两条纪律：
 *   1 判定必须在领域服务层统一入口，禁止散落在路由与 UI
 *   2 「资源不可见」与「资源不存在」必须返回同一种错误
 *
 * 数据范围不是四个平行的 scopeType，而是「三档 scopeType」+「`_own` 权限后缀」：
 *   全组织      → scopeType = ORG
 *   团队(含子团队) → loader 按角色递归展开为 TEAM 授权
 *   参与的项目     → scopeType = PROJECT；成员可见性与角色写权限分别判定
 *   仅自己创建    → 不靠 scopeType，靠动作名后缀 `_own`
 *
 * 判定是**纯函数**：树与成员关系由调用方查好传入，便于单测覆盖全部组合。
 */
import type { Actor, ScopeGrant, ScopeType } from "./actor.ts";

/** 资源所属的位置信息——判定数据范围需要它 */
export interface ResourceScope {
  /** 资源属于哪个项目（工作项/文档/迭代等都有）。组织级资源传 null */
  projectId: string | null;
  /** 资源所在团队（可空；团队级资源才有） */
  teamId?: string | null;
  /** 资源创建者（`_own` 后缀动作用它） */
  createdBy?: string | null;
}

export interface PermissionContext {
  /** 成员参与的项目 id 集合（ProjectMembership）。用于 PROJECT 档回落判定 */
  memberProjectIds: ReadonlySet<string>;
  /**
   * 成员所属团队及其**全部子团队** id 集合。
   * ⚠️ 递归展开 `Team.parentId` 由仓储层一次查询完成（第 1.2 节），此处只读结果。
   */
  memberTeamIds: ReadonlySet<string>;
  /** 当前成员 id（判定 `_own`） */
  memberId: string;
}

/**
 * 是否持有某个动作的权限。
 *
 * ⚠️ **只认权限键，不认角色名** —— 权限是 `role_permission` 展开的结果，
 * 自定义角色因此天然可用，不需要为本引擎改一行代码。
 */
export function hasPermission(actor: Actor, action: string): boolean {
  return actor.permissions.has(action);
}

/**
 * 动作是否属于「仅自己创建」类（`_own` 后缀）。
 *
 * 规范里的例子：`work_item:update_own` / `comment:update_own` / `page:update_own`。
 * 注意 `_own` 与 `_any` 是**两个不同的权限键**：
 *   有 `_any` 的人通常也有 `_own`（见第 5.2 节矩阵），但反之不成立。
 */
export function isOwnScoped(action: string): boolean {
  return action.endsWith("_own");
}

/**
 * 数据范围是否覆盖该资源。
 *
 * 判定顺序（命中即返回，与行业标准一致：**范围给的是"能碰哪些"，权限给的是"能做什么"**）：
 *   1 ORG 档        → 全组织，直接通过
 *   2 TEAM 档       → 资源 teamId 命中该角色的显式或展开授权
 *   3 PROJECT 档    → 资源 projectId 命中该角色的显式或展开授权
 */
/** 某个授权对应的角色是否持有该动作权限（scoped RBAC 核心） */
function roleHasPermission(actor: Actor, roleKey: string, action: string): boolean {
  // 仅没有整张角色表的旧内部 Actor 使用兼容路径；角色缺项必须拒绝。
  if (!actor.rolePermissions) return actor.permissions.has(action);
  return actor.rolePermissions.get(roleKey)?.has(action) ?? false;
}

/** 单个授权是否覆盖资源（不再"任一授权覆盖就放行全部权限"） */
function scopeCoversGrant(
  g: ScopeGrant,
  res: ResourceScope,
): boolean {
  switch (g.scopeType) {
    case "ORG":
      return true;
    case "TEAM":
      return !!res.teamId && g.scopeId === res.teamId;
    case "PROJECT":
      return !!res.projectId && g.scopeId === res.projectId;
    case "DEPARTMENT":
      // DEPARTMENT 在 loader 已按角色展开为 synthetic PROJECT 授权；保留此分支仅作兼容
      return false;
  }
}

/** 工作流指定角色也必须覆盖目标资源，不能借用另一项目的同名角色。 */
export function roleKeysForScope(actor: Actor, res: ResourceScope): ReadonlySet<string> {
  return new Set(actor.grants.filter((grant) => scopeCoversGrant(grant, res)).map((grant) => grant.roleKey));
}

/** 是否**任一**授权覆盖资源（导出给旧测试/工具；can() 使用按授权的严格判定） */
export function scopeCovers(
  actor: Actor,
  res: ResourceScope,
  ctx: PermissionContext,
): boolean {
  for (const g of actor.grants) if (scopeCoversGrant(g, res)) return true;
  // 回落：无显式 PROJECT 指派时，「我是 ProjectMembership 成员」也算覆盖
  if (res.projectId && ctx.memberProjectIds.has(res.projectId)) return true;
  return false;
}

/**
 * 完整判定：**先看权限，再看范围，最后看 `_own`**。
 *
 * 顺序不可颠倒：
 *   - 先判权限：没有这个动作就谈不上范围
 *   - 再判范围：有权限但资源不在自己的范围里 → 拒绝
 *   - 最后判 `_own`：`update_own` 只作用于自己创建的资源
 *
 * 任何一步不通过都返回 `false`，由调用方统一转成 `FORBIDDEN`
 * ——**不得**把「无权限」「超范围」「不是自己创建的」区分给调用方。
 */
export function can(
  actor: Actor,
  action: string,
  res: ResourceScope,
  ctx: PermissionContext,
): boolean {
  /**
   * **按授权判权限（行业标准 scoped RBAC）**：
   * 只有「覆盖该资源的那个授权」对应的角色持有该动作时才算允许；
   * 不允许"我有 ORG 低权角色覆盖范围 + 某项目高权角色权限"的并集放大。
   */
  const own = isOwnScoped(action);
  const scopeLess = !res.projectId && !res.teamId;

  // 个人资源 + _own：范围由归属决定（见下方历史说明）
  if (scopeLess && own) {
    const anyRoleHas = actor.grants.some((g) => roleHasPermission(actor, g.roleKey, action))
      || hasPermission(actor, action);
    return anyRoleHas && res.createdBy === ctx.memberId;
  }

  for (const g of actor.grants) {
    if (!roleHasPermission(actor, g.roleKey, action)) continue;
    if (!scopeCoversGrant(g, res)) continue;
    if (own && res.createdBy !== ctx.memberId) continue;
    return true;
  }
  // 项目成员写权限由对应 PROJECT 角色指派提供；成员关系本身不携带其他角色权限。
  return false;
}

/**
 * 判定并抛错（领域服务层的标准用法）。
 * 返回 `true` 时可直接继续；否则抛 `FORBIDDEN`，与「资源不存在」同形。
 */
export function assertCan(
  actor: Actor,
  action: string,
  res: ResourceScope,
  ctx: PermissionContext,
): void {
  if (!can(actor, action, res, ctx)) {
    // 延迟引入以避免与 errors 模块循环依赖
    throw new PermissionError();
  }
}

/** 与 `forbidden()` 同形；单独定义便于本模块不依赖上层 */
export class PermissionError extends Error {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
  readonly details = null;
  constructor() {
    super("无权访问该资源");
    this.name = "PermissionError";
  }
}

/** 供测试与自检用：把一条指派归一化成可比较的字符串 */
export function grantKey(g: ScopeGrant): string {
  return `${g.roleKey}@${g.scopeType}:${g.scopeId ?? "-"}`;
}

export type { ScopeType };
