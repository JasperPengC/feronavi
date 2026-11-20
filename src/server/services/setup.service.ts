/**
 * 安装向导服务（第 6.1 节六步状态机）
 *
 * 目标体验：装好 Docker → 打开浏览器 → 填 3 个表单 → 开始用。
 * **必答只有三项**：管理员账号 / 组织名称 / 语言。其余全部可跳过。
 */
import { access, constants } from "node:fs/promises";
import { db } from "../../db/index.ts";
import { builtinSeedPresent, seedBuiltin } from "../../db/seed-builtin.ts";
import { organization, member, role, roleAssignment, setting, setupState, department, position } from "../../db/schema.ts";
import { orgTemplate } from "./org-structure.service.ts";
import { and, eq } from "drizzle-orm";
import { DomainError } from "../../shared/errors.ts";
import { hashPassword, validatePasswordStrength } from "../auth/password.ts";
import type { SetupCompleteInput } from "../../shared/schemas/setup.ts";
import * as settingRepo from "../repos/setting.repo.ts";
import { pgSqlProbe } from "../repos/health.repo.ts";
import { assertNotRestoring, withSystemRestoreLock } from "./system-backup/restore-lock.ts";

export { assertBusinessEmpty } from "./system-backup/validator.ts";

export interface PrecheckItem {
  key: string;
  ok: boolean;
  message: string;
  path?: string;
}

/** 第 1 步：环境自检。**任一项失败都不抛错** —— 界面要展示可读原因 */
export async function precheck(): Promise<{ items: PrecheckItem[]; ok: boolean }> {
  const items: PrecheckItem[] = [];

  // 数据库连通
  try {
    await pgSqlProbe();
    items.push({ key: "database", ok: true, message: "数据库连通" });
  } catch (e) {
    items.push({ key: "database", ok: false, message: `数据库不可连通：${(e as Error).message}` });
  }

  // 数据目录可写
  const dataDir = process.env.DATA_DIR ?? "/data";
  try {
    await access(dataDir, constants.W_OK);
    items.push({ key: "dataDir", ok: true, message: `数据目录可写（${dataDir}）`, path: dataDir });
  } catch {
    items.push({ key: "dataDir", ok: false, message: `数据目录不可写：${dataDir}`, path: dataDir });
  }

  // 时区：必须是 IANA 标识（禁止容器时区，第 6.1 节）
  const tz = process.env.TZ ?? "Asia/Shanghai";
  const tzOk = /^[A-Za-z]+\/[A-Za-z_+\-0-9]+$/.test(tz);
  items.push({
    key: "timezone", ok: tzOk,
    message: tzOk ? `时区 ${tz}` : `时区不是 IANA 标识：${tz}`,
  });

  // 版本
  items.push({ key: "version", ok: true, message: process.env.FERONAVI_VERSION ?? "dev" });

  return { items, ok: items.every((i) => i.ok) };
}

/**
 * 实例状态。
 *
 * ⚠️ **"是否已初始化"是数据事实，不是只看一个标志位**（实测踩到的死锁）：
 * 若 `setup_state.initializedAt` 为空、但库里**已经有管理员与组织**，
 * 只看标志位会得到"未初始化" → 所有接口返回 FORBIDDEN；而重新走向导又会因
 * "用户名已被占用"失败 → **实例彻底卡死，界面上无路可走**。
 * 因此这里做**双重判定**：标志位为真，或数据事实成立（存在有效管理员），都算已初始化。
 */
export async function getState() {
  const st = await settingRepo.getSetupState();
  if (st?.initializedAt != null) return { initialized: true, currentStep: st.currentStep ?? null };

  /**
   * 数据事实判据：**存在在职成员、且该成员持有 ORG 级 ADMIN 角色**。
   * 不用 `member.is_initial_admin` —— 实测它会因外部脚本/清理而丢失，
   * 而角色指派才是"这个人现在真的能管这个实例"的事实。
   */
  const hasAdmin = await db
    .select({ id: roleAssignment.id })
    .from(roleAssignment)
    .innerJoin(member, eq(member.id, roleAssignment.memberId))
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(and(
      eq(member.status, "ACTIVE"),
      eq(roleAssignment.scopeType, "ORG"),
      eq(role.key, "ADMIN"),
    ))
    .limit(1);
  if (hasAdmin[0]) {
    // 自愈：把缺失的标志位补上，避免后续每次请求都要重算
    await db.insert(setupState).values({ initializedAt: new Date(), currentStep: 6 }).onConflictDoNothing();
    return { initialized: true, currentStep: 6 };
  }
  return { initialized: false, currentStep: st?.currentStep ?? null };
}

/**
 * 第 6 步：完成向导。
 *
 * ⚠️ **必须单事务**：organization → member → role_assignment → setting → setup_state。
 *    任一步失败整体回滚 —— **绝不允许留下「组织建了但管理员没建」的半初始化状态**，
 *    那会让实例既无法登录、也无法重跑向导（`setup_state` 已落标记）。
 */
export async function complete(input: SetupCompleteInput): Promise<void> {
  return withSystemRestoreLock(async () => {
    await assertNotRestoring();
    await completeUnderRestoreLock(input);
  });
}

async function completeUnderRestoreLock(input: SetupCompleteInput): Promise<void> {
  const state = await getState();
  if (state.initialized) {
    throw new DomainError("FORBIDDEN", "本实例已完成初始化", null);
  }

  // 密码强度（第 5.9 节）
  const strength = validatePasswordStrength(input.admin.password);
  if (!strength.ok) throw new DomainError("VALIDATION", strength.reason, null);

  // 用户名查重（唯一索引也会拦，但这里给出可读文案）
  const dup = await db.select({ id: member.id }).from(member)
    .where(eq(member.username, input.admin.username.toLowerCase())).limit(1);
  if (dup.length > 0) throw new DomainError("CONFLICT", `用户名 ${input.admin.username} 已被占用`, null);

  // 全新库可能「只迁移、未种子」：安装向导自检并**幂等补齐**内置角色/权限/工作流/项目状态，
  // 否则下面的 ADMIN 角色查询会失败、整笔初始化回滚（真实反馈：种子数据缺失 ADMIN 角色）。
  if (!(await builtinSeedPresent())) {
    console.info("[setup] 内置种子数据缺失，安装向导自动补齐");
    await seedBuiltin();
  }

  const passwordHash = await hashPassword(input.admin.password);

  await db.transaction(async (tx) => {
    // ① 组织（**恰好一行**）
    const existingOrg = await tx.select({ id: organization.id }).from(organization).limit(1);
    if (existingOrg.length === 0) {
      await tx.insert(organization).values({
        name: input.org.name,
        defaultLocale: input.org.defaultLocale,
        defaultTimezone: input.org.defaultTimezone,
      });
    } else {
      await tx.update(organization).set({
        name: input.org.name,
        defaultLocale: input.org.defaultLocale,
        defaultTimezone: input.org.defaultTimezone,
        updatedAt: new Date(),
      }).where(eq(organization.id, existingOrg[0]!.id));
    }

    // ② 可选组织模板：公司 / OPC 决定部门与岗位；只在完全为空时写入，不覆盖已有结构
    if (input.org.seedDepartments !== false) {
      const existingDept = await tx.select({ id: department.id }).from(department).limit(1);
      if (existingDept.length === 0) {
        const template = orgTemplate(input.org.kind, input.org.defaultLocale);
        const deptIds = new Map<string, string>();
        for (const d of template.departments) {
          const [parent] = await tx.insert(department).values({ name: d.name, parentId: null, sortOrder: deptIds.size * 10 }).returning({ id: department.id });
          if (parent) deptIds.set(d.name, parent.id);
          for (const [ci, child] of (d.children ?? []).entries()) {
            const [row] = await tx.insert(department).values({ name: child.name, parentId: parent?.id ?? null, sortOrder: ci * 10 }).returning({ id: department.id });
            if (row) deptIds.set(child.name, row.id);
          }
        }
        for (const p of template.positions) {
          await tx.insert(position).values({ name: p.name, departmentId: p.dept ? deptIds.get(p.dept) ?? null : null });
        }
      }
    }

    // ③ 初始管理员（`is_initial_admin` 供首次登录强制改密）
    const [admin] = await tx.insert(member).values({
      username: input.admin.username.toLowerCase(),
      email: input.admin.email.toLowerCase(),
      name: input.admin.name,
      status: "ACTIVE",
      passwordHash,
      locale: input.org.defaultLocale,
      timezone: input.org.defaultTimezone,
      isInitialAdmin: true,
    }).returning({ id: member.id });

    // ③ ADMIN 角色授到组织级（种子数据里已有 ADMIN 角色）
    const [adminRole] = await tx.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN")).limit(1);
    if (!adminRole) throw new DomainError("INTERNAL", "种子数据缺失 ADMIN 角色，请先执行迁移与种子", null);
    await tx.insert(roleAssignment).values({
      memberId: admin!.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null,
    });

    // ④ 设置：语言、时区、向导产物。集成配置全部允许为空
    const settings: [string, unknown, boolean][] = [
      ["org.defaultLocale", input.org.defaultLocale, false],
      ["org.defaultTimezone", input.org.defaultTimezone, false],
      ["org.kind", input.org.kind, false],
      ["setup.completedAt", new Date().toISOString(), false],
    ];
    const smtp = input.integrations?.smtp;
    if (smtp?.host) {
      settings.push(["smtp.host", smtp.host, false]);
      settings.push(["smtp.port", smtp.port ?? 587, false]);
      settings.push(["smtp.user", smtp.user ?? null, false]);
      settings.push(["smtp.from", smtp.from ?? null, false]);
      // 口令是敏感键：`is_secret=true`，查询接口一律不回显
      if (smtp.password) settings.push(["smtp.password", smtp.password, true]);
    }
    const storage = input.integrations?.storage;
    settings.push(["storage.kind", storage?.kind ?? "local", false]);
    if (storage?.kind === "s3") {
      settings.push(["storage.s3.endpoint", storage.endpoint ?? null, false]);
      settings.push(["storage.s3.region", storage.region ?? "us-east-1", false]);
      settings.push(["storage.s3.bucket", storage.bucket ?? null, false]);
      settings.push(["storage.s3.accessKey", storage.accessKey ?? null, true]);
      settings.push(["storage.s3.secretKey", storage.secretKey ?? null, true]);
      settings.push(["storage.s3.forcePathStyle", storage.forcePathStyle ?? true, false]);
      settings.push(["storage.s3.prefix", storage.prefix ?? null, false]);
    }

    for (const [k, v, secret] of settings) {
      await tx.insert(setting).values({ key: k, value: v as object, isSecret: secret, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: setting.key,
          set: { value: v as object, isSecret: secret, updatedAt: new Date() },
        });
    }

    // ⑤ 落标记（**最后一步**：标记落上就代表前面全部成功）
    await tx.insert(setupState).values({ initializedAt: new Date(), currentStep: 6 });
  });
}

