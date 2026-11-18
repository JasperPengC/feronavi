/** 一次性数据修复：补回被 e2e-setup 套件删掉的组织记录（本地演示实例） */
import "./_env.ts";
import { db, sql } from "../src/db/index.ts";
import { organization } from "../src/db/schema.ts";

const existing = await db.select({ id: organization.id }).from(organization).limit(1);
if (existing[0]) {
  console.log("  组织记录已存在，无需修复");
} else {
  await db.insert(organization).values({
    name: "Feronavi 演示组织", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai",
  });
  console.log("  ✅ 已补回组织记录");
}
await sql.end();
