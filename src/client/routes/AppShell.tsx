/**
 * 主应用壳（S2，设计规格第 3 节）
 *
 * 骨架：
 *   侧栏（chrome）│ 顶栏（chrome，面包屑 + 通知 + 主题 + 身份）
 *                ├──────────────────────────────────────
 *                │ 内收工作台（大圆角，承载主体）
 *                ├──────────────────────────────────────
 *                │ Footer（与工作台连续，不漂浮）
 *
 * 纪律：外壳只负责布局与身份注入，不做任何数据获取（除身份）；页面各自取数。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActorContext, useActorQuery } from "../lib/actor.ts";
import { apiGet, apiPost, ApiError, onSessionExpired } from "../lib/api.ts";
import { NotificationBell } from "./NotificationBell.tsx";
import { PresenceAvatars } from "../components/PresenceAvatars.tsx";
import { useDocumentTitle, useOrg } from "../lib/useOrg.ts";
import { closeTab, loadTabs, openTab, saveTabs, type WorkspaceTab } from "../lib/tabs.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { useEvents } from "../lib/useEvents.ts";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { DialogHost } from "../components/Dialog.tsx";
import { setLocale, t, useLocale } from "../i18n/index.ts";
import { BrandMark } from "../components/BrandMark.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { setTheme } from "../lib/theme.ts";
import { ToastHost, toast } from "../components/ui/Toast.tsx";
import { WorkspaceSwitcher, type ShellProject } from "./WorkspaceSwitcher.tsx";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog.tsx";
import { readSsoReturnTo } from "../lib/auth-navigation.ts";
import { firstGrapheme } from "../lib/first-grapheme.ts";



export function AppShell() {
  const org = useOrg();
  const orgName = org.data?.name?.trim() || t("app.name");
  useDocumentTitle();
  const locale = useLocale(); // 订阅语言并重新计算翻译后的页签宽度
  const { data: actor, isLoading } = useActorQuery();
  useEvents(!!actor, actor?.memberId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useRouterState({ select: (s) => s.location });
  const pathname = location.pathname;
  const sessionLocation = useRef(location);
  sessionLocation.current = location;
  const sessionEnding = useRef(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => onSessionExpired(() => {
    const currentLocation = sessionLocation.current;
    if (sessionEnding.current || currentLocation.pathname === "/login") return;
    sessionEnding.current = true;
    setSessionExpired(true);
    queryClient.clear();
    void navigate({ to: "/login", search: { returnTo: currentLocation.href }, replace: true, ignoreBlocker: true });
  }), [queryClient, navigate]);
  // 从 /projects/<id>/... 里取出当前项目 id，供侧栏显示项目内入口
  // 允许项目概览页 `/projects/:id`（没有尾斜杠）也识别为当前项目 —— 此前只匹配 `/projects/:id/...`，
  // 导致项目概览页页脚仍显示「全部项目」、侧栏不出现当前项目导航（真实验收发现）。
  const routeProjectId = /^\/projects\/([0-9a-f-]{36})(?:\/|$)/.exec(pathname)?.[1];
  /** 用户选中的项目要跨「总览 / 问题追踪 / 项目集」等非项目路由保留；
      只有主动去「全部项目」时才清空。 */
  const PROJECT_STORAGE_KEY = "feronavi.project";
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(PROJECT_STORAGE_KEY); } catch { return null; }
  });
  const projectId = routeProjectId ?? (pathname === "/projects" ? null : pinnedProjectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(() => typeof window !== "undefined"
    && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1024px)").matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationButtonRef = useRef<HTMLButtonElement>(null);
  const navigationCloseRef = useRef<HTMLButtonElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("feronavi-sidebar") === "collapsed"; }
    catch { return false; }
  });
  const sidebarIsCollapsed = sidebarCollapsed && !mobileNavigation;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1024px)");
    const update = () => { setMobileNavigation(media.matches); setMenuOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // 没登录 → 去登录页；初始管理员必须先改密
  useEffect(() => {
    // 路由状态先于旧布局卸载；避免将已进入的登录页再次包成 returnTo。
    if (isLoading || pathname === "/login" || pathname === "/change-password") return;
    if (!actor) { void navigate({ to: "/login", search: { returnTo: location.href }, replace: true }); return; }
    const ssoReturnTo = readSsoReturnTo(true);
    if (actor.mustChangePassword && pathname !== "/change-password") {
      void navigate({ to: "/change-password", search: { returnTo: ssoReturnTo ?? location.href }, replace: true });
    } else if (ssoReturnTo) {
      toast.success(t("login.succeeded"));
      if (ssoReturnTo !== location.href) void navigate({ href: ssoReturnTo, replace: true });
    }
  }, [actor, isLoading, navigate, pathname, location.href]);

  // 进入项目路由时记住它；主动回到「全部项目」时清空
  useEffect(() => {
    if (routeProjectId) {
      setPinnedProjectId(routeProjectId);
      try { window.localStorage.setItem(PROJECT_STORAGE_KEY, routeProjectId); } catch { /* ignore */ }
    } else if (pathname === "/projects") {
      setPinnedProjectId(null);
      try { window.localStorage.removeItem(PROJECT_STORAGE_KEY); } catch { /* ignore */ }
    }
  }, [routeProjectId, pathname]);

  // 路由切换后自动收起移动端抽屉
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  /** 路由切换把主体滚动区复位到顶部；否则从长页跳短页会保留上一页滚动位置，
      标题/页头位置在不同页面之间漂移。 */
  useEffect(() => {
    const content = document.querySelector<HTMLElement>(".shell-content > .page") ?? document.querySelector<HTMLElement>(".shell-content");
    // jsdom 没有 scrollTo；同时避免非浏览器环境直接抛错把整页打崩
    if (content && typeof content.scrollTo === "function") {
      content.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [pathname]);


  useEffect(() => {
    if (!menuOpen || !mobileNavigation) return;
    navigationCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const sidebar = sidebarRef.current;
      if (event.key === "Escape") {
        // 项目选择菜单先处理自身的 Escape，下一次才关闭整个导航。
        if (sidebar?.querySelector('[role="menu"]')) return;
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const targets = [...sidebar.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter((element) => {
          if (element.closest("[hidden], [inert]")) return false;
          for (let node: HTMLElement | null = element; node && node !== sidebar; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return false;
          }
          return true;
        });
      const first = targets[0], last = targets.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      navigationButtonRef.current?.focus();
    };
  }, [menuOpen, mobileNavigation]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".profile-trigger, .shell-user-menu")) return;
      setUserMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [userMenuOpen]);

  // 语言跟随**账号偏好**（不是浏览器语言）——登录后每次 actor 变化都同步一次
  useEffect(() => {
    if (!actor) return;
    setLocale(actor.locale);
    // ⚠️ 主题此前只在客户端 cookie 里，**账号偏好从未被读取** → 在设置里切浅色界面不变。
    // 服务端值域是 system/light/dark，客户端是 auto/light/dark —— setTheme 内部归一化（system→auto），
    // 否则旧实现会直接把 "system" 当 auto 判定失败、强制浅色（真实 bug：跟随系统永远日间）。
    // setTheme 会同步写 cookie，因此下次加载时防 FOUC 的内联脚本也能读到同一取值。
    if (actor.theme) setTheme(actor.theme);
  }, [actor]);

  /** 与项目列表共用缓存，新建、改名或归档后的失效更新也同步到切换器。 */
  const projectList = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => apiGet<{ items: ShellProject[]; total: number }>("/api/v1/projects"),
    enabled: !!actor,
    retry: false,
  });
  const projects = projectList.data?.items ?? [];
  const shellProjectCount = projects.length > 0 ? projects.length : undefined;

  /** 底部服务状态：真实 `/system/status`（不是"已同步"这种假文案） */
  const [service, setService] = useState<{ ok: boolean; version: string } | null>(null);
  /** 仅正式环境比较本次会话的构建基线；开发页面由 Vite 更新，不受 dist 构建影响。 */
  const bootBuildRef = useRef<string | null>(null);
  const [newBuildId, setNewBuildId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => apiGet<{ ok: boolean; version: string; buildVersion?: string }>("/api/v1/system/status")
      .then((d) => {
        if (!alive) return;
        setService(d);
        if (import.meta.env.PROD && d.buildVersion && d.buildVersion !== "dev") {
          if (bootBuildRef.current === null) bootBuildRef.current = d.buildVersion;
          setNewBuildId(bootBuildRef.current !== d.buildVersion ? d.buildVersion : null);
        }
      }).catch(() => { if (alive) setService({ ok: false, version: "—" }); });
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // 工作区页签（Round 69 对标）：路径变化即打开/激活；会话级持久化
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>(() => loadTabs());
  const tabbarRef = useRef<HTMLDivElement | null>(null);
  const [tabbarWidth, setTabbarWidth] = useState(0);
  // 宽度变化时保留尽可能多的页签；放不下的折叠进右侧 »N 菜单，当前页始终可见
  useEffect(() => {
    const node = tabbarRef.current;
    if (!node) return;
    const measure = () => setTabbarWidth(node.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [actor]);
  const maxVisibleTabs = useMemo(() => {
    const available = Math.max(120, (tabbarWidth || 900) - 46); // 46 = 溢出按钮/间距
    let used = 0;
    let count = 0;
    for (const tab of workspaceTabs) {
      const label = workspaceTabPresentation(tab, projects, projectId).label;
      const textWidth = [...label].reduce((width, char) => width + (char.charCodeAt(0) > 127 ? 12 : 7), 0);
      const estimate = Math.min(180, Math.max(58, textWidth + 42));
      if (count > 0 && used + estimate > available) break;
      used += estimate;
      count += 1;
    }
    return Math.max(1, count);
  }, [tabbarWidth, workspaceTabs, projects, projectId, locale]);
  const [tabOverflowOpen, setTabOverflowOpen] = useState(false);
  const [tabMenuPos, setTabMenuPos] = useState<{ top: number; right: number } | null>(null);
  const tabOverflowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const tabOverflowMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tabOverflowOpen) return;
    const menu = tabOverflowMenuRef.current;
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu?.contains(event.target) && !tabOverflowTriggerRef.current?.contains(event.target)) setTabOverflowOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setTabOverflowOpen(false);
        tabOverflowTriggerRef.current?.focus();
      } else if (event.key === "Tab") {
        setTabOverflowOpen(false);
        tabOverflowTriggerRef.current?.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    const onResize = () => { setTabOverflowOpen(false); tabOverflowTriggerRef.current?.focus(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [tabOverflowOpen]);
  const activeIdx = workspaceTabs.findIndex((t) => t.path === pathname);
  const activeTab = activeIdx >= 0 ? workspaceTabs[activeIdx] : undefined;
  const visibleTabs = workspaceTabs.length <= maxVisibleTabs
    ? workspaceTabs
    : activeTab && activeIdx < maxVisibleTabs
      ? workspaceTabs.slice(0, maxVisibleTabs)
      : [...workspaceTabs.slice(0, maxVisibleTabs - 1), ...(activeTab ? [activeTab] : [])];
  const overflowTabs = workspaceTabs.filter((t) => !visibleTabs.includes(t));
  useEffect(() => {
    setWorkspaceTabs((prev) => {
      const next = openTab(prev, pathname);
      saveTabs(next);
      return next;
    });
  }, [pathname]);
  const closeWorkspaceTab = (path: string) => {
    const { tabs: rest, nextPath } = closeTab(workspaceTabs, path);
    setWorkspaceTabs(rest);
    saveTabs(rest);
    if (path === pathname && nextPath) void navigate({ to: nextPath as never });
  };
  // 侧栏一级菜单（Round 109）：行业常见「一级 + 可展开子菜单」，去掉重复的分组标题
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("feronavi.nav.v4");
      if (raw) return { project: true, currentProject: true, projectSettings: false, manage: false, platform: false, settings: true, ...JSON.parse(raw) };
    } catch { /* 隐私模式/损坏数据时用默认 */ }
    return { project: true, currentProject: true, projectSettings: false, manage: false, platform: false, settings: true };
  });
  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem("feronavi.nav.v4", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  useEffect(() => {
    const projectSettingsPath = ["/fields", "/workflow", "/intake", "/import", "/automation"].some((suffix) => pathname.endsWith(suffix));
    const group = pathname.startsWith("/projects")
      ? projectSettingsPath ? "projectSettings" : projectId ? "currentProject" : "project"
      : pathname === "/settings" || pathname.startsWith("/settings/") ? "settings"
      : pathname.startsWith("/members") || pathname.startsWith("/admin/") || ["/system", "/tokens"].some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? "manage"
      : ["/announcements", "/notifications", "/changelog"].some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? "platform" : null;
    if (group) {
      setOpenGroups((prev) => {
        if (prev[group]) return prev;
        const next = { ...prev, [group]: true };
        try { localStorage.setItem("feronavi.nav.v4", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }
  }, [pathname]);

  if (sessionExpired) return null;
  if (isLoading) return <ShellLoading />;
  if (!actor) return null;

  // 面包屑当前页文案复用页签映射，避免“问题追踪/组织架构/里程碑详情”退化成“工作区”
  const currentProject = projectId ? projects.find((p) => p.id === projectId) ?? null : null;
  const canReadAudit = actor.permissions.includes("audit:read");
  const canManageOrgStructure = actor.permissions.includes("member:manage")
    && actor.dataScopes.some((scope) => scope.scopeType === "ORG");
  const canManageOrganizationRoles = actor.permissions.includes("role:manage")
    && actor.dataScopes.some((scope) => scope.scopeType === "ORG");
  const canSettingsIntegrations = ["setting:manage", "ai:configure", "integration:manage"].some((p) => actor.permissions.includes(p));
  const canSettingsInstance = actor.permissions.includes("setting:manage") || actor.permissions.includes("org:manage");
  const projectSwitcher = <WorkspaceSwitcher orgName={orgName} projects={projects} currentProjectId={projectId ?? null}
    currentProjectName={currentProject?.name ?? null}
    onSelectProject={(id) => {
      setPinnedProjectId(id);
      try { window.localStorage.setItem(PROJECT_STORAGE_KEY, id); } catch { /* ignore */ }
    }}
    onSelectAll={() => {
      setPinnedProjectId(null);
      try { window.localStorage.removeItem(PROJECT_STORAGE_KEY); } catch { /* ignore */ }
    }} />;
  const openCommandPalette = () => {
    paletteReturnFocusRef.current = mobileNavigation && menuOpen ? navigationButtonRef.current : document.activeElement as HTMLElement | null;
    setMenuOpen(false); setPaletteOpen(true);
  };

  /**
   * 侧栏条目：**图标 + 名称 + 右侧计数**（原型的关键特征 —— 只有名称的侧栏看起来像文档目录，
   * 不像产品导航）。计数**只用真实数据**：目前项目数来自已在缓存里的 `["projects"]` 查询；
   * 拿不到真实数字的条目**宁可不显示计数**，也不填假数。
   */
  const navItem = (to: string, label: string, active: boolean,
                   opts?: { icon?: IconName; count?: number; params?: { projectId: string } }) => (
    <Link
      key={to}
      to={to as "/workbench"}
      params={opts?.params as never}
      className="shell-nav-item"
      data-active={active ? "true" : "false"}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
    >
      <Icon name={opts?.icon ?? "folder"} />
      <span className="shell-nav-label">{label}</span>
      {/* 计数只用真实数据；没有真实数字时**什么都不显示**，不填假数 */}
      {typeof opts?.count === "number" && <span className="shell-nav-count">{opts.count}</span>}
    </Link>
  );

  const navGroup = (id: string, label: string, icon: IconName, active: boolean, children: React.ReactNode) => (
    <div className="nav-group" data-nav-group={id}>
      <button
        type="button"
        className={`nav-group-toggle${active ? " is-active" : ""}`}
        aria-expanded={!!openGroups[id]}
        aria-controls={`nav-group-${id}`}
        aria-label={label}
        title={label}
        onClick={() => {
          if (sidebarIsCollapsed) {
            setSidebarCollapsed(false);
            // 折叠态点分组：展开侧栏并确保该组是打开的，而不是顺手把它关掉
            if (!openGroups[id]) toggleGroup(id);
            return;
          }
          toggleGroup(id);
        }}
      >
        <Icon name={icon} />
        <span className="nav-group-label">{label}</span>
        <span className="nav-group-chevron" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
      </button>
      <div className="nav-group-items" id={`nav-group-${id}`} hidden={!openGroups[id]}>{children}</div>
    </div>
  );

  return (
    <ActorContext.Provider value={actor}>
      <div className={`shell app-frame${sidebarIsCollapsed ? " sidebar-collapsed" : ""}`}>
        <a className="skip-link" href="#main-content" inert={paletteOpen || (mobileNavigation && menuOpen)}>{t("common.skipToContent")}</a>
        <aside ref={sidebarRef} id="main-navigation" className="shell-sidebar sidebar" data-custom-scroll data-open={menuOpen ? "true" : "false"}
          role={mobileNavigation ? "dialog" : undefined} aria-modal={mobileNavigation && menuOpen ? true : undefined}
          aria-hidden={paletteOpen || (mobileNavigation && !menuOpen) ? true : undefined} inert={paletteOpen || (mobileNavigation && !menuOpen)} aria-label={t("nav.main")}>
          <div className="sidebar-top">
            <Link className="product-mark" to="/workbench" aria-label={t("app.name")}>
              <BrandMark className="brand-mark" />
              <strong>{t("app.name")}</strong>
            </Link>
            <button ref={navigationCloseRef} className="icon-button sidebar-close-mobile" type="button" aria-label={t("header.closeNav")} onClick={() => setMenuOpen(false)}>
              <Icon name="x" />
            </button>
          </div>

          {mobileNavigation && <div className="shell-sidebar-project">{projectSwitcher}</div>}

          <nav className="main-nav shell-main-nav" aria-label={t("nav.main")}>
            {navItem("/workbench", t("nav.overview"), pathname.startsWith("/workbench"), { icon: "grid" })}
            {navItem("/assistant", t("nav.assistant"), pathname.startsWith("/assistant"), { icon: "book" })}
            {navGroup("project", t("nav.projectsShort"), "layers",
              pathname === "/projects" || pathname.startsWith("/portfolios"),
              <>
                {navItem("/projects", t("nav.allProjects"), pathname === "/projects", { count: shellProjectCount, icon: "list" })}
                {navItem("/portfolios", t("nav.portfolios"), pathname.startsWith("/portfolios"), { icon: "package" })}
              </>
            )}
            {projectId && navGroup("currentProject", t("nav.group.currentProject"), "folder",
              pathname.startsWith(`/projects/${projectId}`) && !["/fields", "/workflow", "/intake", "/import", "/automation"].some((suffix) => pathname.endsWith(suffix)),
              <>
                {navItem("/projects/$projectId", t("nav.projectOverview"), pathname === `/projects/${projectId}`, { params: { projectId }, icon: "folder" })}
                {navItem("/projects/$projectId/board", t("nav.workItems"), ["/board", "/table", "/timeline", "/calendar"].some((suffix) => pathname === `/projects/${projectId}${suffix}`), { params: { projectId }, icon: "grid" })}
                {navItem("/projects/$projectId/milestones", t("nav.milestones"), pathname === `/projects/${projectId}/milestones`, { params: { projectId }, icon: "flag" })}
                {navItem("/projects/$projectId/wiki", t("nav.knowledge"), pathname === `/projects/${projectId}/wiki`, { params: { projectId }, icon: "book" })}
                {navItem(`/projects/${projectId}/insights` as "/projects/$projectId/insights", t("nav.insights"), pathname === `/projects/${projectId}/insights`, { params: { projectId }, icon: "chart" })}
                {navItem("/projects/$projectId/activity", t("nav.activity"), pathname === `/projects/${projectId}/activity`, { params: { projectId }, icon: "activity" })}
              </>
            )}
            {projectId && navGroup("projectSettings", t("nav.group.projectSettings"), "sliders",
              ["/fields", "/workflow", "/intake", "/import", "/automation"].some((suffix) => pathname === `/projects/${projectId}${suffix}`),
              <>
                {navItem("/projects/$projectId/fields", t("nav.fields"), pathname === `/projects/${projectId}/fields`, { params: { projectId }, icon: "sliders" })}
                {navItem("/projects/$projectId/workflow", t("nav.workflow"), pathname === `/projects/${projectId}/workflow`, { params: { projectId }, icon: "workflow" })}
                {navItem("/projects/$projectId/automation", t("nav.automation"), pathname === `/projects/${projectId}/automation`, { params: { projectId }, icon: "sliders" })}
                {navItem("/projects/$projectId/intake", t("nav.intake"), pathname === `/projects/${projectId}/intake`, { params: { projectId }, icon: "inbox" })}
                {navItem("/projects/$projectId/import", t("nav.import"), pathname === `/projects/${projectId}/import`, { params: { projectId }, icon: "download" })}
              </>
            )}
            {navItem("/issues", t("issues.title"), pathname === "/issues", { icon: "inbox" })}
            {navGroup("manage", t("nav.manage"), "shield",
              pathname.startsWith("/members") || pathname.startsWith("/admin/") || pathname.startsWith("/system") || pathname.startsWith("/tokens"),
              <>
                {navItem("/members", t("nav.members"), pathname.startsWith("/members"), { icon: "users" })}
                {canManageOrgStructure && navItem("/admin/organization", t("nav.organization"), pathname.startsWith("/admin/organization"), { icon: "grid" })}
                {canManageOrganizationRoles && navItem("/admin/roles", t("nav.roles"), pathname.startsWith("/admin/roles"), { icon: "shield" })}
                {canReadAudit && navItem("/admin/audit", t("nav.audit"), pathname.startsWith("/admin/audit"), { icon: "audit" })}
                {navItem("/system", t("nav.system"), pathname.startsWith("/system"), { icon: "system" })}
                {navItem("/tokens", t("nav.tokens"), pathname.startsWith("/tokens"), { icon: "key" })}
              </>
            )}
            {navGroup("settings", t("nav.settings"), "settings",
              pathname.startsWith("/settings"),
              <>
                {navItem("/settings/personal", t("se.groupPersonal"), pathname === "/settings/personal", { icon: "settings" })}
                {canSettingsIntegrations && navItem("/settings/integrations", t("se.groupIntegrations"), pathname === "/settings/integrations", { icon: "package" })}
                {canSettingsInstance && navItem("/settings/instance", t("se.groupInstance"), pathname === "/settings/instance", { icon: "system" })}
              </>
            )}
            {navGroup("platform", t("nav.group.platform"), "megaphone",
              ["/announcements", "/notifications", "/changelog"].some((p) => pathname === p || pathname.startsWith(`${p}/`)),
              <>
                {navItem("/announcements", t("nav.announcements"), pathname.startsWith("/announcements"), { icon: "megaphone" })}
                {navItem("/notifications", t("nav.notifications"), pathname.startsWith("/notifications"), { icon: "bell" })}
                {navItem("/changelog", t("nav.changelog"), pathname.startsWith("/changelog"), { icon: "file" })}
              </>
            )}
          </nav>

        </aside>

        {!mobileNavigation && <button
          type="button"
          className="sidebar-collapse-toggle icon-button"
          aria-label={sidebarCollapsed ? t("header.expandSidebar") : t("header.collapseSidebar")}
          title={sidebarCollapsed ? t("header.expandSidebar") : t("header.collapseSidebar")}
          aria-controls="main-navigation"
          aria-expanded={!sidebarCollapsed}
          inert={paletteOpen}
          onClick={() => {
            const next = !sidebarCollapsed;
            setSidebarCollapsed(next);
            try { window.localStorage.setItem("feronavi-sidebar", next ? "collapsed" : "expanded"); } catch { /* ignore */ }
          }}
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 8H3m3.5-3.5L3 8l3.5 3.5" />
          </svg>
        </button>}

        {mobileNavigation && menuOpen && <button
          className="shell-scrim"
          type="button"
          tabIndex={-1}
          data-open="true"
          aria-label={t("nav.close")}
          onClick={() => setMenuOpen(false)}
        />}

        {/* ⌘K / Ctrl+K：全局快捷键在壳里注册一次，页面无需各自处理 */}
        <ShellHotkeys onOpen={openCommandPalette} />
        <DialogHost />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} contextProjectId={projectId} returnFocusRef={paletteReturnFocusRef} />
        <ToastHost />
        <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />

        <div className="shell-main-col app-main" inert={paletteOpen || (mobileNavigation && menuOpen)}>
          <header className="shell-header topbar">
            <div className="shell-header-left">
              <button
                ref={navigationButtonRef}
                type="button"
                className="shell-menu-button btn btn-icon"
                aria-label={t("header.openNav")}
                aria-controls="main-navigation"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Icon name="menu" />
              </button>
              {!mobileNavigation && <div className="shell-header-project">{projectSwitcher}</div>}
            </div>

            <div ref={tabbarRef} className="shell-tabbar-space">
            <nav className="shell-tabbar shell-header-tabs" aria-label={t("tabs.label")}>
              {visibleTabs.map((tab) => {
                const { label, title, accessibleLabel } = workspaceTabPresentation(tab, projects, projectId);
                return (
                <div key={tab.path} className="shell-tab" data-active={pathname === tab.path ? "true" : "false"}>
                  <Link aria-current={pathname === tab.path ? "page" : undefined} className="shell-tab-link"
                    to={tab.path as "/workbench"} title={title} aria-label={accessibleLabel}>
                    {label}
                  </Link>
                  {workspaceTabs.length > 1 && (
                    <button type="button" className="shell-tab-close" aria-label={`${t("tabs.close")} ${accessibleLabel}`}
                      onClick={() => closeWorkspaceTab(tab.path)}><Icon name="x" size={12} /></button>
                  )}
                </div>
                );
              })}
              {overflowTabs.length > 0 && (
                <div className="shell-tab-overflow" data-open={tabOverflowOpen ? "true" : "false"}>
                  <button ref={tabOverflowTriggerRef} type="button" className="shell-tab-overflow-btn" aria-haspopup="menu" aria-controls={tabOverflowOpen ? "workspace-tab-overflow" : undefined}
                    aria-expanded={tabOverflowOpen}
                    aria-label={`${t("tabs.overflow")}（${overflowTabs.length}）`}
                    onClick={(e) => {
                      if (tabOverflowOpen) { setTabOverflowOpen(false); return; }
                      const r = e.currentTarget.getBoundingClientRect();
                      setTabMenuPos({ top: r.bottom + 6, right: Math.max(12, window.innerWidth - r.right) });
                      setTabOverflowOpen(true);
                    }}><Icon name="more" size={14} /><span className="shell-tab-overflow-count" aria-hidden="true">{overflowTabs.length}</span></button>
                  {tabOverflowOpen && createPortal(
                    <div ref={tabOverflowMenuRef} id="workspace-tab-overflow" className="shell-tab-overflow-menu" role="menu" aria-label={t("tabs.overflow")}
                      style={tabMenuPos ? { position: "fixed", top: tabMenuPos.top, right: tabMenuPos.right } : undefined}>
                      {overflowTabs.map((tab) => {
                        const { label, title } = workspaceTabPresentation(tab, projects);
                        return (
                        <div key={tab.path} className="shell-tab-overflow-row" role="none">
                          <button type="button" role="menuitem" className="shell-tab-overflow-link" title={title}
                            onClick={() => { setTabOverflowOpen(false); navigate({ to: tab.path as "/workbench" }); }}>
                            {label}
                          </button>
                          {workspaceTabs.length > 1 && (
                            <button type="button" role="menuitem" className="shell-tab-overflow-close"
                              aria-label={`${t("tabs.close")} ${label}`}
                              onClick={() => {
                                closeWorkspaceTab(tab.path);
                                setTabOverflowOpen(false);
                                window.requestAnimationFrame(() => (tabOverflowTriggerRef.current ?? tabbarRef.current?.querySelector<HTMLElement>('[aria-current="page"]'))?.focus());
                              }}><Icon name="x" size={12} /></button>
                          )}
                        </div>
                        );
                      })}
                    </div>, document.body
                  )}
                </div>
              )}
            </nav>
            </div>

            <PresenceAvatars />
            <button type="button" className="search-trigger shell-search" aria-label={t("header.searchOrJump")} onClick={openCommandPalette}>
              <Icon name="search" />
              <span className="shell-search-text">{t("header.searchOrJump")}</span>
              <kbd>⌘ K</kbd>
            </button>
            <div className="topbar-actions shell-header-actions">
              <NotificationBell />
              <ThemeToggle />
              <button
                type="button"
                className="avatar avatar-violet profile-trigger"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label={t("header.account")}
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                {firstGrapheme(actor.name, actor.username)}
              </button>
            {userMenuOpen && (
              <div className="shell-user-menu" role="menu" aria-label={t("header.account")}>
                <div className="shell-user-menu-profile">
                  <span className="avatar avatar-violet shell-user-menu-avatar" aria-hidden="true">
                    {firstGrapheme(actor.name, actor.username)}
                  </span>
                  <div className="shell-user-menu-identity">
                    <strong>{actor.name}</strong>
                    <small>@{actor.username}</small>
                    <PresenceAvatars countOnly />
                  </div>
                </div>
                <div className="shell-user-menu-divider" aria-hidden="true" />
                {/* 跳转必须用真链接：可中键新开、可复制地址、读屏为链接（用户要求第 2 条） */}
                <Link role="menuitem" className="shell-user-menu-item" to="/settings/personal"
                  onClick={() => setUserMenuOpen(false)}>
                  <Icon name="settings" />{t("se.groupPersonal")}
                </Link>
                <button role="menuitem" className="shell-user-menu-item"
                  onClick={() => { setUserMenuOpen(false); setPasswordOpen(true); }}>
                  <Icon name="key" />{t("header.changePassword")}
                </button>
                <div className="shell-user-menu-divider" aria-hidden="true" />
                <button role="menuitem" className="shell-user-menu-item is-danger"
                  onClick={async () => {
                    setUserMenuOpen(false);
                    try {
                      await apiPost("/api/v1/auth/logout");
                      await queryClient.cancelQueries();
                      await navigate({ to: "/login", replace: true });
                      queryClient.clear();
                    } catch (error) {
                      toast.error(error instanceof ApiError ? error.message : t("header.logoutFailed"));
                    }
                  }}>
                  <Icon name="logout" />{t("header.logout")}
                </button>
              </div>
            )}
            </div>
          </header>

          <div className="shell-workbench">
            <main id="main-content" tabIndex={-1} className="shell-content content-shell" data-custom-scroll>
              <Outlet />
            </main>
          </div>
          <footer className="app-footer shell-footer">
            <div className="footer-zone footer-left">
              <span className="footer-brand">{t("app.name")}</span>
              {orgName && <span className="footer-org">{orgName}</span>}
            </div>
            <div className="footer-zone footer-center">
              <span className="footer-project">{currentProject ? `${t("footer.currentProject")}：${currentProject.name}` : t("footer.allProjects")}</span>
            </div>
            <div className="footer-zone footer-right">
              <Link className="footer-link" to="/changelog">{t("nav.changelog")}</Link>
              <span className="footer-service" title={t("footer.serviceHint")}>
                <i className={`footer-status-dot${service?.ok ? " is-ok" : " is-down"}`} aria-hidden="true" />
                <span>{service?.ok ? t("footer.serviceOk") : t("footer.serviceDown")}</span>
              </span>
              {newBuildId ? (
                <button type="button" className="footer-update" title={t("footer.updateAvailable")} onClick={() => window.location.reload()}>
                  <Icon name="refresh" size={14} />
                  <span>{t("footer.refreshNow")}</span>
                </button>
              ) : <span className="footer-version">v{service?.version ?? "—"}</span>}
            </div>
          </footer>
        </div>
      </div>
    </ActorContext.Provider>
  );
}

/** 全局快捷键：⌘K / Ctrl+K 打开命令面板。写在壳里，避免每页重复注册。 */
function ShellHotkeys({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || document.querySelector(".ui-drawer-scrim, .ui-modal-scrim, .modal-scrim")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
  return null;
}


/** 壳层加载：一个安静的品牌加载态，不画线框骨架。 */
function ShellLoading() {
  return (
    <div className="shell-loading" role="status" aria-busy="true" aria-live="polite">
      <div className="shell-loading-brand-mark"><BrandMark className="shell-loading-logo" /></div>
      <strong>Feronavi</strong>
      <span className="shell-loading-label">{t("common.loading")}</span>
      <span className="shell-loading-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}

/** 页签用简短项目编号区分同名视图，完整项目名放在悬停提示里。 */
function workspaceTabPresentation(tab: WorkspaceTab, projects: ShellProject[], currentProjectId?: string | null) {
  const projectId = /^\/projects\/([^/]+)(?:\/|$)/.exec(tab.path)?.[1];
  const project = projects.find((item) => item.id === projectId);
  const label = t(tab.labelKey);
  return {
    label: project && projectId !== currentProjectId ? `${project.key} · ${label}` : label,
    accessibleLabel: project ? `${project.key} · ${label}` : label,
    title: project ? `${project.name} · ${label}` : label,
  };
}
