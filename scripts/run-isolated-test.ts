/** 创建随机库与可选临时服务；只清理本次创建的资源。 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve, relative, sep, basename } from "node:path";
import postgres from "postgres";
import { createIsolatedDatabase, prepareDatabase, repositoryRoot, runNode, type IsolatedDatabase } from "../tests/support/isolated-database.ts";
import { startIsolatedApp } from "../tests/support/isolated-app.ts";

const argv = process.argv.slice(2);
const mode = argv[0]?.startsWith("--") ? argv.shift() : undefined;
if (mode && !["--browser", "--empty", "--demo"].includes(mode)) throw new Error("未知隔离测试模式");
const [script = mode === "--demo" ? "scripts/seed-demo.ts" : "", ...args] = argv;
const resolved = resolve(repositoryRoot, script);
const target = existsSync(resolved) ? realpathSync(resolved) : resolved;
const local = relative(realpathSync(resolve(repositoryRoot, "scripts")), target);
if (!script || local.startsWith(`..${sep}`) || local === ".." || !/\.(?:ts|mjs)$/u.test(local)
    || !existsSync(target) || local === "run-isolated-test.ts") {
  throw new Error("请指定仓库 scripts 目录中存在的测试脚本");
}
const browserMode = !!mode;
// 该总验收有独立的内层runner；为其1秒终止及随机库DROP留出清理预算。
const terminationGraceMs = basename(target) === "e2e-system-backup.ts" ? 30_000 : 10_000;
const empty = mode === "--empty" || ["accept-setup-wizard.mjs", "accept-install-e2e.mjs"].includes(basename(target));
let database: IsolatedDatabase | undefined;
const controller = new AbortController();
let child: ChildProcess | undefined;
let app: Awaited<ReturnType<typeof startIsolatedApp>> | undefined;
let interrupted = false;
let forceStop: ReturnType<typeof setTimeout> | undefined;
let finishDemo: (() => void) | undefined;
const signalChild = (signal: NodeJS.Signals) => {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") { if (child.exitCode === null && child.signalCode === null) child.kill(signal); }
    else process.kill(-child.pid!, signal);
  } catch { /* 子进程已结束。 */ }
};
const interrupt = () => {
  interrupted = true;
  controller.abort();
  signalChild("SIGTERM");
  forceStop ??= setTimeout(() => signalChild("SIGKILL"), terminationGraceMs);
  finishDemo?.();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  database = await createIsolatedDatabase(controller.signal);
  console.log(`使用一次性测试库 ${database.name}`);
  if (!empty) await prepareDatabase(database, controller.signal);
  if (browserMode) {
    if (!empty) {
      await runNode(["scripts/prepare-browser-test.ts"], database.env, 120_000, controller.signal);
      await runNode(["scripts/seed-demo.ts"], { ...database.env, SEED_USERNAME: "demo" }, 120_000, controller.signal);
      const sql = postgres(database.url, { max: 1 });
      try {
        const [project] = await sql`select id from project where key = 'FINOK'`;
        if (!project) throw new Error("演示项目初始化失败");
        database.env.PROJECT_ID = project.id;
      } finally { await sql.end(); }
    }
    if (interrupted) throw new Error("隔离测试已取消");
    app = await startIsolatedApp(database, { signal: controller.signal });
  }
  if (interrupted) throw new Error("隔离测试已取消");
  if (mode === "--demo") {
    console.log(`演示地址：${app!.baseURL}，账号 demo / demo-password-12345；按 Ctrl+C 停止并清理。`);
    await new Promise<void>((done) => { finishDemo = done; });
  } else {
    // 持续压测默认10或20分钟；给建样本与清理留空间，不能被普通套件10分钟上限截断。
    const performanceSuite = /^perf-(load-10m|sse-10m|sustained)\.mjs$/u.test(basename(target));
    const agentBudget = Number(process.env.MCP_AGENT_TIMEOUT_MS ?? 1_200_000);
    const timeoutMs = performanceSuite ? Math.max(1_800_000, Number(process.env.PERF_DURATION_MS ?? 0) + 600_000)
      : basename(target) === "e2e-mcp-agent.ts" && Number.isInteger(agentBudget) && agentBudget >= 60_000 && agentBudget <= 1_800_000
        ? agentBudget + 120_000 : 600_000;
    const timer = setTimeout(interrupt, timeoutMs);
    try {
      process.exitCode = await new Promise<number>((resolveExit, reject) => {
        child = spawn(process.execPath, [target, ...args], {
          cwd: repositoryRoot, detached: process.platform !== "win32",
          env: app ? { ...app.env, A11Y_USERNAME: "demo", A11Y_PASSWORD: "demo-password-12345" } : database!.env,
          stdio: "inherit",
        });
        child.once("error", reject);
        child.once("exit", (status) => resolveExit(interrupted ? 130 : status ?? 1));
      });
    } finally { clearTimeout(timer); }
  }
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  clearTimeout(forceStop);
  // 子测试已退出时仍可能留下浏览器等后代；进程组只属于本次运行。
  signalChild("SIGKILL");
  try { await app?.stop(); }
  finally { await database?.cleanup(); }
}
