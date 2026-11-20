// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { Actor } from "../src/server/permission/actor.ts";
vi.mock("../src/db/index.ts", () => ({
  db: {},
  sql: {},
  inTransaction: async (fn: () => Promise<unknown>) => fn(),
}));
import { PROJECT_TOOLS } from "../src/server/mcp/project-tools.ts";
import { assertProjectPermission } from "../src/server/services/mcp-project.service.ts";
const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const noPermissions: Actor = {
  memberId: "m",
  username: "m",
  name: "m",
  permissions: new Set(),
  grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }],
  mustChangePassword: false,
  locale: "zh-CN",
  timezone: null,
  theme: null,
};
const validate = (name: string, args: object) =>
  new AjvJsonSchemaValidator().getValidator(
    PROJECT_TOOLS.find((t) => t.name === name)!.inputSchema,
  )(args).valid;
describe("项目管理与洞察 MCP 契约", () => {
  it("覆盖项目、模板、看板、组合、字段、导出和安全集成发现", () => {
    const names = PROJECT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of [
      "project.create",
      "project.update",
      "project.archive",
      "project.unarchive",
      "project.status",
      "project.member.add",
      "project.member.remove",
      "member.list",
      "role.list",
      "projectTemplate.list",
      "projectTemplate.get",
      "projectTemplate.create",
      "projectTemplate.update",
      "projectTemplate.delete",
      "projectTemplate.createProject",
      "insight.burnDown",
      "insight.cumulativeFlow",
      "insight.projectActivity",
      "dashboard.list",
      "dashboard.get",
      "dashboard.create",
      "dashboard.update",
      "dashboard.delete",
      "dashboard.widgets.list",
      "dashboard.widgets.create",
      "dashboard.widgets.update",
      "dashboard.widgets.delete",
      "dashboard.widgets.data",
      "portfolio.list",
      "portfolio.get",
      "portfolio.create",
      "portfolio.update",
      "portfolio.delete",
      "portfolio.addProject",
      "portfolio.removeProject",
      "portfolio.summary",
      "customField.definitions",
      "customField.create",
      "customField.update",
      "customField.archive",
      "project.report",
      "project.exportCsv",
      "integration.list",
    ])
      expect(names).toContain(name);
  });
  it("精确拒绝未知字段与不可修改的项目 key", () => {
    for (const tool of PROJECT_TOOLS)
      expect(
        new AjvJsonSchemaValidator().getValidator(tool.inputSchema)({
          undeclaredField: true,
        }).valid,
        tool.name,
      ).toBe(false);
    expect(validate("project.update", { projectId, key: "HACK" })).toBe(false);
    expect(validate("project.create", { key: "aa", name: "wrong key" })).toBe(
      false,
    );
    expect(validate("project.create", { key: "AA", name: "project" })).toBe(
      true,
    );
  });
  it("账号聚合入口声明 account 范围，dashboard 必须给出项目", () => {
    for (const tool of PROJECT_TOOLS.filter((t) =>
      /^(portfolio\.|projectTemplate\.|member.list|role.list)/.test(t.name),
    ))
      expect(tool.scope, tool.name).toBe("account");
    expect(validate("dashboard.list", {})).toBe(false);
    expect(validate("dashboard.create", { name: "global" })).toBe(false);
    expect(validate("dashboard.create", { projectId, name: "project" })).toBe(
      true,
    );
  });
  it("挂件配置拒绝跨域引用和无限自由字段", () => {
    expect(
      validate("dashboard.widgets.create", {
        projectId,
        dashboardId: projectId,
        type: "COUNT",
        config: { projectId },
      }),
    ).toBe(false);
    expect(
      validate("dashboard.widgets.create", {
        projectId,
        dashboardId: projectId,
        type: "BURNDOWN",
        config: { iterationId: projectId },
      }),
    ).toBe(true);
  });
  it("导出、活动窗口、发现分页均有上界", () => {
    expect(validate("project.exportCsv", { projectId, limit: 1001 })).toBe(
      false,
    );
    expect(validate("insight.projectActivity", { projectId, days: 367 })).toBe(
      false,
    );
    expect(validate("member.list", { pageSize: 101 })).toBe(false);
  });
  it("连接工具支持配置生命周期，但凭据仅能写入", () => {
    for (const name of [
      "integration.create",
      "integration.update",
      "integration.delete",
      "integration.sync",
      "integration.syncStatus",
      "webhook.list",
      "webhook.create",
      "webhook.update",
      "webhook.delete",
      "webhook.deliveries",
      "webhook.replay",
    ])
      expect(PROJECT_TOOLS.map((t) => t.name)).toContain(name);
    const create = PROJECT_TOOLS.find((t) => t.name === "integration.create")!;
    expect(
      (create.inputSchema.properties as Record<string, { writeOnly?: boolean }>)
        .token!.writeOnly,
    ).toBe(true);
    expect(
      validate("integration.create", {
        projectId,
        kind: "GITHUB",
        name: "source",
        baseUrl: "https://api.github.com",
        token: "test-token",
        config: { token: "forbidden" },
      }),
    ).toBe(false);
    expect(
      validate("webhook.create", {
        projectId,
        name: "hook",
        url: "https://example.com/hook",
        events: ["unknown.event"],
      }),
    ).toBe(false);
    expect(
      PROJECT_TOOLS.find((t) => t.name === "webhook.create")!.idempotent,
    ).toBe(false);
  });
  it("缺陷严重程度使用既有 S1 至 S4 枚举", () => {
    expect(validate("project.exportCsv", { projectId, severity: "S1" })).toBe(
      true,
    );
    expect(
      validate("project.exportCsv", { projectId, severity: "CRITICAL" }),
    ).toBe(false);
  });
  it("ADMIN 角色名不能代替领域动作权限", () => {
    expect(() =>
      assertProjectPermission(noPermissions, "project:update", projectId),
    ).toThrow();
    const permitted = {
      ...noPermissions,
      permissions: new Set(["project:update"]),
    };
    expect(() =>
      assertProjectPermission(permitted, "project:update", projectId),
    ).not.toThrow();
    expect(() =>
      assertProjectPermission(
        {
          ...permitted,
          grants: [
            {
              roleKey: "ADMIN",
              scopeType: "PROJECT",
              scopeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            },
          ],
        },
        "project:update",
        projectId,
      ),
    ).toThrow();
  });
});
