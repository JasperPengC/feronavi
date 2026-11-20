import "./_env.ts";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import {
  member,
  role,
  roleAssignment,
  iteration,
  workItem,
  project as projectTable,
} from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { ALL_TOOLS } from "../src/server/application/capabilities/tools.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
import { describeTool } from "../src/server/application/capabilities/contracts.ts";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ToolCtx } from "../src/server/mcp/tools.ts";
import * as wi from "../src/server/services/work-item.service.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as insight from "../src/server/services/insight.service.ts";
interface ToolResult {
  id: string;
  result: ToolResult;
  replayed: boolean;
  name: string;
  projectId: string;
  members: ToolResult[];
  roles: ToolResult[];
  templates: ToolResult[];
  projects: ToolResult[];
  portfolios: ToolResult[];
  definitions: ToolResult[];
  dashboards: ToolResult[];
  widgets: ToolResult[];
  integrations: ToolResult[];
  endpoints: ToolResult[];
  deliveries: ToolResult[];
  endpoint: ToolResult;
  secret: string;
  secretEncrypted?: string;
  applied: { workItems: number; milestones: number; iterations: number };
  failures: unknown[];
  totals: { projectCount: number };
  data: { total: number };
  points: unknown[];
  series: unknown[];
  metric: string;
  contentBase64: string;
  sizeBytes: number;
  csv: string;
  count: number;
  hasMore: boolean;
  lastSyncedAt: string | null;
  ok: boolean;
}
let checks = 0;
const check = (label: string, condition: unknown) => {
  assert.ok(condition, label);
  checks++;
  console.log(`  OK ${label}`);
};
const tools = ALL_TOOLS;
const validator = new AjvJsonSchemaValidator();
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [memberRole] = await db
    .select()
    .from(role)
    .where(eq(role.key, "MEMBER"));
  const [adminMember] = await db
    .insert(member)
    .values({
      username: "mcp-project-admin",
      email: "mcp-project-admin@example.test",
      name: "项目工具管理员",
      status: "ACTIVE",
      passwordHash: "unused-test-hash",
    })
    .returning();
  const [otherMember] = await db
    .insert(member)
    .values({
      username: "mcp-project-other",
      email: "mcp-project-other@example.test",
      name: "工具其他成员",
      status: "ACTIVE",
      passwordHash: "unused-test-hash",
    })
    .returning();
  await db
    .insert(roleAssignment)
    .values({
      memberId: adminMember!.id,
      roleId: adminRole!.id,
      scopeType: "ORG",
      scopeId: null,
    });
  const actor = (await loadActor(adminMember!.id))!;
  const ctx: ToolCtx = {
    actor,
    token: {
      tokenId: "project-test",
      memberId: actor.memberId,
      tier: "ADMIN",
      projectWhitelist: [],
    },
  };
  const call = async (
    name: string,
    args: Record<string, unknown>,
    context = ctx,
  ) => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    const result = JSON.parse(JSON.stringify(await tool.handler(context, confirmedTestArgs(name, args))));
    assert.equal(validator.getValidator(describeTool(tool).outputSchema!)(result).valid, true, `${name} 输出契约`);
    return (tool.resultEnvelope ? result.result : result) as ToolResult;
  };
  const write = async (
    name: string,
    args: Record<string, unknown>,
    context = ctx,
  ) => { const value = await call(name, args, context); return value.replayed !== undefined ? value.result : value; };
  const deny = async (
    name: string,
    args: Record<string, unknown>,
    code: string,
    context = ctx,
  ) => {
    await assert.rejects(
      () => call(name, args, context),
      (e: unknown) => e instanceof Error && "code" in e && e.code === code,
      `${name} 应拒绝 ${code}`,
    );
    checks++;
  };
  const created = await write("project.create", {
    key: "MCPPA",
    name: "项目工具 A",
  });
  const pid = created.id;
  const other = await write("project.create", {
    key: "MCPPB",
    name: "项目工具 B",
  });
  const qid = other.id;
  check(
    "项目创建含完整工作流",
    (await projectService.getProjectDetail(actor, pid)).workflows.length > 0,
  );
  await deny("project.create", { key: "MCPPA", name: "项目工具 A" }, "CONFLICT");
  check("重复项目标识被拒且原项目仍唯一", (await projectService.getProjectDetail(actor, pid)).id === pid);
  const limited: ToolCtx = {
    ...ctx,
    token: { ...ctx.token, projectWhitelist: [pid] },
  };
  const readOnly: ToolCtx = {
    ...ctx,
    token: { ...ctx.token, tier: "READ_ONLY" },
  };
  const noPerm: ToolCtx = {
    ...ctx,
    actor: {
      ...actor,
      permissions: new Set(),
      rolePermissions: new Map([["ADMIN", new Set()]]),
    },
  };
  await deny(
    "project.create",
    { key: "MCPPA", name: "项目工具 A" },
    "FORBIDDEN",
    noPerm,
  );
  await deny(
    "project.update",
    { projectId: pid, name: "不允许" },
    "FORBIDDEN",
    readOnly,
  );
  await deny(
    "project.update",
    { projectId: pid, name: "不允许" },
    "FORBIDDEN",
    noPerm,
  );
  await deny(
    "project.update",
    { projectId: qid, name: "不允许" },
    "NOT_FOUND",
    limited,
  );
  await deny("project.update", { projectId: pid, key: "HACK" }, "VALIDATION");
  await write(
    "project.update",
    { projectId: pid, name: "项目工具 A 已改" },
    limited,
  );
  check(
    "项目更新持久化",
    (await projectService.getProjectDetail(actor, pid)).name ===
      "项目工具 A 已改",
  );
  const detail = await projectService.getProjectDetail(actor, pid);
  const inProgress = detail.statusDefs.find(
    (s) => s.category === "IN_PROGRESS",
  )!;
  const terminal = detail.statusDefs.find(
    (s) => s.category === "TERMINAL" && s.key !== "CANCELLED",
  )!;
  await deny(
    "project.status",
    { projectId: pid, statusKey: terminal.key },
    "VALIDATION",
  );
  await write("project.status", { projectId: pid, statusKey: inProgress.key });
  check(
    "项目状态流转持久化",
    (await db.select().from(projectTable).where(eq(projectTable.id, pid)))[0]
      ?.statusId !== null,
  );
  await write("project.archive", { projectId: pid });
  check(
    "归档持久化",
    !!(await projectService.getProjectDetail(actor, pid)).archivedAt,
  );
  await write("project.unarchive", { projectId: pid });
  check(
    "取消归档持久化",
    !(await projectService.getProjectDetail(actor, pid)).archivedAt,
  );
  const directory = await call("member.list", {});
  check(
    "成员发现覆盖账号目录且无敏感字段",
    directory.members.some(row => row.id === otherMember!.id) &&
      !JSON.stringify(directory).includes("@example.test") &&
      !JSON.stringify(directory).includes("password"),
  );
  check(
    "角色发现",
    (await call("role.list", {})).roles.some((r) => r.id === memberRole!.id),
  );
  await deny("member.list", {}, "FORBIDDEN", limited);
  await deny("role.list", {}, "FORBIDDEN", limited);
  check("成员目录输出限于非敏感字段", Object.keys(directory.members[0]!).sort().join() === ["id", "name", "status", "username"].sort().join());
  await write("project.member.add", {
    projectId: pid,
    memberId: otherMember!.id,
    roleIds: [memberRole!.id],
  });
  check(
    "成员添加",
    (await projectService.membersOf(actor, pid)).some(
      (m) => m.id === otherMember!.id,
    ),
  );
  await write("project.member.remove", {
    projectId: pid,
    memberId: otherMember!.id,
  });
  check(
    "成员移除",
    !(await projectService.membersOf(actor, pid)).some(
      (m) => m.id === otherMember!.id,
    ),
  );
  const tpl = await write("projectTemplate.create", {
    name: "MCP 模板",
    payload: {
      workItems: [{ title: "模板任务", type: "TASK" }],
      milestones: [{ name: "模板里程碑" }],
      iterations: [
        { name: "模板迭代", startDate: "2026-11-14", endDate: "2026-11-16" },
      ],
    },
  });
  check(
    "模板创建并可读取",
    (await call("projectTemplate.get", { templateId: tpl.id })).name ===
      "MCP 模板",
  );
  check(
    "模板发现",
    (await call("projectTemplate.list", {})).templates.some(
      (t) => t.id === tpl.id,
    ),
  );
  await deny("projectTemplate.list", {}, "FORBIDDEN", limited);
  await write("projectTemplate.update", {
    templateId: tpl.id,
    name: "MCP 模板已改",
  });
  const fromTpl = await write("projectTemplate.createProject", {
    templateId: tpl.id,
    key: "MCPPT",
    name: "模板生成项目",
  });
  check(
    "从模板创建完整初始集",
    fromTpl.applied.workItems === 1 &&
      fromTpl.applied.milestones === 1 &&
      fromTpl.applied.iterations === 1 &&
      fromTpl.failures.length === 0,
  );
  await write("projectTemplate.delete", { templateId: tpl.id });
  const pf = await write("portfolio.create", { name: "MCP 项目集" });
  await write("portfolio.addProject", { portfolioId: pf.id, projectId: pid });
  await write("portfolio.addProject", { portfolioId: pf.id, projectId: qid });
  check(
    "项目集含两项目",
    (await call("portfolio.get", { portfolioId: pf.id })).projects.length === 2,
  );
  check(
    "项目集发现",
    (await call("portfolio.list", {})).portfolios.some((p) => p.id === pf.id),
  );
  check(
    "项目集汇总",
    (await call("portfolio.summary", { portfolioId: pf.id })).totals
      .projectCount === 2,
  );
  for (const name of [
    "portfolio.list",
    "portfolio.get",
    "portfolio.summary",
    "portfolio.addProject",
  ])
    await deny(
      name,
      name.endsWith("list")
        ? {}
        : {
            portfolioId: pf.id,
            ...(name.endsWith("addProject") ? { projectId: pid } : {}),
          },
      "FORBIDDEN",
      limited,
    );
  await write("portfolio.update", {
    portfolioId: pf.id,
    name: "MCP 项目集已改",
  });
  await write("portfolio.removeProject", {
    portfolioId: pf.id,
    projectId: qid,
  });
  check(
    "项目集移除项目",
    (await call("portfolio.get", { portfolioId: pf.id })).projects.length === 1,
  );
  await write("portfolio.delete", { portfolioId: pf.id });
  const def = await write("customField.create", {
    projectId: pid,
    key: "mcp_text",
    name: "工具字段",
    type: "TEXT",
  });
  check(
    "字段发现",
    (
      await call("customField.definitions", { projectId: pid })
    ).definitions.some((d) => d.id === def.id),
  );
  await deny(
    "customField.update",
    { projectId: qid, fieldId: def.id, name: "跨项目" },
    "NOT_FOUND",
  );
  await deny(
    "customField.create",
    { projectId: pid, key: "bad", name: "缺权限", type: "TEXT" },
    "FORBIDDEN",
    noPerm,
  );
  await write(
    "customField.update",
    { projectId: pid, fieldId: def.id, name: "工具字段已改" },
    limited,
  );
  await write("customField.archive", { projectId: pid, fieldId: def.id });
  check(
    "字段归档默认隐藏",
    !(
      await call("customField.definitions", { projectId: pid })
    ).definitions.some((d) => d.id === def.id),
  );
  check(
    "字段归档可显式读取",
    (
      await call("customField.definitions", {
        projectId: pid,
        includeArchived: true,
      })
    ).definitions.some((d) => d.id === def.id),
  );
  const [it] = await db
    .insert(iteration)
    .values({
      projectId: pid,
      name: "MCP 迭代",
      startDate: "2026-11-14",
      endDate: "2026-11-16",
    })
    .returning();
  const [foreignIt] = await db
    .insert(iteration)
    .values({
      projectId: qid,
      name: "其他迭代",
      startDate: "2026-11-14",
      endDate: "2026-11-16",
    })
    .returning();
  await wi.createWorkItem(actor, pid, {
    type: "TASK",
    title: "工具任务",
    iterationId: it!.id,
  });
  check(
    "燃尽真实逐日数据",
    (await call("insight.burnDown", { projectId: pid, iterationId: it!.id }))
      .points.length === 3,
  );
  check(
    "累积流真实逐日数据",
    (
      await call("insight.cumulativeFlow", {
        projectId: pid,
        iterationId: it!.id,
      })
    ).series.length === 3,
  );
  await deny(
    "insight.burnDown",
    { projectId: pid, iterationId: foreignIt!.id },
    "NOT_FOUND",
    limited,
  );
  check(
    "活动趋势有口径",
    !!(await call("insight.projectActivity", { projectId: pid, days: 7 }))
      .metric,
  );
  const dash = await write("dashboard.create", {
    projectId: pid,
    name: "MCP 看板",
  });
  const otherDash = await write("dashboard.create", {
    projectId: qid,
    name: "其他看板",
  });
  await insight.createDashboard(actor, { name: "全局看板" });
  check(
    "看板列表仅指定项目",
    (
      await call("dashboard.list", { projectId: pid }, limited)
    ).dashboards.every((d) => d.projectId === pid),
  );
  await deny(
    "dashboard.get",
    { projectId: pid, dashboardId: otherDash.id },
    "NOT_FOUND",
    limited,
  );
  await write("dashboard.update", {
    projectId: pid,
    dashboardId: dash.id,
    name: "看板已改",
  });
  const widget = await write("dashboard.widgets.create", {
    projectId: pid,
    dashboardId: dash.id,
    type: "COUNT",
  });
  check(
    "挂件真实统计",
    (
      await call("dashboard.widgets.data", {
        projectId: pid,
        dashboardId: dash.id,
        widgetId: widget.id,
      })
    ).data.total === 1,
  );
  await deny(
    "dashboard.widgets.update",
    {
      projectId: pid,
      dashboardId: dash.id,
      widgetId: widget.id,
      type: "BURNDOWN",
      config: { iterationId: foreignIt!.id },
    },
    "NOT_FOUND",
  );
  await write("dashboard.widgets.update", {
    projectId: pid,
    dashboardId: dash.id,
    widgetId: widget.id,
    type: "BURNDOWN",
    config: { iterationId: it!.id },
  });
  check(
    "挂件列表",
    (
      await call("dashboard.widgets.list", {
        projectId: pid,
        dashboardId: dash.id,
      })
    ).widgets.length === 1,
  );
  check(
    "燃尽挂件数据",
    (
      await call("dashboard.widgets.data", {
        projectId: pid,
        dashboardId: dash.id,
        widgetId: widget.id,
      })
    ).points.length === 3,
  );
  await write("dashboard.widgets.delete", {
    projectId: pid,
    dashboardId: dash.id,
    widgetId: widget.id,
  });
  await write("dashboard.delete", { projectId: pid, dashboardId: dash.id });
  const report = await call("project.report", { projectId: pid }, limited);
  check(
    "报告PDF有界返回",
    Buffer.from(report.contentBase64, "base64").subarray(0, 4).toString() ===
      "%PDF" && report.sizeBytes <= 1048576,
  );
  const reportText = [
    ...Buffer.from(report.contentBase64, "base64")
      .toString("latin1")
      .matchAll(/<([0-9A-F]+)> Tj/g),
  ]
    .map((m) => Buffer.from(m[1]!, "hex").swap16().toString("utf16le"))
    .join("");
  check(
    "报告按工作流状态统计真实工作项数量",
    reportText.includes("工作项合计 1 项"),
  );
  const csv = await call("project.exportCsv", { projectId: pid }, limited);
  check("CSV真实有界返回", csv.count === 1 && csv.csv.includes("工具任务"));
  await wi.createWorkItem(actor, pid, { type: "TASK", title: "第二项" });
  await deny("project.exportCsv", { projectId: pid, limit: 1 }, "VALIDATION");
  await deny("project.exportCsv", { projectId: qid }, "NOT_FOUND", limited);
  check("外联工具不在公开注册表", !tools.some(tool => /^(integration|webhook|im)\./u.test(tool.name)));
  check(
    "全部新工具拒绝未知顶层字段",
    await Promise.all(
      tools.map(async (t) => {
        try {
          await t.handler(ctx, { unknownField: true });
          return false;
        } catch (e: unknown) {
          return e instanceof Error && "code" in e && e.code === "VALIDATION";
        }
      }),
    ).then((results) => results.every(Boolean)),
  );
  check(
    "活跃项目数据未删除",
    (await db.select().from(workItem).where(eq(workItem.projectId, pid)))
      .length === 2,
  );
  console.log(`项目与洞察 MCP：${checks} 项通过`);
} finally {
  await sql.end({ timeout: 5 });
}
