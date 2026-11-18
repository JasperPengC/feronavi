/** 第二期前端的 API 封装（计划实体 / 日历 / 时间线 / 工作台 / 待办） */
import { apiGet, apiPost, apiPatch, apiDelete } from "./api.ts";

export interface PlanEntity {
  id: string;
  name: string;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  endDate?: string | null;
  versionTag?: string | null;
  releaseDate?: string | null;
  archivedAt?: string | null;
  progressMode?: string;
  progressValue?: string | null;
  createdAt?: string;
}

export const planning = {
  list: (kind: string, projectId: string) =>
    apiGet<PlanEntity[]>(`/api/v1/projects/${projectId}/${kind}s`),
  create: (kind: string, projectId: string, body: unknown) =>
    apiPost<PlanEntity>(`/api/v1/projects/${projectId}/${kind}s`, body),
  update: (kind: string, id: string, body: unknown) =>
    apiPatch<PlanEntity>(`/api/v1/${kind}s/${id}`, body),
  archive: (kind: string, id: string) =>
    apiPost(`/api/v1/${kind}s/${id}/archive`),
  unarchive: (kind: string, id: string) =>
    apiPost(`/api/v1/${kind}s/${id}/unarchive`),
};

export interface CalendarDay { date: string; items: { id: string; key: string; title: string; type: string }[]; count: number }

// 文档 REST 6 节：视图共用 GET /work-items?view=（calendar 用 dateFrom/dateTo 窗口）
export const calendar = (projectId: string, month: string) => {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return apiGet<{ from: string; to: string; days: CalendarDay[]; unscheduled: number }>(
    `/api/v1/projects/${projectId}/work-items?view=calendar&dateFrom=${from}&dateTo=${to}`);
}

export interface TimelineRow {
  kind: string; id: string; name: string; category: string;
  bars: { id: string; key: string; title: string; startDate: string; dueDate: string }[];
}

export const timeline = (projectId: string, from: string, to: string) =>
  apiGet<{ rows: TimelineRow[] }>(`/api/v1/projects/${projectId}/work-items?view=timeline&dateFrom=${from}&dateTo=${to}`);

export interface WorkbenchItem {
  id: string; key: string; title: string; type: string;
  priority: string | null; dueDate: string | null; version: number; projectKey: string;
}

export interface WorkbenchCrossDomain {
  defects: { total: number; open: number; p0: number; done: number; overdue: number; donePercent: number };
  myOpenDefects: number;
  milestones: { overdue: number; dueSoon: number; items: { id: string; name: string; dueDate: string; projectId: string; projectKey: string }[] };
}
export const workbench = () =>
  apiGet<{ groups: { key: string; name: string; items: WorkbenchItem[]; count: number }[]; total: number; crossDomain: WorkbenchCrossDomain }>(
    "/api/v1/workbench");

export interface Todo { id: string; title: string; dueDate: string | null; done: boolean; doneAt: string | null }

export const todos = {
  list: (done?: boolean) =>
    apiGet<Todo[]>(`/api/v1/todos${done === undefined ? "" : `?done=${done}`}`),
  create: (body: { title: string; dueDate?: string | null }) =>
    apiPost<Todo>("/api/v1/todos", body),
  update: (id: string, body: { title?: string; dueDate?: string | null; done?: boolean }) =>
    apiPatch<Todo>(`/api/v1/todos/${id}`, body),
  remove: (id: string) => apiDelete(`/api/v1/todos/${id}`),
};

// ══ 第三期 API ═══════════════════════════════════════════════

export interface CommentRow {
  id: string; targetType: string; targetId: string;
  authorId: string; body: string; parentId: string | null;
  editedAt: string | null; createdAt: string;
}

// 文档 REST 6 节：评论嵌套在工作项下
export const comments = {
  list: (targetType: string, targetId: string, parentId?: string) =>
    targetType === "WORK_ITEM"
      ? apiGet<CommentRow[]>(`/api/v1/work-items/${targetId}/comments${parentId ? `?parentId=${parentId}` : ""}`)
      : apiGet<CommentRow[]>("/api/v1/comments", { targetType, targetId, ...(parentId ? { parentId } : {}) }),
  create: (body: { targetType: string; targetId: string; body: string; parentId?: string | null }) =>
    body.targetType === "WORK_ITEM"
      ? apiPost<CommentRow>(`/api/v1/work-items/${body.targetId}/comments`, { body: body.body, parentId: body.parentId ?? null })
      : apiPost<CommentRow>("/api/v1/comments", { ...body, parentId: body.parentId ?? null }),
  update: (id: string, body: string) => apiPatch<CommentRow>(`/api/v1/comments/${id}`, { body }),
  remove: (id: string) => apiDelete(`/api/v1/comments/${id}`),
};

export interface NotificationRow {
  id: string; type: string; category: string;
  title: string; body: string; link: string | null;
  readAt: string | null; itemCount: number; createdAt: string;
}

// 文档 REST 10 节：列表内嵌 unreadCount；已读是 POST /notifications/read（可批量/全部）
export const notifications = {
  list: (unreadOnly?: boolean) =>
    apiGet<{ items: NotificationRow[]; unreadCount: number }>(
      `/api/v1/notifications${unreadOnly ? "?unread=true" : ""}`),
  markRead: (ids: string[]) => apiPost("/api/v1/notifications/read", { ids }),
  markAllRead: () => apiPost("/api/v1/notifications/read", { all: true }),
};

export interface TableRow {
  id: string; number: number; key: string; title: string; type: string;
  priority: string | null; dueDate: string | null; version: number; assigneeId?: string | null; statusId?: string | null;
}

export const tableView = (projectId: string, opts: { page?: number; pageSize?: number; sortBy?: string; sortDir?: string; type?: string; priority?: string; unscheduled?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (opts.page) q.set("page", String(opts.page));
  if (opts.pageSize) q.set("pageSize", String(opts.pageSize));
  if (opts.sortBy) q.set("sortBy", opts.sortBy === "dueDate" ? "due_date" : opts.sortBy);
  if (opts.sortDir) q.set("sortDir", opts.sortDir);
  if (opts.type) q.set("type", opts.type);
  if (opts.priority) q.set("priority", opts.priority);
  if (opts.unscheduled !== undefined) q.set("unscheduled", String(opts.unscheduled));
  q.set("view", "table");
  return apiGet<{ rows: TableRow[]; total: number; page: number; pageSize: number }>(
    `/api/v1/projects/${projectId}/work-items?${q.toString()}`);
};
