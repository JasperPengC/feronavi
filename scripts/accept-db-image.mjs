/** 独立限额容器/tmpfs验收；所有数据库由隔离夹具创建，凭据只在内存传递。 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createIsolatedDatabase, prepareDatabase, runNode } from "../tests/support/isolated-database.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const imageTag = process.argv[2] ?? "feronavi-db:pilot-hardening";
const evidence = resolve(root, process.argv[3] ?? ".cache/db-image-acceptance");
fs.mkdirSync(`${evidence}/logs`, { recursive: true });
const containers = [];
const results = [];
const cleanup = () => {
  while (containers.length) {
    const container = containers.at(-1);
    execFileSync("docker", ["rm", "--force", "--volumes", container.id], { stdio: "ignore" });
    containers.pop();
    fs.appendFileSync(`${evidence}/logs/os-db-runtime-cleanup.log`, `PASS removed own container ${container.name}; own tmpfs discarded; existing DB/preview/volumes untouched\n`, { mode: 0o600 });
  }
};
const interrupted = () => { cleanup(); process.exit(130); };
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);

async function startContainer(image) {
  const name = `feronavi-db-accept-${randomUUID()}`;
  const password = randomBytes(32).toString("hex");
  const id = execFileSync("docker", ["run", "--pull=never", "--detach", "--name", name,
    "--label", "feronavi.test.fixture=true", "--memory", "2g", "--cpus", "2", "--shm-size", "256m",
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,mode=0700",
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=feronavi", "--env", "POSTGRES_DB=postgres", image],
  { env: { ...process.env, POSTGRES_PASSWORD: password }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.match(id, /^[a-f0-9]{64}$/u);
  const container = { id, name, image };
  containers.push(container);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const probe = spawnSync("docker", ["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "feronavi", "-d", "postgres"], { stdio: "ignore" });
    if (probe.status === 0) { ready = true; break; }
    await delay(500);
  }
  assert.ok(ready, "独立容器未就绪");
  const published = execFileSync("docker", ["port", id, "5432/tcp"], { encoding: "utf8" }).trim();
  assert.match(published, /^127\.0\.0\.1:\d+$/u);
  return { ...container, adminUrl: `postgresql://feronavi:${password}@${published}/postgres` };
}

async function fixture(adminUrl) {
  const inherited = process.env.TEST_DATABASE_ADMIN_URL;
  process.env.TEST_DATABASE_ADMIN_URL = adminUrl;
  try { return await createIsolatedDatabase(); }
  finally {
    if (inherited === undefined) delete process.env.TEST_DATABASE_ADMIN_URL;
    else process.env.TEST_DATABASE_ADMIN_URL = inherited;
  }
}

try {
  const target = await startContainer(imageTag);
  const testEnv = { ...process.env, TEST_DATABASE_ADMIN_URL: target.adminUrl, PG_CONTAINER: target.name };
  for (const script of ["e2e-db-image.ts", "e2e-upgrade-restore-rehearsal.ts", "e2e-migration-lock.ts"]) {
    const started = Date.now();
    const run = spawnSync(process.execPath, ["scripts/run-isolated-test.ts", `scripts/${script}`],
      { cwd: root, env: testEnv, encoding: "utf8", timeout: 650000, maxBuffer: 16 * 1024 * 1024 });
    fs.writeFileSync(`${evidence}/logs/os-db-${script.replace(/\.ts$/u, "")}.log`, (run.stdout ?? "") + (run.stderr ?? ""), { mode: 0o600 });
    results.push({ script, exit: run.status, durationMs: Date.now() - started });
    console.log(`${script}: exit=${run.status}, ${Math.round((Date.now() - started) / 1000)}s`);
    if (run.status !== 0) throw new Error(`验收失败：${script}（详见独立日志）`);
  }

  if (process.env.DB_IMAGE_BACKUP_SOURCE_IMAGE) {
    const source = await startContainer(process.env.DB_IMAGE_BACKUP_SOURCE_IMAGE);
    let sourceDatabase, targetDatabase;
    const started = Date.now();
    try {
      sourceDatabase = await fixture(source.adminUrl);
      sourceDatabase.env.PG_CONTAINER = source.name;
      await prepareDatabase(sourceDatabase);
      targetDatabase = await fixture(target.adminUrl);
      const run = await runNode(["scripts/e2e-upgrade-restore-rehearsal.ts"], {
        ...sourceDatabase.env,
        RESTORE_TEST_DATABASE_URL: targetDatabase.url,
        RESTORE_TEST_DATABASE_NAME: targetDatabase.name,
        RESTORE_PG_CONTAINER: target.name,
      }, 600000);
      fs.writeFileSync(`${evidence}/logs/os-db-cross-image-backup-restore.log`, run.stdout + run.stderr, { mode: 0o600 });
      results.push({ script: "cross-image backup/restore", sourceImage: source.image, targetImage: imageTag, exit: 0, durationMs: Date.now() - started });
      console.log(`PASS cross-image source backup -> target restore; ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      fs.writeFileSync(`${evidence}/logs/os-db-cross-image-backup-restore.log`, (error.stdout ?? "") + (error.stderr ?? ""), { mode: 0o600 });
      throw new Error("跨镜像备份恢复失败（详见独立日志）", { cause: error });
    } finally {
      try { await targetDatabase?.cleanup(); }
      finally { await sourceDatabase?.cleanup(); }
    }
  }

  const inventory = execFileSync("docker", ["exec", target.id, "sh", "-c", `cat /etc/os-release; echo '--- package inventory ---'; if [ -e /etc/alpine-release ]; then apk info -v; echo '--- XML consumers ---'; apk info -r libxml2; ldd /usr/lib/libxslt.so.1; ldd /usr/lib/libLLVM.so.21.1; echo '--- installed XML ownership/hash ---'; apk info -W /usr/lib/libxml2.so.2; cat /usr/share/doc/feronavi/security/libxml2-binary.sha256; else dpkg-query -W -f='\${Package}\t\${Version}\n' | grep -E '^(apt|libapt-pkg[0-9.]+|libssl3(t64)?|openssl|libsqlite3-0|libxml2|zlib1g|postgresql-16)[[:space:]]'; echo '--- library reverse dependencies ---'; dpkg-query -W -f='\${Package}\t\${Depends}\n' | grep -E 'libsqlite3-0|libxml2|zlib1g'; fi; echo '--- PostgreSQL dynamic libraries ---'; ldd "$(pg_config --bindir)/postgres"`], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  fs.writeFileSync(`${evidence}/logs/os-db-runtime-inventory.log`, inventory, { mode: 0o600 });
  const image = JSON.parse(execFileSync("docker", ["image", "inspect", imageTag], { encoding: "utf8" }))[0];
  fs.writeFileSync(`${evidence}/os-db-runtime-acceptance.json`, JSON.stringify({ image: image.Id, architecture: image.Architecture, container: target.name, storage: "own tmpfs, removed in finally", results }, null, 2));
  console.log("PASS 新镜像独立容器所有验收完成");
} catch (error) {
  console.error(error instanceof Error ? error.message : "数据库镜像验收失败");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  cleanup();
}
