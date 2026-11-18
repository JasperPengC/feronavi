import "./_env.ts";
/** 仅由隔离测试夹具调用，拒绝对已有开发/生产库执行迁移与种子。 */
const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
if (!/^feronavi_test_[a-f0-9]{32}$/u.test(databaseName)) {
  throw new Error("测试初始化只接受夹具创建的 feronavi_test_<uuid> 数据库");
}
const { sql } = await import("../src/db/index.ts");
try {
  const { runMigrations } = await import("../src/db/migrate.ts");
  const { seedBuiltin } = await import("../src/db/seed-builtin.ts");
  await runMigrations();
  await seedBuiltin();
} finally {
  await sql.end({ timeout: 5 });
}
