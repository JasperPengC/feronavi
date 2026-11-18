/**
 * 活动摘要里的「人类可读目标名」。
 *
 * 为什么需要：活动/审计的 summary 要求是**预渲染文案**（前端不拼装），但评论/附件这类事件的
 * target 只有 UUID。这里统一把目标解析成「工作项 KEY」「文档「标题」」等可读名；
 * 解析不到时退回中性词（绝不把裸 UUID 塞进给用户看的摘要）。
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { page, workItem } from "../../db/schema.ts";

export async function describeTarget(targetType: string, targetId: string): Promise<string> {
  if (targetType === "WORK_ITEM") {
    const rows = await db.select({ key: workItem.key }).from(workItem).where(eq(workItem.id, targetId)).limit(1);
    return rows[0]?.key ? `工作项 ${rows[0].key}` : "工作项";
  }
  if (targetType === "PAGE") {
    const rows = await db.select({ title: page.title }).from(page).where(eq(page.id, targetId)).limit(1);
    return rows[0]?.title ? `文档「${rows[0].title}」` : "文档";
  }
  return "对象";
}
