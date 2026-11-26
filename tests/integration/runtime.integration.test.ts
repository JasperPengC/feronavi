import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compiledEntrypoint, createIsolatedDatabase, prepareDatabase, repositoryRoot, runNode,
  type IsolatedDatabase,
} from "../support/isolated-database.ts";

describe("真实 PostgreSQL 与运行入口", () => {
  let database: IsolatedDatabase;
  beforeAll(async () => {
    database = await createIsolatedDatabase();
    await prepareDatabase(database);
  });
  afterAll(async () => { await database?.cleanup(); });

  it("全新库包含检索扩展、50 权限、4 内置角色和22平台工作流状态", async () => {
    const connection = postgres(database.url, { max: 1 });
    try {
      const extensions = await connection<{ extname: string }[]>`select extname from pg_extension`;
      expect(extensions.map((row) => row.extname)).toEqual(expect.arrayContaining(["vector", "zhparser"]));
      const [counts] = await connection`
        select
          (select count(*)::int from permission) as permissions,
          (select count(*)::int from role where is_system) as roles,
          (select count(*)::int from workflow_state s join workflow w on w.id = s.workflow_id
            where w.project_id is null) as states`;
      expect(counts).toEqual({ permissions: 50, roles: 4, states: 22 });
      const testingPermissions = await connection<{ key: string }[]>`
        select key from permission where "group" = 'test' order by key`;
      expect(testingPermissions.map(row => row.key)).toEqual([
        "test_case:manage", "test_plan:manage", "test_run:execute",
      ]);
    } finally { await connection.end({ timeout: 5 }); }
  });

  // 旧脚本包含完整 API/权限/事务断言；专用环境阻止它们读写开发数据。
  for (const [name, script] of [
    ["安装向导的原子性和初始化锁定", "e2e-setup.ts"],
    ["会话登录、账号权限和 CSRF", "e2e-auth.ts"],
    ["项目 CRUD 与工作流复制", "e2e-project.ts"],
    ["工作项 CRUD 与乐观锁", "e2e-work-item.ts"],
    ["MCP 鉴权和工具调用", "e2e-mcp.ts"],
    ["MCP 写入、幂等键与乐观锁", "e2e-mcp-write.ts"],
    ["MCP 客户端策略与审计", "e2e-mcp-policy.ts"],
    ["MCP 通知与本人偏好边界", "e2e-mcp-notify.ts"],
    ["CSV 映射、预检、确认与回滚", "e2e-import.ts"],
    ["XLSX 解析和导入服务管线", "e2e-xlsx-import.ts"],
    ["任务队列去重、重试与死信", "e2e-jobs.ts"],
  ]) {
    it(name!, async () => {
      const { stdout } = await runNode([`scripts/${script}`], database.env);
      expect(stdout).toMatch(/结果:\s*\d+ 通过 \/ 0 失败/u);
      expect(stdout).not.toContain("⏭");
    });
  }

  it("停止 worker 等待正在执行的任务并停止领取后续任务", async () => {
    await runNode(["tests/support/worker-shutdown.ts"], database.env);
  });

  it("独立 worker 在空闲后仍消费任务并能优雅退出", async () => {
    const buildDirectory = join(database.directory, "server");
    await runNode(["scripts/build-server.mjs", "--outDir", buildDirectory], database.env);
    const connection = postgres(database.url, { max: 1 });
    // 前面的队列验收会清理其数据；此处使用无 SMTP 的临时库，任务只会安全跳过发信。
    const worker = spawn(process.execPath, [await compiledEntrypoint("worker", buildDirectory)], {
      cwd: repositoryRoot,
      // 迁移已由夹具完成；此时没有连接保活，能捕获 unref 导致的启动即退出。
      env: { ...database.env, MIGRATE_ON_START: "0", JOB_WORKER_INTERVAL_MS: "500" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    worker.stdout.on("data", (chunk) => { output += String(chunk); });
    worker.stderr.on("data", (chunk) => { output += String(chunk); });
    const exited = new Promise<number | null>((resolve) => worker.once("exit", resolve));
    try {
      await delay(1200);
      expect(worker.exitCode, output).toBeNull();
      const [queued] = await connection<{ id: string }[]>`
        insert into job (kind, payload)
        values ('email.send', ${connection.json({ to: "ci@example.invalid", subject: "CI", text: "isolated worker smoke" })})
        returning id`;
      await expect.poll(async () => {
        const [row] = await connection<{ status: string }[]>`select status from job where id = ${queued!.id}`;
        return row?.status;
      }, { timeout: 15_000 }).toBe("SUCCEEDED");
      worker.kill("SIGTERM");
      expect(await exited, output).toBe(0);
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
      await exited;
      await connection.end({ timeout: 5 });
    }
  });
});
