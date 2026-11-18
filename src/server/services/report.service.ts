/**
 * 项目 PDF 报告（第十四期，规范 P5「导出：全量/个人/PDF 报告」的最后一块）
 *
 * 报告内容刻意只放**可核对的数字**：状态分布、类型分布、迭代进度、逾期清单、近期活动。
 * 不放"智能总结" —— 报告是给人签字用的，数字不能被模型润色。
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { iteration, member, project, projectStatusDef, workItem } from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { buildPdf, type TextBlock } from "../lib/pdf.ts";

const TYPE_LABEL: Record<string, string> = { REQUIREMENT: "需求", TASK: "任务", DEFECT: "缺陷", SUBTASK: "子任务" };

export async function projectReport(actor: Actor, projectId: string): Promise<{ buffer: Buffer; filename: string }> {
  const proj = (await db.select().from(project).where(eq(project.id, projectId)).limit(1))[0];
  if (!proj) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, actor.grants.some((g) => g.scopeType === "ORG")))) {
    throw forbidden();
  }

  /**
   * ⚠️ `project_status_def` **没有 project_id** —— 工作流状态是组织级全局定义，项目通过 workflow 引用。
   * 因此项目维度的过滤只能放在 **join 条件**里，不能放在 where（否则会把没有工作项的状态整行滤掉，
   * 而"某状态 0 项"恰恰是报告要展示的信息）。
   */
  const byStatus = await db.select({
    name: projectStatusDef.name, category: projectStatusDef.category,
    n: sql<number>`count(${workItem.id})::int`,
  }).from(projectStatusDef)
    .leftJoin(workItem, and(
      eq(workItem.statusId, projectStatusDef.id),
      eq(workItem.projectId, projectId),
      isNull(workItem.deletedAt),
    ))
    .groupBy(projectStatusDef.name, projectStatusDef.category, projectStatusDef.sortOrder)
    .orderBy(projectStatusDef.sortOrder);

  const byType = await db.select({ type: workItem.type, n: sql<number>`count(*)::int` })
    .from(workItem).where(and(eq(workItem.projectId, projectId), isNull(workItem.deletedAt)))
    .groupBy(workItem.type);

  // `iteration` 用 completed_at 表示已结束（没有 archived_at）；报告只列未结束的迭代
  const iterations = await db.select({
    name: iteration.name, startDate: iteration.startDate, endDate: iteration.endDate,
  }).from(iteration).where(and(eq(iteration.projectId, projectId), isNull(iteration.completedAt)))
    .orderBy(desc(iteration.startDate)).limit(5);

  const overdue = await db.select({
    key: workItem.key, title: workItem.title, dueDate: workItem.dueDate,
    assignee: member.name,
  }).from(workItem).leftJoin(member, eq(member.id, workItem.assigneeId))
    .where(and(eq(workItem.projectId, projectId), isNull(workItem.deletedAt),
      sql`${workItem.dueDate} < current_date`, sql`${workItem.completedAt} is null`))
    .orderBy(workItem.dueDate).limit(20);

  const total = byStatus.reduce((a, b) => a + b.n, 0);
  const done = byStatus.filter((s) => s.category === "TERMINAL").reduce((a, b) => a + b.n, 0);

  const blocks: TextBlock[] = [
    { text: `${proj.name} 项目报告`, size: 20, bold: true },
    { text: `项目标识：${proj.key} ｜ 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")}（UTC）`, size: 9 },
    { text: `工作项合计 ${total} 项，其中已完成 ${done} 项（完成率 ${total ? Math.round((done / total) * 100) : 0}%）。`, size: 11, gapBefore: 8 },
    { text: "一、状态分布", size: 14, bold: true, gapBefore: 16 },
  ];
  for (const s of byStatus) blocks.push({ text: ` ${s.name}（${s.category}）：${s.n} 项`, size: 11 });
  blocks.push({ text: "二、类型分布", size: 14, bold: true, gapBefore: 16 });
  for (const t of byType) blocks.push({ text: ` ${TYPE_LABEL[t.type] ?? t.type}：${t.n} 项`, size: 11 });
  blocks.push({ text: "三、迭代", size: 14, bold: true, gapBefore: 16 });
  if (iterations.length === 0) blocks.push({ text: " （无进行中的迭代）", size: 11 });
  for (const it of iterations) {
    blocks.push({ text: ` ${it.name}：${it.startDate} → ${it.endDate}`, size: 11 });
  }
  blocks.push({ text: "四、逾期工作项", size: 14, bold: true, gapBefore: 16 });
  if (overdue.length === 0) blocks.push({ text: " （无逾期项）", size: 11 });
  for (const o of overdue) {
    blocks.push({ text: ` ${o.key} ${o.title} 截止 ${o.dueDate} 负责人 ${o.assignee ?? "未指派"}`, size: 11 });
  }
  blocks.push({ text: "说明：本报告只包含可核对的统计数字，不含模型生成的摘要；口径见《数据模型-完整定义》第 6 节。", size: 9, gapBefore: 20 });

  return {
    buffer: buildPdf(blocks, { title: `${proj.name} 项目报告` }),
    filename: `feronavi-report-${proj.key}.pdf`,
  };
}
