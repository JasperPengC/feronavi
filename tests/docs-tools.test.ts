// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("文档工具不依赖工作目录或相邻仓库", () => {
  it("文档自检可在仓库外执行，并验证仓库里的现行文档", () => {
    const cwd = mkdtempSync(join(tmpdir(), "feronavi-docs-check-"));
    try {
      expect(execFileSync(process.execPath, [resolve("scripts/check-docs-site.mjs")], {
        cwd, encoding: "utf8", env: { ...process.env, DOCS_DIR: "" },
      })).toContain("0 失败");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
  it("权限矩阵从本仓库规范生成且保留现有角色契约", () => {
    const output = mkdtempSync(join(tmpdir(), "feronavi-docs-"));
    try {
      execFileSync(process.execPath, [resolve("scripts/gen-permission-matrix.mjs"), "--out", join(output, "matrix.json")], { cwd: output, stdio: "pipe" });
      const generated = JSON.parse(readFileSync(join(output, "matrix.json"), "utf8"));
      expect(generated).toEqual(JSON.parse(readFileSync("tests/permission-matrix.generated.json", "utf8")));
    } finally { rmSync(output, { recursive: true, force: true }); }
  });

  it("文档站默认构建现行项目文档，缺少输入时明确报错", () => {
    const output = mkdtempSync(join(tmpdir(), "feronavi-docs-"));
    try {
      execFileSync(process.execPath, [resolve("scripts/build-docs-site.mjs")], { cwd: output, env: { ...process.env, OUT_DIR: output, DOCS_DIR: "" }, stdio: "pipe" });
      const index = readFileSync(join(output, "index.html"), "utf8");
      expect(index).toContain("deploy.html");
      expect(index).toContain("testing.html");
      expect(readFileSync(join(output, "deploy.html"), "utf8")).toContain('href="testing.html"');
      expect(() => execFileSync(process.execPath, [resolve("scripts/build-docs-site.mjs")], {
        cwd: output, env: { ...process.env, OUT_DIR: output, DOCS_DIR: join(output, "missing") }, stdio: "pipe",
      })).toThrow();
    } finally { rmSync(output, { recursive: true, force: true }); }
  });
});
