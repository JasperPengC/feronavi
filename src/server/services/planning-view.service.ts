/** 日历 / 时间线 / 工作台 服务（S4 / S5） */
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as wiRepo from "../repos/work-item.repo.ts";
import * as projectRepo from "../repos/project.repo.ts";

function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

async function assertVisible(actor: Actor, projectId: string): Promise<void> {
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrgGrant(actor)))) throw forbidden();
}

/**
 * 日历（文档 REST 6 节：`?view=calendar&dateFrom=&dateTo=` 窗口式）。
 * 此前是 month 单参，与文档契约不一致 —— 已改窗口。
 */
export async function calendar(actor: Actor, projectId: string, from: string, to: string) {
  await assertVisible(actor, projectId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new DomainError("VALIDATION", "dateFrom/dateTo 格式应为 YYYY-MM-DD", null);
  }
  if (from > to) throw new DomainError("VALIDATION", "dateFrom 不得晚于 dateTo", null);
  return wiRepo.loadCalendar(projectId, from, to);
}

export async function timeline(actor: Actor, projectId: string, from: string, to: string) {
  await assertVisible(actor, projectId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new DomainError("VALIDATION", "from/to 格式应为 YYYY-MM-DD", null);
  }
  if (from > to) throw new DomainError("VALIDATION", "from 不得晚于 to", null);
  return wiRepo.loadTimeline(projectId, from, to);
}


/** 表格视图（T5）：可见性校验同日历/时间线 */
export async function table(actor: Actor, projectId: string, opts: {
  page?: number; pageSize?: number;
  type?: string; priority?: string; unscheduled?: boolean;
  milestoneId?: string; iterationId?: string; releaseId?: string; moduleId?: string;
  sortBy?: "created_at" | "updated_at" | "due_date" | "priority" | "number";
  sortDir?: "asc" | "desc";
} = {}) {
  await assertVisible(actor, projectId);
  return wiRepo.loadTable(projectId, opts);
}
