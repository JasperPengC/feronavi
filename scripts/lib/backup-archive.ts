/** 运维备份在触及目标数据库前完成清单、文件及附件解包校验。 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { sha256File } from "./backup-tools.ts";

export function assertRegularTree(directory: string): void {
  if (!lstatSync(directory).isDirectory()) throw new Error("数据目录必须是普通目录，不能是符号链接");
  for (const name of readdirSync(directory)) {
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isDirectory()) assertRegularTree(path);
    else if (!stat.isFile()) throw new Error(`数据目录含不支持的链接或特殊文件：${path}`);
  }
}

export function prepareRestore(backupDir: string, dataDir?: string, force = false) {
  const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
  if (manifest?.format !== "feronavi-backup/1") throw new Error("不支持的备份格式");
  const file = (key: string): string => {
    const meta = manifest.files?.[key];
    if (!meta || typeof meta.name !== "string" || basename(meta.name) !== meta.name || /[\\/]/.test(meta.name)
      || meta.name === "." || meta.name === ".." || !/^[a-f0-9]{64}$/.test(meta.sha256 ?? "")) {
      throw new Error(`manifest ${key} 文件描述无效`);
    }
    const path = join(backupDir, meta.name);
    if (!lstatSync(path).isFile()) throw new Error(`${key} 必须是普通文件`);
    if (sha256File(path) !== meta.sha256) throw new Error(`${key} 校验和不匹配`);
    return path;
  };
  const database = file("database");
  if (!manifest.files?.attachments) return { database, stage: undefined, destination: undefined };
  if (!dataDir) throw new Error("备份包含附件和主密钥，必须指定 --data-dir 或 DATA_DIR");
  const archive = file("attachments"), destination = resolve(dataDir);
  if (destination === resolve(backupDir) || resolve(backupDir).startsWith(`${destination}/`)) throw new Error("恢复目录不能包含备份目录");
  try {
    if (!lstatSync(destination).isDirectory()) throw new Error("恢复目标必须是普通目录，不能是符号链接");
    if (!force && readdirSync(destination).length) throw new Error("恢复目录非空，请使用新目录；--force 会保留旧目录并整体替换");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // 在空暂存目录解包。先拒绝越界路径、符号/硬链接与特殊文件，再解压验证整个归档。
  const list = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  for (const name of list.split("\n").filter(Boolean)) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error("附件归档包含不安全路径");
  }
  const details = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (details.split("\n").some(line => line && !/^[d-]/.test(line))) throw new Error("附件归档含不支持的链接或特殊文件");
  mkdirSync(dirname(destination), { recursive: true });
  const stage = mkdtempSync(join(dirname(destination), ".feronavi-restore-"));
  try {
    execFileSync("tar", ["-xzf", archive, "--no-same-owner", "-C", stage], { stdio: "pipe" });
    assertRegularTree(stage);
    return { database, stage, destination };
  } catch (error) { rmSync(stage, { recursive: true, force: true }); throw error; }
}
