// 仅用于布局验收：真实应用和登录会话，拦截列表读取以覆盖长列表/空态，不写业务库。
export async function installTableFixtures(page, project) {
  const state = { count: 65 };
  const rows = (make, limit = state.count, offset = 0) => Array.from({ length: Math.min(state.count, limit) }, (_, n) => {
    const i = n + offset;
    return { id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, ...make(i) };
  });
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url()), path = url.pathname;
    const pageNo = Number(url.searchParams.get("page") || 1);
    const size = Number(url.searchParams.get("pageSize") || 30);
    const now = new Date().toISOString();
    const names = ["林知夏", "陈远", "周可", "徐宁"];
    const titles = ["登录后保留上次打开的项目", "修复移动端筛选栏遮挡", "导入记录支持查看失败原因", "成员权限调整与变更记录", "整理项目文档和交付清单", "客户反馈：较长的工作项名称在小屏幕上应完整可读，同时避免挤压其他字段"];
    const date = i => new Date(Date.now() - i * 37 * 60_000).toISOString();
    const audits = [
      { action: "auth.login", severity: "SECURITY", targetType: "MEMBER", changes: null },
      { action: "work_item.updated", severity: "BUSINESS", targetType: "WORK_ITEM", changes: { title: "修复导入状态显示" } },
      { action: "role.granted", severity: "SECURITY", targetType: "ROLE_ASSIGNMENT", changes: { roleId: "project-manager", scopeType: "PROJECT" } },
      { action: "auth.logout", severity: "SECURITY", targetType: "MEMBER", changes: null },
      { action: "project.created", severity: "BUSINESS", targetType: "PROJECT", changes: { name: "客户协作平台" } },
      { action: "auth.login_failed", severity: "SECURITY", targetType: "MEMBER", changes: null },
      { action: "extension.custom_event", severity: "BUSINESS", targetType: "EXTENSION", changes: { reason: "未知扩展事件保留原始标识" } },
    ];
    const members = () => rows(i => ({ name: names[i % names.length] + (i >= names.length ? ` ${i + 1}` : ""), username: `member${i + 1}`, email: `member${i + 1}@example.invalid`, status: i % 7 === 6 ? "DISABLED" : "ACTIVE", load: i % 8, roles: [{ key: "member", name: i % 3 === 0 ? "项目管理员" : "项目成员", scopeType: "PROJECT" }], departmentName: "产品研发", positionName: "工程师" }));
    let json;
    if (path === "/api/v1/audit-entries") json = { items: rows(i => ({ ...audits[i % audits.length], actorSnapshot: names[i % names.length], actorId: "00000000-0000-4000-8000-000000000001", targetId: "00000000-0000-4000-8000-000000000002", createdAt: date(i), ip: i % 3 ? "192.168.1.28" : "127.0.0.1", userAgent: "Mozilla/5.0" }), size, (pageNo - 1) * size), total: state.count };
    else if (path === "/api/v1/projects") json = { items: rows(i => ({ ...project, id: i === 0 ? project.id : `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`, name: ["客户协作平台", "移动端体验改进", "开放接口与数据集成", "团队知识库"][i % 4] + ` ${i + 1}`, key: `PR${i + 1}`, description: titles[i % titles.length], workItemCount: i * 7 + 12, lead: { id: "member-1", name: names[i % 4] }, updatedAt: date(i) })), total: state.count };
    else if (path === "/api/v1/members") json = { members: members(), metric: "open" };
    else if (path === "/api/v1/positions") json = { positions: rows(i => ({ name: `岗位 ${i + 1}`, code: `P${i + 1}`, departmentId: null, departmentName: "产品研发", memberCount: 2 })) };
    else if (path === "/api/v1/tokens") json = rows(i => ({ name: `集成凭据 ${i + 1}`, tokenPrefix: "fn_test", tier: "READ_ONLY", projectWhitelist: [], allowedIpCidrs: [], expiresAt: null, lastUsedAt: null, revokedAt: null }));
    else if (path === "/api/v1/portfolios") json = { portfolios: rows(i => ({ name: `项目集 ${i + 1}`, projectCount: 3, workItemCount: 12 })) };
    else if (/\/portfolios\/[^/]+$/.test(path)) json = { id: path.split("/").at(-1), name: "产品研发", projects: [{ ...project, workItemCount: 4 }] };
    else if (/\/issues$/.test(path)) json = { items: rows(i => ({ key: `TEST-${i + 1}`, title: titles[i % titles.length], type: "DEFECT", severity: ["S3", "S2", "S1"][i % 3], priority: ["MEDIUM", "LOW", "HIGH"][i % 3], statusName: ["待处理", "处理中", "已解决"][i % 3], statusCategory: ["NOT_STARTED", "IN_PROGRESS", "DONE"][i % 3], assigneeName: names[i % 4], reporterName: names[(i + 1) % 4], dueDate: "2026-12-01", createdAt: now, projectName: project.name }), size, (pageNo - 1) * size), total: state.count };
    else if (/\/work-items$/.test(path) && url.searchParams.get("view") === "table") json = { rows: rows(i => ({ number: i + 1, key: `TEST-${i + 1}`, title: titles[i % titles.length], type: ["TASK", "DEFECT", "REQUIREMENT"][i % 3], priority: ["MEDIUM", "LOW", "HIGH"][i % 3], dueDate: "2026-12-01", version: 1 }), size, (pageNo - 1) * size), total: state.count, page: pageNo, pageSize: size };
    else if (/\/work-items$/.test(path) && url.searchParams.get("view") === "calendar") json = { from: url.searchParams.get("dateFrom"), to: url.searchParams.get("dateTo"), days: [], unscheduled: state.count };
    else if (/\/custom-fields$/.test(path)) json = rows(i => ({ key: `field_${i + 1}`, name: `业务字段 ${i + 1}`, type: "TEXT", options: [], isRequired: false, archivedAt: null }));
    else if (/\/ideas$/.test(path)) json = { items: rows(i => ({ title: titles[i % titles.length], description: "减少重复操作，让每天使用更顺畅", status: ["NEW", "UNDER_REVIEW", "PLANNED"][i % 3], score: String(23 - i), submittedByMemberId: null, submitterDisplay: "测试成员", promotedWorkItemId: null })), total: state.count };
    else if (/\/milestones$/.test(path)) json = rows(i => ({ name: `交付节点 ${i + 1}`, dueDate: "2026-12-01", description: "发布准备", archivedAt: null }));
    else if (/\/imports$/.test(path)) json = { batches: rows(i => ({ filename: ["客服反馈-十一月.csv", "产品需求与验收清单.xlsx", "历史问题迁移.csv"][i % 3], status: ["SUCCEEDED", "PARTIAL", "FAILED"][i % 3], totalRows: 25, createdCount: [25, 23, 0][i % 3], failedCount: [0, 2, 25][i % 3] })) };
    else if (/\/dev-activity$/.test(path)) json = { members: members().map(m => ({ memberId: m.id, name: m.name, commits: 4, prs: 2, reviews: 3, days: 5 })), note: "" };
    else if (/\/activity$/.test(path)) json = { items: rows(i => ({ actorId: null, targetType: "PROJECT", targetId: null, action: "project.update", summary: `更新项目设置 ${i + 1}`, createdAt: date(i) }), size, (pageNo - 1) * size), total: state.count, page: pageNo, pageSize: size };
    if (json === undefined) return route.fallback();
    return route.fulfill({ json });
  });
  return state;
}

export function tableRoutes(pid) {
  return [
    ["audit", "/admin/audit"], ["work-items", `/projects/${pid}/table`],
    ["issues", "/issues"], ["project-issues", `/projects/${pid}/issues`],
    ["projects", "/projects", async p => p.getByRole("button", { name: "表格视图", exact: true }).click()],
    ["members", "/members"], ["organization", "/admin/organization"],
    ["positions", "/admin/organization", async p => p.getByRole("tablist", { name: "组织架构" }).getByRole("tab", { name: /职位/ }).click()],
    ["fields", `/projects/${pid}/fields`], ["ideas", `/projects/${pid}/ideas`],
    ["milestones", `/projects/${pid}/milestones`], ["portfolios", "/portfolios"], ["tokens", "/tokens"],
    ["imports", `/projects/${pid}/import`, async p => p.locator(".page-tabs").getByRole("tab").nth(1).click()],
    ["dev-activity", `/projects/${pid}/insights`, async p => p.locator(".page-tabs").getByRole("tab").nth(2).click()],
    ["activity", `/projects/${pid}/activity`],
  ];
}
