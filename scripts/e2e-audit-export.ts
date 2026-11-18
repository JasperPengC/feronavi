import "./_env.ts";   // 环境预设必须最先加载
/**
 * 审计 CSV 导出自检（Round 25 长任务第 16 项）：
 * 合规导出必须：带 BOM（Excel 中文）、正确转义逗号/引号/换行、与列表同筛选、无权限 403、不含敏感材料。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import * as auditService from "../src/server/services/audit.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "csv-admin";
const GUEST = "csv-guest";
const PW = "csv-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "csv-admin@x.test", name: "导出管理员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const [guestRow] = await db.insert(member).values({
  username: GUEST, email: "csv-guest@x.test", name: "导出访客", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: guestRow!.id, roleId: mr!.id, scopeType: "ORG", scopeId: null });

// 构造两行已知审计（含需要转义的字符；审计写入本身会白名单过滤 changes）
await auditService.writeAudit({
  actorId: adminRow!.id, actorSnapshot: 'csv,"quote"\nline',
  action: "export.test", targetType: "TEST", changes: { priority: "LOW", password: "should-not-appear" }, severity: "SECURITY",
});
await auditService.writeAudit({
  actorId: adminRow!.id, actorSnapshot: "normal-actor",
  action: "export.business", targetType: "TEST", severity: "BUSINESS",
});

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const loginCookie = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
};

try {
  const cookie = await loginCookie(ADMIN);
  const getCsv = async (qs = "") => {
    const r = await fetch(`${BASE}/api/v1/audit-entries/export${qs}`, { headers: { cookie } });
    const buf = new Uint8Array(await r.arrayBuffer());
    // ⚠️ fetch 的 text() 按规范会**吃掉 BOM**；检查字节 + 用 ignoreBOM 解码才能验证 BOM 真存在
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf);
    return { status: r.status, type: r.headers.get("content-type") ?? "", disp: r.headers.get("content-disposition") ?? "", bytes: buf, text };
  };

  const all = await getCsv();
  ok("导出 200 且 Content-Type 为 CSV", all.status === 200 && all.type.includes("text/csv"), `${all.status} ${all.type}`);
  ok("响应头带附件文件名", /attachment; filename="audit-\d{8}\.csv"/.test(all.disp), all.disp);
  ok("文件以 UTF-8 BOM 开头（Excel 中文可读）", all.bytes[0] === 0xef && all.bytes[1] === 0xbb && all.bytes[2] === 0xbf && all.text.charCodeAt(0) === 0xfeff);
  ok("表头完整", all.text.includes("time,severity,action,actorId,actorSnapshot,targetType,targetId,ip,changes"));
  ok("含 SECURITY 与 BUSINESS 行", all.text.includes("export.test") && all.text.includes("export.business"));
  ok("逗号/引号/换行被正确转义", all.text.includes('"csv,""quote""') && all.text.includes("line"), JSON.stringify(all.text.slice(all.text.indexOf("export.test") - 40, all.text.indexOf("export.test"))));
  ok("敏感 changes 已被审计白名单过滤（无 password 明文）", !all.text.includes("should-not-appear") && !all.text.includes('"password"'));

  const sec = await getCsv("?severity=SECURITY");
  ok("severity=SECURITY 过滤生效", sec.text.includes("export.test") && sec.text.includes("auth.login") && !sec.text.includes("export.business"));
  const kw = await getCsv("?q=auth.login");
  ok("q=auth.login 过滤生效", kw.text.includes("auth.login") && !kw.text.includes("export.test"));

  // 无 audit:read → 403
  const guestCookie = await loginCookie(GUEST);
  const denied = await fetch(`${BASE}/api/v1/audit-entries/export`, { headers: { cookie: guestCookie } });
  ok("无 audit:read 导出 → 403", denied.status === 403, String(denied.status));
} finally {
  await app.close();
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
