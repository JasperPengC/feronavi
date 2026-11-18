import "./_env.ts";
/**
 * 多副本界面验收：独立缓存 + 两个动态端口应用实例；只清理自身资源。
 */
import { spawnSync } from "node:child_process";
import { startIsolatedMultiInstance } from "../tests/support/isolated-special.ts";
const instances = await startIsolatedMultiInstance();
try {
  const r = spawnSync(process.execPath, ["scripts/verify-multi-instance-presence.mjs"], {
    cwd: process.cwd(), stdio: "inherit",
    env: instances.env,
  });
  process.exitCode = r.status ?? 1;
} finally {
  await instances.stop();
}
