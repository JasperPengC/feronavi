/** 助手闭环永久门禁；每套创建独立数据库，不调用真实模型或外部接收端。 */
import { spawnSync } from "node:child_process";

const suites = [
  "e2e-assistant-full-scopes.ts",
  "e2e-assistant-scope-negative-review.ts",
  "e2e-assistant-artifacts.ts",
  "e2e-import-connection-safety.ts",
  "e2e-assistant-external-action.ts",
  "e2e-assistant-business-workflows.ts",
];
for (const suite of suites) {
  console.log(`运行助手闭环门禁：${suite}`);
  const result = spawnSync(process.execPath, ["scripts/run-isolated-test.ts", `scripts/${suite}`], { env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`助手闭环门禁完成：${suites.length} 套通过。`);
