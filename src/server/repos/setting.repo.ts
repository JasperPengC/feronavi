/** 设置仓储 —— 唯一碰 setting / setup_state 的地方 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { setting, setupState } from "../../db/schema.ts";

export async function get<T = unknown>(key: string): Promise<T | null> {
  const rows = await db.select().from(setting).where(eq(setting.key, key)).limit(1);
  return (rows[0]?.value as T) ?? null;
}

/** 写设置。`isSecret=true` 的值**不得在任何查询接口回显**（第 5.10 节） */
export async function set(key: string, value: unknown, isSecret = false): Promise<void> {
  await db.insert(setting)
    .values({ key, value: value as object, isSecret, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: setting.key,
      set: { value: value as object, isSecret, updatedAt: new Date() },
    });
}

/** 列出非敏感设置（敏感键一律过滤掉，不返回占位符也不返回掩码） */
export async function listPublic(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(setting).where(eq(setting.isSecret, false));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** 是否已完成初始化（`setup_state` 恰好一行） */
export async function getSetupState() {
  const rows = await db.select().from(setupState).limit(1);
  return rows[0] ?? null;
}

export async function markInitialized(step: number | null = null) {
  const existing = await getSetupState();
  if (existing) {
    const rows = await db.update(setupState)
      .set({ initializedAt: new Date(), currentStep: step })
      .where(eq(setupState.id, existing.id))
      .returning();
    return rows[0]!;
  }
  const rows = await db.insert(setupState)
    .values({ initializedAt: new Date(), currentStep: step })
    .returning();
  return rows[0]!;
}

export async function setCurrentStep(step: number) {
  const existing = await getSetupState();
  if (existing) {
    await db.update(setupState).set({ currentStep: step }).where(eq(setupState.id, existing.id));
  } else {
    await db.insert(setupState).values({ currentStep: step });
  }
}
