import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const shell = readFileSync("src/client/routes/AppShell.tsx", "utf8");
const router = readFileSync("src/client/router.tsx", "utf8");

describe("主导航结构", () => {
  it("完整呈现项目导航，不截断入口或使用虚构工作区名称", () => {
    // Round 109：侧栏改为一级+子菜单；项目内关键入口仍在当前项目子菜单里
    expect(shell).toContain("/projects/$projectId/board");
    expect(shell).toContain("/projects/$projectId/milestones");
    expect(shell).toContain("/projects/$projectId/wiki");
    // 表格/时间线是工作项的视图，不再各占一个侧栏菜单
    expect(shell).toContain('t("nav.workItems")');
    expect(shell).not.toContain('navItem("/projects/$projectId/table"');
    expect(shell).not.toContain("Northstar Lab");
  });

  it("只为具备组织级角色管理权限的账号显示 RBAC 入口并注册管理路由", () => {
    expect(shell).toMatch(/permissions\.includes\("role:manage"\)/);
    expect(shell).toMatch(/dataScopes\.some\(\(scope\) => scope\.scopeType === "ORG"\)/);
    expect(shell).toMatch(/navItem\("\/admin\/roles"/);
    expect(router).toMatch(/path:\s*"\/admin\/roles"/);
    expect(router).toContain("RoleAdminPage");
  });
});
