/** 显式路由表；页面模块仅在访问/预加载对应路由时导入。 */
import { createRootRoute, createRoute, createRouter, Outlet, redirect, lazyRouteComponent } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { apiGet, ApiError } from "./lib/api.ts";
import { authNavigationSearch } from "./lib/auth-navigation.ts";
import { RouteLoadError, RoutePending } from "./components/RouteFeedback.tsx";
import { useCustomScrollbars } from "./lib/useCustomScrollbars.ts";
import { WORKBENCH_GROUP_KEYS, type WorkbenchGroupKey } from "../shared/workbench.ts";

const SetupPage = lazyRouteComponent(() => import("./routes/SetupPage.tsx"), "SetupPage");
const LoginPage = lazyRouteComponent(() => import("./routes/LoginPage.tsx"), "LoginPage");
const ChangePasswordPage = lazyRouteComponent(() => import("./routes/ChangePasswordPage.tsx"), "ChangePasswordPage");
const ResetPasswordPage = lazyRouteComponent(() => import("./routes/ResetPasswordPage.tsx"), "ResetPasswordPage");
const InvitePage = lazyRouteComponent(() => import("./routes/InvitePage.tsx"), "InvitePage");
const AppShell = lazyRouteComponent(() => import("./routes/AppShell.tsx"), "AppShell");
const ProjectListPage = lazyRouteComponent(() => import("./routes/ProjectListPage.tsx"), "ProjectListPage");
const ProjectOverviewPage = lazyRouteComponent(() => import("./routes/ProjectOverviewPage.tsx"), "ProjectOverviewPage");
const IssuesPage = lazyRouteComponent(() => import("./routes/IssuesPage.tsx"), "IssuesPage");
const OrganizationPage = lazyRouteComponent(() => import("./routes/OrganizationPage.tsx"), "OrganizationPage");
const ChangelogPage = lazyRouteComponent(() => import("./routes/ChangelogPage.tsx"), "ChangelogPage");
const BoardPage = lazyRouteComponent(() => import("./routes/BoardPage.tsx"), "BoardPage");
const MilestonesPage = lazyRouteComponent(() => import("./routes/MilestonesPage.tsx"), "MilestonesPage");
const MilestoneDetailPage = lazyRouteComponent(() => import("./routes/MilestoneDetailPage.tsx"), "MilestoneDetailPage");
const CalendarPage = lazyRouteComponent(() => import("./routes/CalendarPage.tsx"), "CalendarPage");
const TimelinePage = lazyRouteComponent(() => import("./routes/TimelinePage.tsx"), "TimelinePage");
const WorkbenchPage = lazyRouteComponent(() => import("./routes/WorkbenchPage.tsx"), "WorkbenchPage");
const WorkbenchGroupPage = lazyRouteComponent(() => import("./routes/WorkbenchGroupPage.tsx"), "WorkbenchGroupPage");
const AssistantPage = lazyRouteComponent(() => import("./routes/AssistantPage.tsx"), "AssistantPage");
const TableViewPage = lazyRouteComponent(() => import("./routes/TableViewPage.tsx"), "TableViewPage");
const WorkflowConfigPage = lazyRouteComponent(() => import("./routes/WorkflowConfigPage.tsx"), "WorkflowConfigPage");
const ProjectAutomationPage = lazyRouteComponent(() => import("./routes/ProjectAutomationPage.tsx"), "ProjectAutomationPage");
const TokensPage = lazyRouteComponent(() => import("./routes/TokensPage.tsx"), "TokensPage");
const MembersPage = lazyRouteComponent(() => import("./routes/MembersPage.tsx"), "MembersPage");
const SettingsPage = lazyRouteComponent(() => import("./routes/SettingsPage.tsx"), "SettingsPage");
const CustomFieldsPage = lazyRouteComponent(() => import("./routes/CustomFieldsPage.tsx"), "CustomFieldsPage");
const ImportPage = lazyRouteComponent(() => import("./routes/ImportPage.tsx"), "ImportPage");
const InsightPage = lazyRouteComponent(() => import("./routes/InsightPage.tsx"), "InsightPage");
const ActivityPage = lazyRouteComponent(() => import("./routes/ActivityPage.tsx"), "ActivityPage");
const AuditLogPage = lazyRouteComponent(() => import("./routes/AuditLogPage.tsx"), "AuditLogPage");
const IdeasPage = lazyRouteComponent(() => import("./routes/IdeasPage.tsx"), "IdeasPage");
const WikiPage = lazyRouteComponent(() => import("./routes/WikiPage.tsx"), "WikiPage");
const SystemPage = lazyRouteComponent(() => import("./routes/SystemPage.tsx"), "SystemPage");
const PortfoliosPage = lazyRouteComponent(() => import("./routes/PortfoliosPage.tsx"), "PortfoliosPage");
const PortfolioDetailPage = lazyRouteComponent(() => import("./routes/PortfolioDetailPage.tsx"), "PortfolioDetailPage");
const AnnouncementsPage = lazyRouteComponent(() => import("./routes/AnnouncementsPage.tsx"), "AnnouncementsPage");
const IntakePage = lazyRouteComponent(() => import("./routes/IntakePage.tsx"), "IntakePage");
const PublicIntakePage = lazyRouteComponent(() => import("./routes/PublicIntakePage.tsx"), "PublicIntakePage");
const NotificationsPage = lazyRouteComponent(() => import("./routes/NotificationsPage.tsx"), "NotificationsPage");
const RoleAdminPage = lazyRouteComponent(() => import("./routes/RoleAdminPage.tsx"), "RoleAdminPage");

function RootLayout() {
  useCustomScrollbars();
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: RootLayout });

/** 启动判定：未初始化 → 向导；已初始化且未登录 → 登录页 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async () => {
    // 状态查询永远可访问（后端已保证），不再需要靠 catch 猜
    const st = await apiGet<{ initialized: boolean }>("/api/v1/setup/state");
    if (!st.initialized) throw redirect({ to: "/setup" });
    throw redirect({ to: "/projects" });
  },
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async () => {
    let initialized: boolean | undefined;
    try {
      initialized = (await apiGet<{ initialized: boolean }>("/api/v1/setup/state")).initialized;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) throw redirect({ to: "/login" });
    }
    if (initialized) throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: authNavigationSearch,
  component: LoginPage,
});

// 公开路由：邮件里的重置链接要能在未登录状态打开
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset",
  component: ResetPasswordPage,
});

// 公开路由：邀请注册页（邮件/管理员分享的链接，未登录打开）
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: InvitePage,
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/change-password",
  validateSearch: authNavigationSearch,
  component: ChangePasswordPage,
});

/** 主应用壳：顶栏 + 侧栏 + 身份注入 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AppShell,
});

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects",
  component: ProjectListPage,
});

const projectOverviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId",
  component: ProjectOverviewPage,
});

const issuesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/issues",
  component: IssuesPage,
});

const globalIssuesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/issues",
  component: IssuesPage,
});

const boardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/board",
  component: BoardPage,
});

const milestoneDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/milestones/$milestoneId",
  component: MilestoneDetailPage,
});

const milestonesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/milestones",
  component: MilestonesPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/calendar",
  component: CalendarPage,
});

const timelineRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/timeline",
  component: TimelinePage,
});

const workflowConfigRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/workflow",
  component: WorkflowConfigPage,
});

const projectAutomationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/automation",
  component: ProjectAutomationPage,
});

const portfoliosRoute = createRoute({ getParentRoute: () => appRoute, path: "/portfolios", component: PortfoliosPage });
const portfolioDetailRoute = createRoute({ getParentRoute: () => appRoute, path: "/portfolios/$id", component: PortfolioDetailPage });
const focusRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/focus",
  // 专注番茄钟已移除：旧链接/收藏统一回到工作台
  beforeLoad: () => { throw redirect({ to: "/workbench", replace: true }); },
});
const announcementsRoute = createRoute({ getParentRoute: () => appRoute, path: "/announcements", component: AnnouncementsPage });

const changelogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/changelog",
  component: ChangelogPage,
});

const systemRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/system",
  component: SystemPage,
});

const settingsPersonalRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/personal",
  component: () => <SettingsPage section="personal" />,
});
const settingsIntegrationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/integrations",
  component: () => <SettingsPage section="integrations" />,
});
const settingsInstanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/instance",
  component: () => <SettingsPage section="instance" />,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  beforeLoad: () => { throw redirect({ to: "/settings/personal", replace: true }); },
});

const wikiRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/wiki",
  validateSearch: (search: Record<string, unknown>) => ({ page: typeof search.page === "string" ? search.page : undefined }),
  component: WikiPage,
});

const ideasRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/ideas",
  component: IdeasPage,
});
const notificationsRoute = createRoute({ getParentRoute: () => appRoute, path: "/notifications", component: NotificationsPage,
  validateSearch: (search: Record<string, unknown>): { item?: string } => typeof search.item === "string" ? { item: search.item } : {},
});
const intakeRoute = createRoute({ getParentRoute: () => appRoute, path: "/projects/$projectId/intake", component: IntakePage });

const insightRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/insights",
  component: InsightPage,
});

const activityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/activity",
  component: ActivityPage,
});

const adminAuditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/audit",
  component: AuditLogPage,
});

const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/import",
  component: ImportPage,
});

const customFieldsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/fields",
  component: CustomFieldsPage,
});

const membersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/members",
  component: MembersPage,
});

const organizationAdminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/organization",
  component: OrganizationPage,
});

const roleAdminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/roles",
  component: RoleAdminPage,
});

const tokensRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tokens",
  component: TokensPage,
});

const tableRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/table",
  component: TableViewPage,
});

const workbenchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/workbench",
  component: WorkbenchPage,
});

const workbenchGroupRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/workbench/$group",
  beforeLoad: ({ params }) => {
    if (!WORKBENCH_GROUP_KEYS.includes(params.group as WorkbenchGroupKey)) throw redirect({ to: "/workbench", replace: true });
  },
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = Number(search.page);
    return { page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : undefined };
  },
  component: WorkbenchGroupPage,
});

const assistantRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assistant",
  validateSearch: (search: Record<string, unknown>): { project?: string; conversation?: string } => ({ project: typeof search.project === "string" && search.project ? search.project : undefined, conversation: typeof search.conversation === "string" && search.conversation ? search.conversation : undefined }),
  component: AssistantPage,
});

const publicIntakeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/intake/$token",
  component: PublicIntakePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute, setupRoute, loginRoute, changePasswordRoute, resetRoute, inviteRoute, publicIntakeRoute,
  appRoute.addChildren([membersRoute, organizationAdminRoute, roleAdminRoute, changelogRoute, projectsRoute, projectOverviewRoute, issuesRoute, globalIssuesRoute, boardRoute, milestonesRoute, milestoneDetailRoute, calendarRoute, timelineRoute, tableRoute, workflowConfigRoute, projectAutomationRoute, wikiRoute, ideasRoute, insightRoute, activityRoute, importRoute, customFieldsRoute, adminAuditRoute, tokensRoute, systemRoute, settingsRoute, settingsPersonalRoute, settingsIntegrationsRoute, settingsInstanceRoute, portfoliosRoute, portfolioDetailRoute, focusRoute, announcementsRoute, intakeRoute, notificationsRoute, workbenchRoute, workbenchGroupRoute, assistantRoute]),
]);

/**
 * 建路由。测试里传入内存历史（jsdom 没有真实导航），生产用浏览器历史。
 */
export function makeRouter(history?: RouterHistory) {
  return createRouter({ routeTree, defaultPreload: "intent", defaultErrorComponent: RouteLoadError, defaultPendingComponent: RoutePending, defaultPendingMinMs: 0,
    defaultViewTransition: typeof window !== "undefined" && window.CSS?.supports?.("selector(:active-view-transition-type(workspace))")
      ? { types: ({ fromLocation, pathChanged }) => fromLocation && pathChanged && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? ["workspace"] : false }
      : false,
    // 同类页面切换项目或公开令牌时，局部选择和草稿属于旧资源；查询参数切换仍保留当前页面。
    defaultRemountDeps: ({ params }) => params,
    ...(history ? { history } : {}) });
}

export const router = makeRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
