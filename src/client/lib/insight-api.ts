/** 洞察前端封装（第十期） */
import { apiGet, apiPost, apiPatch, apiDelete } from "./api.ts";

export interface BurndownPoint { date: string; scope: number; done: number; remaining: number; ideal: number; source: string }
export interface Burndown {
  iteration: { id: string; name: string; startDate: string; endDate: string };
  metric: string;
  points: BurndownPoint[];
}
export interface CumulativeFlow {
  iteration: { id: string; name: string; startDate: string; endDate: string };
  metric: string;
  categories: string[];
  series: (Record<string, number | string> & { date: string; total: number })[];
}
export interface Widget { id: string; dashboardId: string; type: string; config: { iterationId?: string }; sortOrder: number; data?: Burndown | CumulativeFlow | null }
export interface Dashboard { id: string; name: string; projectId: string | null; isDefault: boolean; widgets?: Widget[] }

export const insight = {
  burndown: (iterationId: string) => apiGet<Burndown>(`/api/v1/iterations/${iterationId}/burndown`),
  cumulativeFlow: (iterationId: string) => apiGet<CumulativeFlow>(`/api/v1/iterations/${iterationId}/cumulative-flow`),
  dashboards: (projectId: string) => apiGet<{ dashboards: Dashboard[] }>(`/api/v1/dashboards?projectId=${projectId}`),
  dashboard: (id: string) => apiGet<Dashboard>(`/api/v1/dashboards/${id}`),
  createDashboard: (projectId: string, name: string) => apiPost<Dashboard>("/api/v1/dashboards", { name, projectId }),
  deleteDashboard: (id: string) => apiDelete(`/api/v1/dashboards/${id}`),
  addWidget: (dashboardId: string, type: string, config: Record<string, unknown>, sortOrder = 0) =>
    apiPost<Widget>(`/api/v1/dashboards/${dashboardId}/widgets`, { type, config, sortOrder }),
  updateWidget: (id: string, patch: { config?: Record<string, unknown>; sortOrder?: number }) =>
    apiPatch<Widget>(`/api/v1/dashboard-widgets/${id}`, patch),
  deleteWidget: (id: string) => apiDelete(`/api/v1/dashboard-widgets/${id}`),
};
