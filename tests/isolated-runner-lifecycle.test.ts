// @vitest-environment node
import { expect, it } from "vitest";
import { runNode } from "./support/isolated-database.ts";
it("准备/构建阶段的子进程取消会失败退出，不能继续运行到副作用", async () => {
  const controller = new AbortController();
  const operation = runNode(["--input-type=module", "-e", "console.log('started'); setInterval(() => {}, 1000)"], process.env, 60_000, controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { await expect(operation).rejects.toThrow("取消"); }
  finally { clearTimeout(timer); }
});
it("已取消的启动不会创建子进程", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(runNode(["-e", "throw new Error('should not execute')"], process.env, 60_000, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});
it("子进程失败保留退出码与诊断，不重试或伪报成功", async () => {
  await expect(runNode(["-e", "console.error('fixture diagnostic'); process.exit(7)"], process.env)).rejects.toMatchObject({ code: 7, stderr: expect.stringContaining("fixture diagnostic") });
});
