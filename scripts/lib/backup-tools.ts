/** 备份/恢复共用的 PostgreSQL 命令封装：本机工具或 Docker 容器内工具。 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function sha256Buffer(buf: Buffer): string { return createHash("sha256").update(buf).digest("hex"); }

/** 容器模式：把 host 端 URL 改写成容器内 localhost:5432 的 URL */
export function containerUrl(hostUrl: string): string {
  const u = new URL(hostUrl);
  u.hostname = "127.0.0.1"; u.port = "5432";
  return u.toString();
}

/** 密码只通过子进程环境传递，避免命令行与失败诊断回显完整凭据。 */
function connection(hostUrl: string) {
  const url = new URL(hostUrl);
  const password = url.searchParams.get("password") ?? (url.password ? decodeURIComponent(url.password) : process.env.PGPASSWORD);
  url.password = "";
  url.searchParams.delete("password");
  return { url: url.toString(), env: { ...process.env, PGPASSWORD: password } };
}

export function pgDumpCustom(hostUrl: string, outFile: string): void {
  const conn = connection(process.env.PG_CONTAINER ? containerUrl(hostUrl) : hostUrl);
  mkdirSync(dirname(outFile), { recursive: true });
  const fd = openSync(outFile, "w");
  try {
    if (process.env.PG_CONTAINER) {
      execFileSync("docker", ["exec", "--env", "PGPASSWORD", process.env.PG_CONTAINER, "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--dbname", conn.url], { env: conn.env, stdio: ["ignore", fd, "pipe"] });
    } else {
      execFileSync(process.env.PG_DUMP_BIN ?? "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--dbname", conn.url], { env: conn.env, stdio: ["ignore", fd, "pipe"] });
    }
  } finally { closeSync(fd); }
}

export function pgRestoreCustom(hostUrl: string, dumpFile: string): void {
  const conn = connection(process.env.PG_CONTAINER ? containerUrl(hostUrl) : hostUrl);
  if (process.env.PG_CONTAINER) {
    const remote = `/tmp/feronavi-restore-${process.pid}.dump`;
    execFileSync("docker", ["cp", dumpFile, `${process.env.PG_CONTAINER}:${remote}`], { stdio: "pipe" });
    try {
      execFileSync("docker", ["exec", "--env", "PGPASSWORD", process.env.PG_CONTAINER, "pg_restore", "--single-transaction", "--exit-on-error", "--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", conn.url, remote], { env: conn.env, stdio: "pipe" });
    } finally {
      try { execFileSync("docker", ["exec", process.env.PG_CONTAINER, "rm", "-f", remote], { stdio: "pipe" }); } catch { /* ignore */ }
    }
  } else {
    execFileSync(process.env.PG_RESTORE_BIN ?? "pg_restore", ["--single-transaction", "--exit-on-error", "--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", conn.url, dumpFile], { env: conn.env, stdio: "pipe" });
  }
}

export function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}
export function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
}
