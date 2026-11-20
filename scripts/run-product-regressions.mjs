/** 已确认缺陷的永久门禁；每个脚本使用单独随机库，真实模型另行验收。 */
import { spawnSync } from "node:child_process";

const suites = [
  "e2e-business-remediation.ts",
  "e2e-automation-recovery.ts",
  "e2e-webhook-recovery.ts",
  "e2e-plan-lifecycle.ts",
  "e2e-login-security.ts",
  "e2e-ldap-login-limits.ts",
  "e2e-migration-lock.ts",
  "e2e-ai.ts",
  "e2e-settings-null.ts",
];
for (const suite of suites) {
  console.log(`运行产品整改回归：${suite}`);
  const result = spawnSync(process.execPath, ["scripts/run-isolated-test.ts", `scripts/${suite}`], { env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`产品整改回归完成：${suites.length} 套通过。`);
