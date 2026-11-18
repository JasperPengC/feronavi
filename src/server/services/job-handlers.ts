/**
 * 内置任务处理器（Round 25 第 45 项）
 *
 * 注册邮件、IM 通知和全量导出处理器，交给可重试队列执行。
 * 未配置邮件发送视为**成功跳过**（不是失败）—— 自托管实例可能永远不配邮件，
 * 不能因此把队列堆成死信。
 */
import { registerJobHandler } from "./job.service.ts";
import { sendMail } from "./mail.service.ts";
import { writeFullExportPackage } from "./full-export.service.ts";
import { sendToChannel } from "./im.service.ts";

export function registerBuiltinJobHandlers(): void {
  registerJobHandler("email.send", async (payload) => {
    const to = typeof payload.to === "string" ? payload.to : "";
    const subject = typeof payload.subject === "string" ? payload.subject : "";
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!to || !subject) throw new Error("email.send 缺少 to/subject");
    const r = await sendMail({ to, subject, text });
    if (!r.ok && r.reason !== "未配置邮件发送") throw new Error(r.reason ?? "邮件发送失败");
    if (!r.ok) console.warn("[job] 邮件发送未配置，email.send 跳过：", to);
  });

  // IM 通知（Round 76）：notification.service 扇出入队；失败抛错进入重试/死信
  registerJobHandler("im.send", async (payload) => {
    const channelId = typeof payload.channelId === "string" ? payload.channelId : "";
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!channelId || !text) throw new Error("im.send 缺少 channelId/text");
    await sendToChannel(channelId, text);
  });

  // 全量导出包（Round 46）：由 setting:manage 的 POST /system/exports 入队
  registerJobHandler("export.full", async (_payload, row) => {
    const r = await writeFullExportPackage(row.id);
    console.info("[job] 全量导出包已生成:", r.path, `${r.bytes} bytes`);
  });
}
