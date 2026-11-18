/**
 * 命令面板（⌘K / Ctrl+K）—— 原型 DESIGN-SPEC 第 6 节明确要求保留的交互
 *
 * 三件事必须做对：
 *   1 **键盘优先**：⌘K 打开、↑↓ 选择、Enter 执行、Esc 关闭；打开时锁滚动、关闭后把焦点还回去
 *   2 **只列真实可达目标**：目的地来自路由表（含当前项目的子页），不写"敬请期待"的死项
 *   3 无障碍：`role="dialog"` + `aria-modal` + 结果列表用 listbox/option 语义
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../i18n/index.ts";
import { apiGet } from "../lib/api.ts";
import { useActor } from "../lib/actor.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";

interface PaletteSearchHit {
  type: "work-item" | "project" | "page" | "idea" | "member"; id: string; key: string; title: string; projectId: string; projectKey: string;
}

export interface PaletteItem {
  id: string; label: string; hint?: string; to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  keywords?: string;
  /** 图标与侧栏/项目内导航保持一致（用户要求图标语义正确、全站一致） */
  icon: IconName;
}

/** 全局目的地（与路由表一一对应） */
function globalItems(permissions: string[]): PaletteItem[] {
  const has = (p: string) => permissions.includes(p);
  const items: PaletteItem[] = [
    { id: "workbench", label: t("nav.workbench"), to: "/workbench", keywords: "workbench 工作台 待办", icon: "grid" },
    { id: "projects", label: t("nav.projects"), to: "/projects", keywords: "projects 项目 全部", icon: "layers" },
    { id: "portfolios", label: t("nav.portfolios"), to: "/portfolios", keywords: "portfolio 项目集 组合", icon: "package" },
    { id: "issues", label: t("issues.title"), hint: t("nav.allProjects"), to: "/issues", keywords: "issue 问题 缺陷 bug", icon: "inbox" },
    { id: "members", label: t("nav.members"), to: "/members", keywords: "member 成员 用户 人", icon: "users" },
    { id: "announcements", label: t("nav.announcements"), to: "/announcements", keywords: "announcement 公告 通知", icon: "megaphone" },
    { id: "notifications", label: t("nav.notifications"), to: "/notifications", keywords: "notification 通知 消息", icon: "bell" },
    { id: "changelog", label: t("nav.changelog"), to: "/changelog", keywords: "changelog 更新 日志 release", icon: "file" },
    { id: "tokens", label: t("nav.tokens"), to: "/tokens", keywords: "token 令牌 api", icon: "key" },
    { id: "system", label: t("palette.systemTitle"), to: "/system", keywords: "system 运维 迁移 备份", icon: "system" },
    { id: "settings-personal", label: t("se.groupPersonal"), to: "/settings/personal", keywords: "settings 设置 personal 个人 偏好 外观 主题 语言 通知 安全", icon: "settings" },
  ];
  if (["setting:manage", "ai:configure", "integration:manage"].some(has)) {
    items.push({
      id: "settings-integrations", label: t("se.groupIntegrations"), to: "/settings/integrations", icon: "package",
      keywords: ["settings 设置 integrations 集成 自动化", has("ai:configure") ? "ai 模型 智能" : ""].join(" "),
    });
  }
  if (has("setting:manage") || has("org:manage")) {
    items.push({
      id: "settings-instance", label: t("se.groupInstance"), to: "/settings/instance", icon: "system",
      keywords: ["settings 设置 instance 实例", has("org:manage") ? "organization 组织" : "", has("setting:manage") ? "smtp 邮件 发信 存储 留存" : ""].join(" "),
    });
  }
  if (has("member:manage")) items.push({ id: "organization", label: t("nav.organization"), to: "/admin/organization", keywords: "org 组织 部门 架构", icon: "grid" });
  if (has("role:manage")) items.push({ id: "roles", label: t("nav.roles"), to: "/admin/roles", keywords: "role 角色 权限 rbac", icon: "shield" });
  if (has("audit:read")) items.push({ id: "audit", label: t("nav.audit"), to: "/admin/audit", keywords: "audit 审计 日志", icon: "audit" });
  return items;
}

/** 项目内子页（仅在项目上下文里出现） */
const PROJECT_PAGES: [string, string, string, IconName][] = [
  ["", "nav.projectOverview", "overview 概览 项目", "folder"],
  ["issues", "issues.projectTitle", "issue 问题 缺陷 bug", "inbox"],
  ["activity", "nav.activity", "activity 活动 动态", "activity"],
  ["intake", "nav.intake", "intake 需求 收集", "inbox"],
  ["board", "nav.board", "看板 kanban", "grid"],
  ["table", "nav.table", "表格 table 列表", "table"],
  ["milestones", "nav.milestones", "里程碑 milestone", "flag"],
  ["calendar", "nav.calendar", "日历 calendar", "calendar"],
  ["timeline", "nav.timeline", "时间线 timeline", "timeline"],
  ["wiki", "nav.wiki", "知识库 wiki 文档", "book"],
  ["ideas", "nav.ideas", "想法 idea", "spark"],
  ["insights", "nav.insights", "洞察 燃尽 累积流", "chart"],
  ["import", "nav.import", "导入 import", "file"],
  ["workflow", "nav.workflow", "工作流", "workflow"],
  ["fields", "nav.fields", "自定义字段", "sliders"],
];

export function CommandPalette({ open, onClose, contextProjectId, returnFocusRef }: {
  open: boolean; onClose: () => void; contextProjectId?: string | null; returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const navigate = useNavigate();
  const actor = useActor();
  const locale = useLocale();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(null);
  const listId = useId();

  const projectId = /^\/projects\/([0-9a-f-]{36})(?:\/|$)/.exec(pathname)?.[1] ?? contextProjectId;
  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => apiGet<{ items: { id: string; key: string; name: string }[] }>("/api/v1/projects"),
    enabled: open,
    staleTime: 30_000,
  });
  const needle = q.trim();
  const searchQ = useQuery({
    queryKey: ["palette-search", needle],
    queryFn: () => apiGet<{ items: PaletteSearchHit[] }>("/api/v1/search", { q: needle, limit: 8 }),
    enabled: open && needle.length >= 2,
    staleTime: 10_000,
  });
  const searchItems = useMemo<PaletteItem[]>(() => (searchQ.data?.items ?? []).map((h): PaletteItem => {
    if (h.type === "project") {
      return { id: `search-${h.id}`, label: h.title, hint: h.key ?? undefined, to: "/projects/$projectId",
        params: { projectId: h.id }, keywords: `项目 ${h.key ?? ""}`, icon: "folder" as const };
    }
    if (h.type === "page") {
      return { id: `search-${h.id}`, label: h.title, hint: h.projectKey ?? undefined, to: "/projects/$projectId/wiki",
        params: { projectId: h.projectId! }, search: { page: h.id }, keywords: `文档 ${h.projectKey ?? ""}`, icon: "book" as const };
    }
    if (h.type === "idea") {
      return { id: `search-${h.id}`, label: h.title, hint: t("palette.ideaList", { project: h.projectKey ?? "" }), to: "/projects/$projectId/ideas",
        params: { projectId: h.projectId! }, keywords: `想法 ${h.projectKey ?? ""}`, icon: "spark" as const };
    }
    if (h.type === "member") {
      return { id: `search-${h.id}`, label: h.title, hint: [h.key ? `@${h.key}` : "", t("palette.memberList")].filter(Boolean).join(" · "), to: "/members",
        keywords: `成员 用户 ${h.key ?? ""}`, icon: "users" as const };
    }
    return { id: `search-${h.id}`, label: h.title, hint: `${h.projectKey} · ${h.key}`,
      to: "/projects/$projectId/table", params: { projectId: h.projectId! }, search: { item: h.id },
      keywords: `工作项 ${h.key} ${h.projectKey}`, icon: "inbox" as const };
  }), [searchQ.data, locale]);

  const items = useMemo<PaletteItem[]>(() => {
    const list = globalItems(actor.permissions);
    if (projectId) {
      const project = projects.data?.items?.find((item) => item.id === projectId);
      for (const [seg, key, kw, icon] of PROJECT_PAGES) {
        list.push({ id: `project-${projectId}-${seg || "overview"}`, label: t(key), hint: project?.key,
          to: seg ? `/projects/$projectId/${seg}` : "/projects/$projectId", params: { projectId }, keywords: kw, icon });
      }
    }
    for (const p of projects.data?.items ?? []) {
      list.push({
        id: `p-${p.id}`, label: p.name, hint: p.key, icon: "layers",
        to: "/projects/$projectId/board", params: { projectId: p.id }, keywords: `项目 ${p.key} ${p.name}`,
      });
    }
    return list;
  }, [projectId, projects.data, actor.permissions, locale]);

  const filtered = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return items.slice(0, 9);
    return [...searchItems, ...items.filter((i) => `${i.label} ${i.hint ?? ""} ${i.keywords ?? ""}`.toLowerCase().includes(lower))].slice(0, 12);
  }, [items, q, searchItems]);
  const activeIndex = Math.min(cursor, Math.max(0, filtered.length - 1));
  const activeOptionId = filtered[activeIndex] ? `${listId}-${filtered[activeIndex].id}` : undefined;
  const searching = needle.length >= 2 && searchQ.isFetching;
  const searchFailed = needle.length >= 2 && searchQ.isError && !searching;

  // 打开时聚焦输入、锁滚动；关闭后把焦点还给原来的元素
  useEffect(() => {
    if (!open) return;
    restoreFocus.current = returnFocusRef?.current ?? document.activeElement;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      (restoreFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open, returnFocusRef]);

  useEffect(() => { setCursor(0); }, [q, open]);
  useEffect(() => {
    if (open && activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeOptionId]);
  if (!open) return null;

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    void navigate({ to: item.to, params: item.params, search: item.search } as never);
  }

  return (
    <div className="palette-overlay" role="presentation" onClick={onClose}>
      <div
        className="palette"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.dialog")}
        aria-describedby={`${listId}-scope`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
          if (e.key === "Tab") {
            const targets = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input,button:not([disabled]):not([tabindex="-1"])') ?? [])];
            const first = targets[0], last = targets.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            return;
          }
          // Enter 只在组合框内执行选项，关闭/重试按钮保留原生键盘行为。
          if (e.target !== inputRef.current) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor(Math.min(activeIndex + 1, Math.max(0, filtered.length - 1))); }
          if (e.key === "ArrowUp") { e.preventDefault(); setCursor(Math.max(activeIndex - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); go(filtered[activeIndex]); }
        }}
      >
        <div className="palette-search-row">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={t("palette.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("palette.searchLabel")}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-describedby={`${listId}-scope`}
        />
          <button type="button" className="palette-close icon-button" aria-label={t("common.close")} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <p className="palette-scope" id={`${listId}-scope`}>{t("palette.scopeHint")}</p>
        {searching && <p className="palette-status muted" role="status">{t("palette.searching")}</p>}
        {searchFailed && <div className="palette-status" role="status">
          <p>{t("palette.searchFailed")}</p>
          <button type="button" className="btn btn-sm" onClick={() => { inputRef.current?.focus(); void searchQ.refetch(); }}>{t("palette.retrySearch")}</button>
        </div>}
        <ul className="palette-list" id={listId} role="listbox" aria-label={t("palette.searchLabel")} aria-busy={searching}>
          {filtered.map((i, idx) => (
            <li key={i.id} id={`${listId}-${i.id}`} role="option" aria-selected={idx === activeIndex}>
              <button
                type="button"
                className="palette-item"
                tabIndex={-1}
                title={[i.label, i.hint].filter(Boolean).join(" · ")}
                data-active={idx === activeIndex ? "true" : "false"}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => go(i)}
              >
                <span className="palette-icon" aria-hidden="true"><Icon name={i.icon} size={16} /></span>
                <span className="palette-label">{i.label}</span>
                {i.hint && <span className="palette-hint mono">{i.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && !searching && !searchFailed && <p className="palette-empty muted" role="status">{t("palette.empty")}</p>}
        <p className="palette-keyboard muted">{t("palette.keyboardHint")}</p>
      </div>
    </div>
  );
}
