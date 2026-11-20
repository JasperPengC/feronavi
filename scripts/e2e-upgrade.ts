import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 升级与迁移自检（第十二期）：账本一致性、迁移锁互斥、备份归档三件套 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as upgrade from "../src/server/services/upgrade.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { startIsolatedRedis } from "../tests/support/isolated-special.ts";
import { encryptSecret } from "../src/server/services/crypto.service.ts";

const cache = await startIsolatedRedis(process.env.FERONAVI_TEST_DIRECTORY!);
process.env.REDIS_URL = cache.url;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w12c-admin";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w12c@x.test", name: "升级管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w12c-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3983), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3983";

try {
  // ── 账本与文件一致性（第二期踩过的坑，必须有自检）──
  const st = await upgrade.migrationStatus();
  ok("自检报告账本数与文件数", st.applied > 0 && st.files > 0, `${st.applied}/${st.files}`);
  ok("账本与迁移文件一致（当前应为一致）", st.consistent === true, `applied=${st.applied} files=${st.files} notes=${st.notes.join("|")}`);
  ok("迁移文件按字典序即执行序", JSON.stringify(upgrade.migrationFiles()) === JSON.stringify([...upgrade.migrationFiles()].sort()));
  ok("升级流程含备份且在最前", st.upgradeFlow[0]!.startsWith("1 备份"), st.upgradeFlow[0]);
  ok("升级流程含失败回滚", st.upgradeFlow.some((x) => x.includes("回滚镜像")), JSON.stringify(st.upgradeFlow));
  ok("非外部库时不误报备份责任转移", st.externalDatabase === false || st.notes.some((n) => n.includes("外部数据库")));

  // ── 迁移分布式锁（规范：多副本只跑一次）──
  let ran = 0;
  await upgrade.withMigrationLock(async () => { ran++; }, { key: "feronavi:test:migrate" });
  ok("取到锁时可执行", ran === 1);
  // 并发：第二个必须被拒
  const results = await Promise.allSettled([
    upgrade.withMigrationLock(async () => { await new Promise((r) => setTimeout(r, 300)); return "first"; }, { key: "feronavi:test:migrate2" }),
    (async () => { await new Promise((r) => setTimeout(r, 60)); return upgrade.withMigrationLock(async () => "second", { key: "feronavi:test:migrate2" }); })(),
  ]);
  const first = results[0]!;
  const second = results[1]!;
  ok("并发时只有一个拿到锁（另一个被拒）",
    first.status === "fulfilled" && second.status === "rejected" && /分布式锁/.test(String((second as PromiseRejectedResult).reason?.message)),
    `${first.status}/${second.status}`);
  // 释放后可再次获取（锁没泄漏）
  await upgrade.withMigrationLock(async () => { ran++; }, { key: "feronavi:test:migrate2" });
  ok("锁释放后可再次获取（不会死锁）", ran === 2, String(ran));

  // ── 备份归档三件套（规范：数据库 + 附件 + 密钥，缺一不可）──
  encryptSecret("backup-fixture-secret"); // 首次使用敏感设置时才会生成 master.key。
  const outDir = join(process.env.FERONAVI_TEST_DIRECTORY!, "backups");
  execFileSync("bash", ["scripts/backup.sh", outDir], {
    env: { ...process.env, DATA_DIR: process.env.DATA_DIR ?? "/tmp/feronavi-data" },
    stdio: "pipe",
  });
  const archives = readdirSync(outDir).filter((f) => f.endsWith(".tar.gz")).sort();
  const latest = archives[archives.length - 1]!;
  const listing = execFileSync("tar", ["-tzf", `${outDir}/${latest}`], { encoding: "utf8" });
  ok("归档包含数据库导出", listing.includes("db.sql"), listing.slice(0, 80));
  ok("归档包含密钥（缺了它敏感设置永远解不开）", listing.includes("master.key"));
  ok("归档旁有校验和文件", existsSync(`${outDir}/${latest}.sha256`));
  ok("备份脚本对缺失附件给出明确提示而非静默", listing.includes("attachments"), listing.replace(/\n/g, " "));
  const script = readFileSync("scripts/backup.sh", "utf8");
  ok("脚本内写明恢复步骤（演练依据）", /恢复（演练过再上生产）/.test(script));
  ok("脚本对密钥权限收紧（600）", /chmod 600/.test(script));

  // ── HTTP 自检端点：权限与内容 ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w12c-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const http = await fetch(`${BASE}/api/v1/system/migrations`, { headers: { cookie } });
  const body = (await http.json()) as { applied: number; consistent: boolean };
  ok("HTTP 自检端点 200 且与直连一致", http.status === 200 && body.applied === st.applied && body.consistent === st.consistent,
    `${http.status} ${JSON.stringify(body).slice(0, 60)}`);
  const anon = await fetch(`${BASE}/api/v1/system/migrations`);
  ok("匿名访问被拒（自检信息不对外）", anon.status === 403, String(anon.status));
  void admin;
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
  await cache.stop();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
