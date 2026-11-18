import "./_env.ts";
/**
 * 测试共享辅助
 *
 * 为什么需要它：R7 引入「未初始化拦截钩子」后，各测试脚本对**实例状态**产生了依赖 ——
 * 向导测试结束时会把实例重置为未初始化，之后任何走 HTTP 的测试都会被钩子挡成 403。
 * 让每个测试自己保证前置状态，测试就与执行顺序无关。
 */
import { db } from "../src/db/index.ts";
import { auditEntry, member, organization, setupState } from "../src/db/schema.ts";
import { eq, or } from "drizzle-orm";

/**
 * 保证实例处于「已初始化」状态（幂等）。
 * 只补最小必要数据：`setup_state` 一行 + `organization` 一行。
 * 不建管理员 —— 各测试自己建自己需要的账号。
 */
export async function ensureInitialized(): Promise<void> {
  const st = await db.select().from(setupState).limit(1);
  if (st.length === 0) {
    await db.insert(setupState).values({ initializedAt: new Date(), currentStep: 6 });
  } else if (st[0]!.initializedAt == null) {
    await db.update(setupState).set({ initializedAt: new Date() }).where(eq(setupState.id, st[0]!.id));
  }

  const org = await db.select({ id: organization.id }).from(organization).limit(1);
  if (org.length === 0) {
    await db.insert(organization).values({
      name: "测试组织", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai",
    });
  }
}

/**
 * 删除测试成员（先清掉其审计行）。
 *
 * 为什么需要：Round 25 起登录/登出等安全事件会写 `audit_entry`，而 `audit_entry.actor_id`
 * 是 **RESTRICT**（有审计的成员不可物理删除 —— 合规设计 e2e-audit 有断言）。
 * 测试脚本清理数据时必须先删审计，否则会撞 FK。
 */
export async function deleteTestMember(username: string): Promise<void> {
  const rows = await db.select({ id: member.id }).from(member).where(eq(member.username, username));
  for (const r of rows) {
    await db.delete(auditEntry).where(or(eq(auditEntry.actorId, r.id), eq(auditEntry.actorSnapshot, username))!);
  }
  await db.delete(member).where(eq(member.username, username));
}
