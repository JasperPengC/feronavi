// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/package-source.mjs");

describe("源码发布包的公开边界", () => {
  it("保留源码、测试、使用文档和许可证，排除内部资料、贡献入口和凭据", () => {
    const directory = mkdtempSync(join(tmpdir(), "feronavi-source-test-"));
    const output = join(tmpdir(), `feronavi-source-test-${Date.now()}.tar.gz`);
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: directory });
      const fixtures = [
        "README.md",
        "docs/screenshots/10-workbench-light.png",
        "docs/screenshots/11-wiki-light.png",
        "docs/screenshots/01-workbench-dark.png",
        "docs/screenshots/04-wiki-dark.png",
        "docs/superpowers/plans/private-plan.md",
        "docs/evidence/private-result.json",
        "docs/验收/private-report.md",
        "docs/audit-private.md",
        "PRODUCT.md",
        "AGENTS.md",
        "CONTRIBUTING.md",
        "CLA.md",
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".claude/settings.json",
        "src/CLAUDE.md",
        "packages/tool/node_modules/cached.js",
        "packages/tool/.env.local",
        "tests/example.test.ts",
        "src/example.ts",
        "scripts/package-source.mjs",
        "package.json",
        ".env.example",
        ".env.production",
        "release.pem",
        "src/service.key",
        "src/service.PEM",
        "secrets/token.json",
        "src/secrets/config.json",
        "public/design-key.svg",
        "packages/feronavi-mcp/LICENSE",
      ];
      for (const file of fixtures) {
        mkdirSync(dirname(join(directory, file)), { recursive: true });
        writeFileSync(join(directory, file), "test fixture\n");
      }
      execFileSync("git", ["add", "--all"], { cwd: directory });
      execFileSync(process.execPath, [script, output], { cwd: directory });
      const archivePaths = execFileSync("tar", ["-tzf", output], {
        encoding: "utf8",
      })
        .trim()
        .split("\n");
      const manifest = JSON.parse(
        readFileSync(output + ".manifest.json", "utf8"),
      );
      expect(archivePaths).toEqual([
        ".env.example",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        "README.md",
        "docs/screenshots/01-workbench-dark.png",
        "docs/screenshots/04-wiki-dark.png",
        "docs/screenshots/10-workbench-light.png",
        "docs/screenshots/11-wiki-light.png",
        "package.json",
        "packages/feronavi-mcp/LICENSE",
        "public/design-key.svg",
        "scripts/package-source.mjs",
        "src/example.ts",
        "tests/example.test.ts",
      ]);
      expect(
        manifest.files.map((entry: { path: string }) => entry.path),
      ).toEqual(archivePaths);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      for (const suffix of ["", ".files", ".manifest.json"])
        rmSync(output + suffix, { force: true });
    }
  });
});
