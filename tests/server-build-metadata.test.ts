import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("自定义服务端构建为实际运行根目录保留package版本元数据", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feronavi-build-metadata-"));
  try {
    execFileSync(
      process.execPath,
      ["scripts/build-server.mjs", "--outDir", join(directory, "dist-server")],
      { stdio: "pipe" },
    );
    const expected = JSON.parse(await readFile("package.json", "utf8"));
    const actual = JSON.parse(
      await readFile(join(directory, "dist-server/package.json"), "utf8"),
    );
    expect(actual.version).toBe(expected.version);
    expect(actual.type).toBe("module");
    const migrationCli = await readFile(join(directory, "dist-server/db/migrate-cli.js"), "utf8");
    expect(migrationCli).toContain("runMigrations");
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { currentAppVersion } from ${JSON.stringify(join(directory, "dist-server/server/services/app-version.js"))}; process.stdout.write(currentAppVersion)`,
      ],
      { encoding: "utf8" },
    );
    expect(output).toBe(expected.version);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
