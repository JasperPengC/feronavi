/** 串行协议/恢复验收；由隔离 runner 创建随机库，输出逐套件日志与索引。 */
import { spawn } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const mode = process.argv[2] ?? "all";
if (!["all", "recovery", "protocols"].includes(mode)) throw new Error("用法：node scripts/verify-recovery-integrations.mjs [all|recovery|protocols]");
if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("需要 TEST_DATABASE_ADMIN_URL；不会借用开发数据库");
const output = resolve(process.env.RELEASE_EVIDENCE_DIR ?? ".cache/release-tuning-2026-11-08");
await mkdir(output, { recursive: true });
const recovery = [
  ["recovery-presence", ["scripts/e2e-presence-recovery.ts"]],
  ["recovery-multi", ["--browser", "scripts/e2e-multi-instance.ts"]],
  ["recovery-worker", ["scripts/e2e-worker-crash.ts"]],
];
const protocols = [
  ["integration-smtp", ["scripts/e2e-mail-perm.ts"]],
  ["integration-oidc", ["scripts/e2e-sso-login.ts"]],
  ["integration-im-webhook", ["scripts/e2e-im.ts"]],
  ["integration-im-app", ["scripts/e2e-im-app.ts"]],
  ["integration-repository", ["scripts/e2e-integration-sync.ts"]],
  ["integration-webhook", ["scripts/e2e-webhooks.ts"]],
  ["integration-mcp", ["scripts/e2e-mcp.ts"]],
  ["integration-ldap-scim", ["--browser", "scripts/accept-ldap-scim.mjs"]],
];
const suites = mode === "recovery" ? recovery : mode === "protocols" ? protocols : [...recovery, ...protocols];
const results = [];
let interrupted = false;
let child;
const stop = () => { interrupted = true; child?.kill("SIGTERM"); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  for (const [name, args] of suites) {
    if (interrupted) break;
    const log = join(output, `${name}.log`);
    const file = await open(log, "w", 0o600);
    const started = Date.now();
    let code;
    try {
      code = await new Promise((resolveExit, reject) => {
        child = spawn(process.execPath, ["scripts/run-isolated-test.ts", ...args], {
          env: { ...process.env, MULTI_INSTANCE_RECOVERY: "1" }, stdio: ["ignore", file.fd, file.fd],
        });
        child.once("error", reject);
        child.once("exit", status => resolveExit(status ?? 1));
      });
    } finally { await file.close(); }
    results.push({ name, script: args.at(-1), code, durationMs: Date.now() - started, log });
    await writeFile(join(output, `${mode === "recovery" ? "recovery" : "integration"}-results.json`), JSON.stringify({ mode, results, interrupted }, null, 2));
    console.log(`${name}: ${code === 0 ? "PASS" : "FAIL"} (${Date.now() - started}ms)`);
  }
} finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
process.exitCode = interrupted ? 130 : results.some(result => result.code !== 0) ? 1 : 0;
