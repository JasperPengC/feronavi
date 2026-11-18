/**
 * 种子数据 CLI（第 2 步）
 *
 * 数据来源：`docs/数据模型-完整定义.md` 第 14 节（权限 47 / 角色 4 / 工作流 3 套 22 状态 / 项目状态 5）。
 * 实际写入逻辑在 `seed-builtin.ts`（安装向导也会调用它做「缺失自愈」，因此必须幂等）。
 *
 * 用法：`npm run db:seed`（需要 DATABASE_URL）
 * 判据：permission 47 / 内置角色 4 / 平台工作流状态 22 三个计数必须精确相等，否则退出码 1。
 */
import { sql as raw } from "./index.ts";
import { seedBuiltin } from "./seed-builtin.ts";

async function main() {
  await seedBuiltin();

  // ── 判据：三个计数必须精确相等 ──
  const rows = await raw<{ permission: number; role_system: number; workflow_state: number;
                           role_permission: number; workflow_transition: number }[]>`
    select
      (select count(*)::int from permission)            as permission,
      (select count(*)::int from role where is_system)  as role_system,
      -- ⚠️ 只数**平台模板**的状态：项目副本是建项目时复制的，数量随项目数增长，
      --    把它算进来会让判据随测试残留数据漂移（实测踩到：374 ≠ 22）。
      (select count(*)::int from workflow_state s join workflow w on w.id = s.workflow_id
        where w.project_id is null)                    as workflow_state,
      (select count(*)::int from role_permission)       as role_permission,
      (select count(*)::int from workflow_transition)   as workflow_transition
  `;
  const c = rows[0];
  if (!c) throw new Error("计数查询没有返回行");
  console.log("计数:", JSON.stringify(c));
  const expect = [
    ["permission", 47],
    ["role_system", 4],
    ["workflow_state", 22],
  ] as const;
  let bad = false;
  for (const [k, v] of expect) {
    const got = c[k];
    const ok = got === v;
    if (!ok) bad = true;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${k}: ${got} (期望 ${v})`);
  }
  await raw.end();
  if (bad) process.exit(1);
  console.log("种子数据完成,判据通过。");
}

main().catch((e) => { console.error(e); process.exit(1); });
