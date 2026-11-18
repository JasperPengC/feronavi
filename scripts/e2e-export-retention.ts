import "./_env.ts";   // 环境预设必须最先加载
/**
 * 导出包保留期自检（Round 25 长任务第 47 项）：
 * 按 mtime 清理过期导出包、0=关闭、目录缺失安全、统计、与保留期清理的整合、运维状态暴露。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { pruneExportPackages, exportPackageStats, pruneHistoricalLogs } from "../src/server/services/retention.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "retention-admin";
const PW = "retention-pass-123456";
const TMP = "/tmp/feronavi-export-retention-e2e";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "retention@x.test", name: "保留期管理员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const oldFile = join(TMP, "old.json");
const newFile = join(TMP, "new.json");
await writeFile(oldFile, JSON.stringify({ x: 1 }));
await writeFile(newFile, JSON.stringify({ y: 2 }));
const twoDaysAgo = new Date(Date.now() - 48 * 3600_000);
await utimes(oldFile, twoDaysAgo, twoDaysAgo);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
try {
  // ① 统计
  const stats = await exportPackageStats(TMP);
  ok("目录统计 files/bytes", stats.files === 2 && stats.bytes > 0, JSON.stringify(stats));

  // ② 清理 48h 前的文件，保留新的
  const r = await pruneExportPackages({ hours: 24, dir: TMP });
  ok("过期导出包被删除、新的保留", r.deleted === 1 && r.bytesFreed > 0
    && (await exportPackageStats(TMP)).files === 1, JSON.stringify(r));

  // ③ 0 = 关闭
  await utimes(newFile, twoDaysAgo, twoDaysAgo);
  const off = await pruneExportPackages({ hours: 0, dir: TMP });
  ok("hours=0 关闭清理", off.deleted === 0 && (await exportPackageStats(TMP)).files === 1);

  // ④ 与保留期清理整合（注入 now + exportDir，不影响真实导出目录）
  const combined = await pruneHistoricalLogs({ now: new Date(), auditDays: 0, activityDays: 0, exportHours: 24, exportDir: TMP });
  ok("pruneHistoricalLogs 同时清理导出包并返回真实条数", combined.exportDeleted === 1 && combined.exportHours === 24
    && (await exportPackageStats(TMP)).files === 0, JSON.stringify(combined));

  // ⑤ 目录不存在时安全
  const missing = await pruneExportPackages({ hours: 24, dir: join(TMP, "nope") });
  ok("目录不存在安全返回 0", missing.deleted === 0);

  // ⑥ 运维状态暴露导出包保留期
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: PW }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const ops = await fetch(`${BASE}/api/v1/system/operations`, { headers: { cookie } });
  const body = await ops.json() as { retention?: { exportHours?: number; exportFiles?: number; exportBytes?: number } };
  ok("GET /system/operations 返回导出包保留期与统计", ops.status === 200
    && typeof body.retention?.exportHours === "number" && body.retention.exportHours === 24
    && typeof body.retention?.exportFiles === "number" && typeof body.retention?.exportBytes === "number",
    JSON.stringify(body.retention));
} finally {
  await app.close();
  await rm(TMP, { recursive: true, force: true });
  await db.delete(auditEntry);
  for (const u of [ADMIN]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
