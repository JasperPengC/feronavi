/** 仅校验夹具声明，不打开连接，也不补开发库默认值。 */
export function assertIsolatedTestEnvironment(env = process.env) {
  const name = env.FERONAVI_TEST_DATABASE;
  let target;
  try { target = new URL(env.DATABASE_URL ?? ""); } catch { /* 拒绝信息不包含连接口令。 */ }
  if (!name || !/^feronavi_test_[a-f0-9]{32}$/u.test(name)
      || !target || !/^postgres(ql)?:$/u.test(target.protocol)
      || target.pathname !== `/${name}`) {
    throw new Error("测试必须使用隔离夹具创建的数据库。请设置 TEST_DATABASE_ADMIN_URL 后通过 npm run test:<套件> 或 node scripts/run-isolated-test.ts scripts/<测试脚本> 运行；不会使用开发库。");
  }
  if (env.BASE && env.BASE !== env.FERONAVI_TEST_BASE_URL) {
    throw new Error("测试 BASE 必须由隔离服务夹具提供，不能指向现有实例。");
  }
  return name;
}
