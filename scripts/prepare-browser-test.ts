import "./_env.ts";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { eq } from "drizzle-orm";
import { ensureInitialized } from "./_test-helpers.ts";

try {
  await ensureInitialized();
  const admin = (await db.select().from(role).where(eq(role.key, "ADMIN")))[0];
  if (!admin) throw new Error("隔离测试库缺少内置管理员角色");
  for (const username of ["demo", "freshadmin"]) {
    const [row] = await db.insert(member).values({
      username, name: "测试管理员", email: `${username}@example.invalid`, status: "ACTIVE",
      passwordHash: await hashPassword("demo-password-12345"), isInitialAdmin: false,
    }).returning({ id: member.id });
    await db.insert(roleAssignment).values({ memberId: row!.id, roleId: admin.id, scopeType: "ORG", scopeId: null });
  }
} finally { await sql.end({ timeout: 5 }); }
