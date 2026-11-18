import "./_env.ts";   // 必须最先加载：服务模块在导入时即读取环境变量
import { deleteTestMember } from "./_test-helpers.ts";
/**
 * 附件自检（T4，规范 L1）
 *
 * 重点验 L1 四条硬要求 + 下载/预览两个端点的区分。
 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, attachment, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as attService from "../src/server/services/attachment.service.ts";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";

/** 说明：附件目录由 scripts/_env.ts 预设（见文件首行 import）
 * 附件目录：**套件自带默认值**，不依赖操作者记得导出 ATTACHMENT_DIR。
 * 否则默认落到 /data（本机不存在）→ 报一个 ENOENT 的 mkdir 错误，看起来像产品缺陷
 * （实测在串行全量回归里就是这样被误判为失败的：同一套件上一次通过、这次失败，差别只是环境变量）。
 */

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "a4-up";
await deleteTestMember(U);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({
  username: U, email: "a4@x.test", name: "上传者", status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("a4-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const actor = (await loadActor(m!.id))!;

const KEY = "A4PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(actor, { key: KEY, name: "A4 项目" });

const wfId = (await sql<{ id: string }[]>`select id from workflow where project_id is null and is_builtin and applies_to_type='TASK' limit 1`)[0]!.id;
const stId = (await sql<{ id: string }[]>`select id from workflow_state where workflow_id = ${wfId} order by sort_order limit 1`)[0]!.id;
const [wi] = await db.insert(workItem).values({
  projectId, number: 1, key: `${KEY}-1`, type: "TASK", title: "带附件的",
  workflowId: wfId, statusId: stId, reporterId: m!.id,
}).returning({ id: workItem.id });
const wiId = wi!.id;

/** 构造一个上传 */
function mk(name: string, mime: string, data: Buffer) {
  return { targetType: "WORK_ITEM", targetId: wiId, originalName: name, mimeType: mime, sizeBytes: data.length, data };
}

try {
  // ══ L1-1 大小上限 ═════════════════════════════════════════
  let tooBig = false, bigCode = "";
  try { await attService.upload(actor, mk("big.png", "image/png", Buffer.alloc(26 * 1024 * 1024))); }
  catch (e) { tooBig = true; bigCode = (e as { code?: string }).code ?? ""; }
  ok("超过 25MB 上限 → VALIDATION", tooBig && bigCode === "VALIDATION", bigCode);

  // ══ L1-2 扩展名 + MIME 双重白名单 ═════════════════════════
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let badExt = false;
  try { await attService.upload(actor, mk("evil.exe", "image/png", png)); } catch { badExt = true; }
  ok("不支持的扩展名 → 拒绝", badExt);

  let badMime = false;
  try { await attService.upload(actor, mk("pic.png", "application/x-msdownload", png)); } catch { badMime = true; }
  ok("扩展名与 MIME 不一致 → 拒绝（双重白名单）", badMime);

  // ══ L1-3 文件名清洗（防路径穿越）═════════════════════════
  ok("去掉目录部分", attService.sanitizeFileName("../../etc/passwd") === "passwd", attService.sanitizeFileName("../../etc/passwd"));
  ok("反斜杠也当分隔符", attService.sanitizeFileName("C:\\Windows\\evil.txt") === "evil.txt", attService.sanitizeFileName("C:\\Windows\\evil.txt"));
  ok("控制字符被替换", !/[\x00-\x1f]/.test(attService.sanitizeFileName("a\x00b.txt")), attService.sanitizeFileName("a\x00b.txt"));
  ok("前导点被剥掉（防 ..）", !attService.sanitizeFileName("..hidden.png").startsWith("."), attService.sanitizeFileName("..hidden.png"));
  ok("空名兜底为 file", attService.sanitizeFileName("") === "file", attService.sanitizeFileName(""));

  // ══ L1-4 存储路径 UUID、不可预测 ═════════════════════════
  const a1 = await attService.upload(actor, mk("one.png", "image/png", png));
  ok("上传成功", a1?.id !== undefined);
  ok("存储路径是 UUID（不可预测）", /^[0-9-]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a1!.storagePath), a1!.storagePath);
  ok("原文件名被保留（已清洗）", a1!.originalName === "one.png", a1!.originalName);

  // 秒传：同内容同大小 → 复用存储路径
  const a2 = await attService.upload(actor, mk("two.png", "image/png", png));
  ok("秒传复用同一存储路径", a2!.storagePath === a1!.storagePath, `${a1!.storagePath} vs ${a2!.storagePath}`);
  ok("但 attachment 行各自独立", a1!.id !== a2!.id);

  // ══ 下载与预览是两个端点 ═════════════════════════════════
  const d = await attService.download(actor, a1!.id);
  ok("下载可取回内容", Buffer.compare(d.data, png) === 0);
  ok("下载带原文件名", d.originalName === "one.png");

  const p = await attService.preview(actor, a1!.id);
  ok("图片可预览", p.mimeType === "image/png");

  // 非白名单类型不给预览
  const zipRow = await attService.upload(actor, mk("bundle.zip", "application/zip", Buffer.from("PK\x03\x04fake")));
  let noPreview = false, prevCode = "";
  try { await attService.preview(actor, zipRow!.id); }
  catch (e) { noPreview = true; prevCode = (e as { code?: string }).code ?? ""; }
  ok("zip 不给预览 → FORBIDDEN", noPreview && prevCode === "FORBIDDEN", prevCode);
  const zipDown = await attService.download(actor, zipRow!.id);
  ok("但 zip 可以下载", zipDown.data.length > 0);

  // 越权
  const [o] = await db.insert(member).values({
    username: "a4-other", email: "a4o@x.test", name: "别人", status: "ACTIVE",
    passwordHash: await hashPassword("a4-password-1234"),
  }).returning({ id: member.id });
  const outsider = (await loadActor(o!.id))!;
  let leak = false;
  try { await attService.download(outsider, a1!.id); } catch { leak = true; }
  ok("非项目成员下载被拒（同形）", leak);
  let stealDel = false;
  try { await attService.remove(outsider, a1!.id); } catch { stealDel = true; }
  ok("别人不能删我的附件", stealDel);

  await attService.remove(actor, a2!.id);
  ok("上传者能删自己的附件", (await db.select().from(attachment).where(eq(attachment.id, a2!.id))).length === 0);
  ok("秒传复用不影响原文件（a1 仍可下载）", (await attService.download(actor, a1!.id)).data.length > 0);

  await deleteTestMember("a4-other");
} finally {
  await db.delete(attachment);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  await deleteTestMember(U);
  await rm(process.env.ATTACHMENT_DIR ?? "/tmp/feronavi-attachments", { recursive: true, force: true }).catch(() => {});
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
