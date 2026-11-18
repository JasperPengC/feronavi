/**
 * 内置种子数据（**幂等**）—— 权限 / 角色 / 角色权限 / 平台工作流 / 项目状态
 *
 * 为什么单独抽出来：种子原先只能通过 `npm run db:seed` 手动执行，于是「只迁移、没种子」的新库
 * 在安装向导第 6 步会撞上「种子数据缺失 ADMIN 角色」并整体回滚（真实反馈）。现在：
 *   · `src/db/seed.ts`（CLI）调用它并做三个计数判据；
 *   · 安装向导在提交前自检，发现内置数据缺失就**幂等补齐**，全新库可以直接装完。
 *
 * 三条硬规则（数据模型 14.5）：全部 ON CONFLICT DO NOTHING、外键顺序不可颠倒、本文件只建角色不建人
 * （ADMIN 由安装向导赋给首个管理员）。
 */
import { readFileSync } from "node:fs";
import { isNull, sql } from "drizzle-orm";
import { db } from "./index.ts";
import {
  permission, role, rolePermission,
  workflow, workflowState, workflowTransition, projectStatusDef,
} from "./schema.ts";

type SeedData = {
  permissions: { key: string; group: string; description: string; sortOrder: number }[];
  roles: { key: string; perms: string[] }[];
  workflows: {
    key: string; name: string; appliesToType: string;
    states: [string, string, string, string][];   // key, name, category, color
    transitions: [string, string[]][];
  }[];
  projectStatuses: [string, string, string, string, number][];  // key, name, category, color, order
};

const data: SeedData = JSON.parse(readFileSync(new URL("./seed-data.json", import.meta.url), "utf8"));

const ROLE_NAMES: Record<string, string> = {
  ADMIN: "管理员", PM: "项目经理", MEMBER: "成员", GUEST: "只读访客",
};

/** 内置数据是否齐全（角色 ≥4 且平台工作流 ≥3）—— 向导据此决定是否需要补齐 */
export async function builtinSeedPresent(): Promise<boolean> {
  const rows = await db.select({ id: role.id }).from(role);
  const wfs = await db.select({ id: workflow.id }).from(workflow).where(isNull(workflow.projectId));
  return rows.length >= data.roles.length && wfs.length >= data.workflows.length;
}

/** 幂等写入全部内置种子数据（可重复执行） */
export async function seedBuiltin(): Promise<void> {
  // ① permission（主键就是 key）
  // ⚠️ 用 onConflictDoUpdate 而不是 DoNothing：目录描述会随版本演进（如 2026-11-01 给未接线键标注现状），
  //    存量库必须能在升级重跑种子时收敛到最新描述，否则角色配置者看到的是过时说明。
  await db.insert(permission)
    .values(data.permissions.map((p) => ({ key: p.key, group: p.group, description: p.description })))
    .onConflictDoUpdate({
      target: permission.key,
      set: { group: sql`excluded."group"`, description: sql`excluded.description` },
    });

  // ② role
  await db.insert(role)
    .values(data.roles.map((r) => ({
      key: r.key, name: ROLE_NAMES[r.key] ?? r.key, isBuiltin: true, isSystem: true,
    })))
    .onConflictDoNothing();

  // ③ role_permission
  const roleRows = await db.select({ id: role.id, key: role.key }).from(role);
  const roleId = new Map(roleRows.map((r) => [r.key, r.id]));
  const rp: { roleId: string; permissionKey: string }[] = [];
  for (const r of data.roles) {
    for (const k of r.perms) {
      const rid = roleId.get(r.key);
      if (!rid) throw new Error(`角色缺 id: ${r.key}`);
      rp.push({ roleId: rid, permissionKey: k });
    }
  }
  await db.insert(rolePermission).values(rp).onConflictDoNothing();

  // ④ workflow（平台级模板：project_id IS NULL + is_default + is_builtin）
  await db.insert(workflow)
    .values(data.workflows.map((wf) => ({
      projectId: null, name: wf.name, appliesToType: wf.appliesToType,
      isDefault: true, isBuiltin: true,
    })))
    .onConflictDoNothing();

  const wfRows = await db.select({ id: workflow.id, appliesToType: workflow.appliesToType })
    .from(workflow).where(isNull(workflow.projectId));
  const wfId = new Map(wfRows.map((r) => [r.appliesToType, r.id]));

  for (const wf of data.workflows) {
    const id = wfId.get(wf.appliesToType);
    if (!id) throw new Error(`工作流缺 id: ${wf.appliesToType}`);
    await db.insert(workflowState)
      .values(wf.states.map(([key, name, category, color], i) => ({
        workflowId: id, key, name, category, color, sortOrder: i + 1,
      })))
      .onConflictDoNothing();
  }

  const stateRows = await db.select({
    id: workflowState.id, workflowId: workflowState.workflowId, key: workflowState.key,
  }).from(workflowState);
  const stateId = new Map(stateRows.map((r) => [`${r.workflowId}:${r.key}`, r.id]));

  const edges: { workflowId: string; fromStateId: string; toStateId: string }[] = [];
  for (const wf of data.workflows) {
    const id = wfId.get(wf.appliesToType)!;
    for (const [from, tos] of wf.transitions) {
      for (const to of tos) {
        const f = stateId.get(`${id}:${from}`), t = stateId.get(`${id}:${to}`);
        if (!f || !t) throw new Error(`迁移边缺状态: ${wf.appliesToType} ${from} → ${to}`);
        edges.push({ workflowId: id, fromStateId: f, toStateId: t });
      }
    }
  }
  await db.insert(workflowTransition).values(edges).onConflictDoNothing();

  // ⑤ 项目状态定义
  await db.insert(projectStatusDef)
    .values(data.projectStatuses.map(([key, name, category, color, sortOrder]) => ({
      key, name, category, color, sortOrder,
    })))
    .onConflictDoNothing();
}
