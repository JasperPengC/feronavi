/**
 * 工作区页签（Round 69 · 对标 YouQu 多页签工作台）
 *
 * 纯数据层：路径 + i18n 键（不存翻译后的文案，切语言不脏）；只有最后一个页签不可关闭，最多 10 个。
 * 会话级持久化用 sessionStorage：刷新保留、关标签页清空，不跨登录共享。
 */
import { WORKBENCH_GROUP_KEYS, WORKBENCH_GROUP_LABELS, type WorkbenchGroupKey } from "../../shared/workbench.ts";
export interface WorkspaceTab {
  path: string;
  /** i18n 键（如 nav.projects / po.overview） */
  labelKey: string;
}

export const HOME_TAB: WorkspaceTab = { path: "/workbench", labelKey: "nav.overview" };
export const MAX_TABS = 10;
const STORAGE_KEY = "feronavi-workspace-tabs-v1";

const PROJECT_SUFFIX: Record<string, string> = {
  board: "nav.board", table: "nav.table", milestones: "nav.milestones", calendar: "nav.calendar",
  timeline: "nav.timeline", workflow: "nav.workflow", fields: "nav.fields", wiki: "nav.knowledge",
  ideas: "nav.ideas", insights: "nav.insights", activity: "nav.activity", import: "nav.import",
  issues: "issues.projectTitle", intake: "nav.intake", automation: "nav.automation",
};
const PLAIN: Record<string, string> = {
  workbench: "nav.overview", projects: "nav.projects", focus: "nav.focus", members: "nav.members",
  tokens: "nav.tokens", announcements: "nav.announcements", notifications: "nav.notifications",
  settings: "nav.settings", system: "nav.system", portfolios: "nav.portfolios", changelog: "nav.changelog",
  issues: "nav.issues", assistant: "nav.assistant",
};

/** 路径 → i18n 键（导入导出也稳定；未知路径退化为工作区） */
export function tabLabelKey(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean);
  if (seg.length === 0) return "nav.overview";
  if (seg[0] === "workbench" && WORKBENCH_GROUP_KEYS.includes(seg[1] as WorkbenchGroupKey)) return WORKBENCH_GROUP_LABELS[seg[1] as WorkbenchGroupKey];
  if (seg[0] === "projects") {
    if (seg.length === 1) return "nav.projects";
    if (seg.length >= 3 && seg[2] === "milestones" && seg[3]) return "md.title";
    if (seg.length >= 3) return PROJECT_SUFFIX[seg[2]!] ?? "nav.workspace";
    return "po.overview";
  }
  if (seg[0] === "settings" && seg[1]) {
    if (seg[1] === "integrations") return "se.groupIntegrations";
    if (seg[1] === "instance") return "se.groupInstance";
    return "se.groupPersonal";
  }
  if (seg[0] === "admin") {
    if (seg[1] === "organization") return "nav.organization";
    if (seg[1] === "roles") return "nav.roles";
    if (seg[1] === "audit") return "nav.audit";
  }
  return PLAIN[seg[0]!] ?? "nav.workspace";
}

function isTab(v: unknown): v is WorkspaceTab {
  return !!v && typeof v === "object" && typeof (v as WorkspaceTab).path === "string" && typeof (v as WorkspaceTab).labelKey === "string";
}

export function loadTabs(): WorkspaceTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [{ ...HOME_TAB }];
    const parsed = JSON.parse(raw) as unknown;
    const tabs = (Array.isArray(parsed) ? parsed : []).filter(isTab)
      // 旧会话里存过时 labelKey（如 /focus 曾错映射成 nav.workItems）：以当前路由表为准重算
      .map((t) => ({ path: t.path, labelKey: tabLabelKey(t.path) }))
      .slice(0, MAX_TABS);
    return tabs.length > 0 ? tabs : [{ ...HOME_TAB }];
  } catch {
    return [{ ...HOME_TAB }];
  }
}

export function saveTabs(tabs: WorkspaceTab[]): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.slice(0, MAX_TABS))); } catch { /* 隐私模式忽略 */ }
}

/** 打开/激活页签；返回新数组（不再强制首页，只保留当前页） */
export function openTab(tabs: WorkspaceTab[], pathname: string): WorkspaceTab[] {
  const path = pathname.split("?")[0] || "/workbench";
  const next = tabs.some((t) => t.path === path) ? tabs : [...tabs, { path, labelKey: tabLabelKey(path) }];
  // 超出上限时丢最久未用的，但绝不丢当前页
  while (next.length > MAX_TABS) {
    const dropIdx = next.findIndex((t) => t.path !== path);
    if (dropIdx === -1) break;
    next.splice(dropIdx, 1);
  }
  return next;
}

/** 关闭页签；只有最后一个页签不可关闭；关闭当前页时返回相邻页 */
export function closeTab(tabs: WorkspaceTab[], path: string): { tabs: WorkspaceTab[]; nextPath: string | null } {
  if (tabs.length <= 1) return { tabs, nextPath: null };
  const idx = tabs.findIndex((t) => t.path === path);
  if (idx === -1) return { tabs, nextPath: null };
  const rest = tabs.filter((t) => t.path !== path);
  const neighbor = rest[Math.min(idx, rest.length - 1)] ?? { ...HOME_TAB };
  return { tabs: rest, nextPath: neighbor.path };
}

export function resetTabsForTests(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
