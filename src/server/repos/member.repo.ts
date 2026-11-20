/**
 * 成员仓储 —— **唯一碰 member 表的地方**
 *
 * 分层的价值在这里最直观：路由与领域服务都不写 SQL，
 * 换查询、加索引、改软删策略时只动这一个文件。
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { member } from "../../db/schema.ts";

export interface MemberAuthRow {
  id: string;
  passwordHash: string;
  status: string;
}

/** 按用户名取认证所需的最小字段（登录路径专用，不返回多余数据） */
export async function findByUsernameForAuth(username: string): Promise<MemberAuthRow | null> {
  const rows = await db
    .select({ id: member.id, passwordHash: member.passwordHash, status: member.status })
    .from(member)
    .where(eq(member.username, username.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string) {
  const rows = await db.select().from(member).where(eq(member.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 重新验证只读取当前密码哈希，不加载成员资料。 */
export async function findByIdForReauth(id: string): Promise<Pick<MemberAuthRow, "id" | "passwordHash"> | null> {
  const rows = await db
    .select({ id: member.id, passwordHash: member.passwordHash })
    .from(member)
    .where(eq(member.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function usernameExists(username: string): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.username, username.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}
