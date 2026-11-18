#!/usr/bin/env node
/**
 * 每日备份调度器（容器内的轻量方案；生产也可用 systemd timer）。
 * 环境变量：
 *   DATABASE_URL / DATA_DIR   必填，传给 scripts/backup.ts
 *   BACKUP_DIR                默认 ./backups
 *   BACKUP_AT                 默认 03:30，格式 HH:MM
 *   BACKUP_KEEP_DAYS          默认 14；0 = 不清理
 *   BACKUP_ON_START=1         启动时先跑一次
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
const out = process.env.BACKUP_DIR ?? "./backups";
const at = process.env.BACKUP_AT ?? "03:30";
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
const [hh, mm] = at.split(":").map(Number);
if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
  console.error("BACKUP_AT 格式应为 HH:MM"); process.exit(1);
}
function run() {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/backup.ts", "--out", out], { stdio: "inherit", env: process.env });
  if (r.status !== 0) console.error("[backup-scheduler] 备份失败");
  prune();
}
function prune() {
  if (!(keepDays > 0)) return;
  const cutoff = Date.now() - keepDays * 86_400_000;
  try {
    for (const name of readdirSync(out)) {
      if (!name.startsWith("feronavi-backup-")) continue;
      const p = join(out, name);
      try { if (statSync(p).mtimeMs < cutoff) { rmSync(p, { recursive: true, force: true }); console.log(`[backup-scheduler] 清理 ${name}`); } } catch { /* ignore */ }
    }
  } catch { /* 目录不存在时忽略 */ }
}
function nextDelay() {
  const now = new Date();
  const next = new Date(now); next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
if (process.env.BACKUP_ON_START === "1") run();
console.log(`[backup-scheduler] 每日 ${at} 备份到 ${out}，保留 ${keepDays} 天`);
const timer = setTimeout(() => { run(); setInterval(run, 86_400_000).unref(); }, nextDelay());
timer.unref();
// 保持进程存活（由 systemd/容器管理）
setInterval(() => {}, 1 << 30);
