// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_WORKFLOW_CONTRACTS as contracts,
  ASSISTANT_WORKFLOW_READ_TOOLS as readTools,
  assistantWorkflowReads as reads,
} from "../src/server/services/assistant-workflow-contracts.ts";
import * as focus from "../src/server/services/focus.service.ts";
import * as attachments from "../src/server/services/attachment.service.ts";
import * as roles from "../src/server/services/role.service.ts";
import type { Actor } from "../src/server/permission/actor.ts";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  allowed: true,
  visible: true,
  acl: true,
}));
vi.mock("../src/db/index.ts", () => ({
  db: {
    select: () => {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        limit: async () => state.rows,
      };
      return query;
    },
    execute: async () => [
      { project_id: "project-1", visibility: "RESTRICTED" },
    ],
  },
}));
vi.mock("../src/server/permission/engine.ts", () => ({
  can: () => state.allowed,
}));
vi.mock("../src/server/repos/project.repo.ts", () => ({
  isVisibleTo: async () => state.visible,
}));
vi.mock("../src/server/services/wiki.service.ts", () => ({
  hasAcl: async () => state.acl,
}));

const actor = {
  memberId: "member-1",
  permissions: new Set(["role:manage"]),
  grants: [{ roleKey: "admin", scopeType: "ORG", scopeId: null }],
} as unknown as Actor;

const p = "project-1";
const attachmentContext = {
  before: [
    {
      toolName: "attachment.get",
      parameters: { attachmentId: "a" },
      value: { id: "a", targetType: "PAGE", targetId: "page-1" },
    },
  ],
};
const assignmentContext = {
  before: [
    {
      toolName: "role.getAssignment",
      parameters: { assignmentId: "assignment" },
      value: { id: "assignment", memberId: "member-1" },
    },
  ],
};

describe("新增流程的纯读取契约", () => {
  it("没有已有项目也可为创建项目读取账号前提并复读实际新项目", () => {
    expect(contracts["project.create"]!.scope).toBe("account");
    expect(
      reads("project.create", { key: "NEW", name: "新项目" }, null),
    ).toEqual([
      { toolName: "project.list", parameters: { page: 1, pageSize: 100 } },
    ]);
    expect(
      reads("project.create", {}, null, {
        replayed: true,
        result: { id: "new-project" },
      }),
    ).toEqual([
      { toolName: "project.get", parameters: { projectId: "new-project" } },
    ]);
  });

  it.each([
    [
      "projectTemplate.createProject",
      { project: { id: "new-project" } },
      "project.get",
      "projectId",
      "new-project",
    ],
    [
      "import.create",
      { batchId: "batch-1" },
      "import.get",
      "batchId",
      "batch-1",
    ],
    [
      "intake.createForm",
      { form: { id: "form-1" } },
      "intake.getForm",
      "formId",
      "form-1",
    ],
    [
      "savedView.create",
      { id: "view-1" },
      "savedView.get",
      "savedViewId",
      "view-1",
    ],
    [
      "integration.create",
      { id: "integration-1" },
      "integration.syncStatus",
      "integrationId",
      "integration-1",
    ],
    [
      "dashboard.create",
      { id: "dashboard-1" },
      "dashboard.get",
      "dashboardId",
      "dashboard-1",
    ],
  ])("%s 从真实写结果定位新资源再领域复读", (name, raw, toolName, key, id) => {
    const after = reads(name as string, { projectId: p }, p, {
      result: { replayed: true, result: raw },
    })!;
    expect(after).toContainEqual({
      toolName,
      parameters: expect.objectContaining({ [key as string]: id }),
    });
    expect(after.every((r) => readTools.includes(r.toolName))).toBe(true);
  });

  it("不把空成功结果或任意嵌套id当作新建项目身份", () => {
    expect(() => reads("project.create", {}, null, { ok: true })).toThrow();
    expect(() =>
      reads("project.create", {}, null, { actor: { id: "wrong" } }),
    ).toThrow();
  });

  it("个人待办不需要项目，也不生成null项目参数", () => {
    expect(contracts["todo.update"]!.scope).toBe("personal");
    expect(reads("todo.update", { todoId: "todo-1" }, null)).toEqual([
      { toolName: "todo.list", parameters: {} },
    ]);
    expect(
      reads("todo.delete", { todoId: "todo-1" }, null, { ok: true }),
    ).toEqual([{ toolName: "todo.list", parameters: {} }]);
    expect(contracts["todo.update"]!.locks({ todoId: "todo-1" }, null)).toEqual(
      [{ table: "todo", column: "id", ids: ["todo-1"] }],
    );
  });

  it("工作流状态与迁移分别读取真实父集合", () => {
    expect(
      reads("workflow.updateState", { workflowId: "wf", stateId: "state" }, p),
    ).toContainEqual({
      toolName: "workflow.states",
      parameters: { workflowId: "wf" },
    });
    expect(
      reads(
        "workflow.removeTransition",
        { workflowId: "wf", transitionId: "edge" },
        p,
        { ok: true },
      ),
    ).toEqual([
      { toolName: "workflow.transitions", parameters: { workflowId: "wf" } },
    ]);
    expect(
      contracts["workflow.updateState"]!.locks(
        { workflowId: "wf", stateId: "state" },
        p,
      ),
    ).toContainEqual({ table: "workflow_state", column: "id", ids: ["state"] });
  });

  it("删除附件使用解析后的真实父对象复读，不把下载base64送模型", () => {
    expect(
      reads(
        "attachment.remove",
        { attachmentId: "a" },
        p,
        { ok: true },
        attachmentContext,
      ),
    ).toEqual([
      {
        toolName: "attachment.list",
        parameters: { targetType: "PAGE", targetId: "page-1" },
      },
    ]);
    expect(reads("attachment.remove", { attachmentId: "a" }, p)).toEqual([
      { toolName: "attachment.get", parameters: { attachmentId: "a" } },
    ]);
    expect(() =>
      reads("attachment.remove", { attachmentId: "a" }, p, { ok: true }),
    ).toThrow();
    expect(readTools).toContain("attachment.download");
  });

  it("导入修改后读取真实批次及有界报告", () => {
    expect(
      reads("import.confirm", { batchId: "batch" }, p, { created: 2 }),
    ).toContainEqual({
      toolName: "import.get",
      parameters: {
        batchId: "batch", offset: 0, limit: 100, errorOffset: 0, errorLimit: 100,
      },
    });
    expect(
      contracts["import.setMapping"]!.locks({ batchId: "batch" }, p),
    ).toContainEqual({ table: "import_batch", column: "id", ids: ["batch"] });
  });

  it("转化提交后同时复读提交集合和实际生成想法", () => {
    expect(
      reads("intake.convertSubmission", { submissionId: "submission" }, p, {
        idea: { id: "idea" },
        alreadyConverted: true,
      }),
    ).toEqual([
      { toolName: "intake.listSubmissions", parameters: { projectId: p } },
      { toolName: "idea.get", parameters: { ideaId: "idea" } },
    ]);
  });

  it("组合加项目同时观察组合和授权项目，删除只复读父集合", () => {
    expect(
      reads(
        "portfolio.addProject",
        { portfolioId: "portfolio", projectId: p },
        null,
      ),
    ).toEqual([
      { toolName: "portfolio.get", parameters: { portfolioId: "portfolio" } },
      { toolName: "project.get", parameters: { projectId: p } },
    ]);
    expect(
      reads("portfolio.delete", { portfolioId: "portfolio" }, null, {
        ok: true,
      }),
    ).toEqual([{ toolName: "portfolio.list", parameters: {} }]);
  });

  it("角色撤销必须解析assignment真实成员，缺少上下文时拒绝假复读", () => {
    expect(reads("role.revoke", { assignmentId: "assignment" }, null)).toEqual([
      {
        toolName: "role.getAssignment",
        parameters: { assignmentId: "assignment" },
      },
    ]);
    expect(() =>
      reads("role.revoke", { assignmentId: "assignment" }, null, { ok: true }),
    ).toThrow();
    expect(
      reads(
        "role.revoke",
        { assignmentId: "assignment" },
        null,
        { ok: true },
        assignmentContext,
      ),
    ).toEqual([
      { toolName: "role.assignments", parameters: { memberId: "member-1" } },
    ]);
  });

  it("历史专注会话通过精确ID读取，不误用今天集合", () => {
    expect(
      reads("focus.updateSession", { focusSessionId: "session" }, null),
    ).toEqual([
      {
        toolName: "focus.getSession",
        parameters: { focusSessionId: "session" },
      },
    ]);
  });

  it("组件新建后的复读包含新组件数据而非只用写返回宣称成功", () => {
    expect(
      reads(
        "dashboard.widgets.create",
        { projectId: p, dashboardId: "dash" },
        p,
        { id: "widget" },
      ),
    ).toEqual([
      {
        toolName: "dashboard.get",
        parameters: { projectId: p, dashboardId: "dash" },
      },
      {
        toolName: "dashboard.widgets.data",
        parameters: { projectId: p, dashboardId: "dash", widgetId: "widget" },
      },
    ]);
  });

  it("保存视图重排逐个读取真实视图并锁定所有ID", () => {
    expect(
      reads("savedView.reorder", { ids: ["v1", "v2"] }, null),
    ).toEqual([
      { toolName: "savedView.get", parameters: { savedViewId: "v1" } },
      { toolName: "savedView.get", parameters: { savedViewId: "v2" } },
    ]);
    expect(
      contracts["savedView.reorder"]!.locks(
        { ids: ["v1", "v2"] },
        null,
      ),
    ).toContainEqual({ table: "saved_view", column: "id", ids: ["v1", "v2"] });
  });

  it("组织归属调整快照及结果复读包含目标成员的部门与职位", () => {
    const args = { memberId: "m", departmentId: "d", positionId: "p" };
    for (const raw of [undefined, { ok: true }]) {
      expect(reads("organization.assignMember", args, null, raw)).toContainEqual({
        toolName: "member.get", parameters: { memberId: "m" },
      });
    }
    expect(readTools).toContain("member.get");
  });

  it("项目成员配置发现使用真实目录schema", () => {
    expect(
      reads(
        "project.member.add",
        { projectId: p, memberId: "m", roleIds: ["r"] },
        p,
      ),
    ).toContainEqual({
      toolName: "member.list",
      parameters: {},
    });
    expect(
      reads("project.member.add", { projectId: p }, p, { ok: true }),
    ).toEqual([{ toolName: "project.members", parameters: { projectId: p } }]);
  });

  it("所有剩余流程写契约存在，且不重复现有closure能力", () => {
    const required = [
      "automation.createRule",
      "automation.updateRule",
      "automation.deleteRule",
      "import.create",
      "import.setMapping",
      "import.dryRun",
      "import.confirm",
      "import.rollback",
      "intake.createForm",
      "intake.updateForm",
      "intake.deleteForm",
      "intake.convertSubmission",
      "intake.rejectSubmission",
      "project.create",
      "project.update",
      "project.member.add",
      "project.member.remove",
      "workflow.create",
      "workflow.update",
      "workflow.addState",
      "workflow.updateState",
      "workflow.archiveState",
      "workflow.addTransition",
      "workflow.updateTransition",
      "workflow.removeTransition",
      "todo.create",
      "todo.update",
      "todo.delete",
      "focus.createBlock",
      "focus.updateBlock",
      "focus.deleteBlock",
      "focus.recordSession",
      "focus.updateSession",
      "attachment.upload",
      "attachment.remove",
      "customField.create",
      "customField.update",
      "customField.archive",
      "savedView.create",
      "savedView.update",
      "savedView.delete",
      "savedView.reorder",
      "dashboard.create",
      "dashboard.update",
      "dashboard.delete",
      "dashboard.widgets.create",
      "dashboard.widgets.update",
      "dashboard.widgets.delete",
      "portfolio.create",
      "portfolio.update",
      "portfolio.delete",
      "portfolio.addProject",
      "portfolio.removeProject",
      "integration.create",
      "integration.update",
      "integration.delete",
      "integration.sync",
      "webhook.create",
      "webhook.update",
      "webhook.delete",
      "webhook.replay",
      "role.create",
      "role.update",
      "role.delete",
      "role.assign",
      "role.updateAssignment",
      "role.revoke",
      "organization.createDepartment",
      "organization.updateDepartment",
      "organization.archiveDepartment",
      "organization.createPosition",
      "organization.updatePosition",
      "organization.archivePosition",
      "organization.assignMember",
      "organization.applyTemplate",
      "team.create",
      "team.update",
      "team.delete",
      "sla.createPolicy",
      "sla.updatePolicy",
      "sla.deletePolicy",
    ];
    for (const name of required) expect(contracts[name], name).toBeDefined();
    expect(contracts["customField.setValues"]).toBeUndefined();
    expect(reads("unknown.tool", {}, null)).toBeUndefined();
    expect(() => reads("dashboard.create", {}, null)).toThrow();
  });

  it("所有读取和写契约引用真实注册能力，参数通过实际schema", async () => {
    const { ALL_TOOLS } = await import("../src/server/application/capabilities/tools.ts");
    const { assistantInputSchema } = await import("../src/server/services/assistant-model-tools.ts");
    const { AjvJsonSchemaValidator } =
      await import("@modelcontextprotocol/sdk/validation/ajv");
    const registry = ALL_TOOLS;
    const excluded = (name: string) => /^(integration|webhook|im)\./u.test(name);
    expect(registry.some(tool => excluded(tool.name))).toBe(false);
    for (const toolName of readTools.filter(name => !excluded(name)))
      expect(registry.find((t) => t.name === toolName)?.kind, toolName).toBe(
        "read",
      );
    const uuid = "11111111-1111-4111-8111-111111111111";
    const args = Object.fromEntries(
      [
        "projectId",
        "templateId",
        "memberId",
        "workflowId",
        "stateId",
        "transitionId",
        "ruleId",
        "batchId",
        "formId",
        "submissionId",
        "todoId",
        "timeBlockId",
        "focusSessionId",
        "targetId",
        "attachmentId",
        "fieldId",
        "policyId",
        "savedViewId",
        "dashboardId",
        "widgetId",
        "portfolioId",
        "integrationId",
        "endpointId",
        "deliveryId",
        "roleId",
        "assignmentId",
        "departmentId",
        "positionId",
        "teamId",
      ].map((key) => [key, uuid]),
    );
    Object.assign(args, {
      ids: [uuid],
      targetType: "PAGE",
      startAt: "2026-11-15T10:00:00Z",
      endAt: "2026-11-15T11:00:00Z",
      scopeType: "PROJECT",
    });
    const raw = {
      result: {
        id: uuid,
        batchId: uuid,
        project: { id: uuid },
        form: { id: uuid },
        idea: { id: uuid },
      },
    };
    const context = {
      before: [
        {
          toolName: "attachment.get",
          parameters: { attachmentId: uuid },
          value: { targetType: "PAGE", targetId: uuid },
        },
        {
          toolName: "savedView.get",
          parameters: { savedViewId: uuid },
          value: { projectId: uuid },
        },
        {
          toolName: "role.getAssignment",
          parameters: { assignmentId: uuid },
          value: { memberId: uuid },
        },
      ],
    };
    const validator = new AjvJsonSchemaValidator();
    for (const [name, contract] of Object.entries(contracts)) {
      if (excluded(name)) continue;
      expect(registry.find((t) => t.name === name)?.kind, name).toBe("write");
      for (const request of [
        ...contract.before(args, uuid),
        ...contract.after(args, raw, uuid, context),
      ]) {
        const tool = registry.find((t) => t.name === request.toolName)!;
        expect(readTools, name).toContain(request.toolName);
        expect(tool?.kind, request.toolName).toBe("read");
        expect.soft(
          validator.getValidator(assistantInputSchema(tool))(request.parameters).valid,
          `${name}→${request.toolName}`,
        ).toBe(true);
      }
    }
  });
});

describe("精确资源读取沿用当前领域权限", () => {
  beforeEach(() => {
    state.rows = [];
    state.allowed = true;
    state.visible = true;
    state.acl = true;
  });
  it.each(["getBlock", "getSession"] as const)(
    "%s 仅返回本人记录",
    async (name) => {
      state.rows = [{ id: "resource", memberId: actor.memberId }];
      expect(typeof focus[name]).toBe("function");
      await expect(focus[name](actor, "resource")).resolves.toMatchObject({
        id: "resource",
      });
      state.rows = [{ id: "resource", memberId: "someone-else" }];
      await expect(focus[name](actor, "resource")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      state.rows = [];
      await expect(focus[name](actor, "resource")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    },
  );
  it("附件元数据检查父页ACL且不返回存储位置和文件内容", async () => {
    state.rows = [
      {
        id: "attachment",
        targetType: "PAGE",
        targetId: "page",
        originalName: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        storagePath: "private-key",
        storageBackend: "s3",
        contentHash: "hash",
        contentBase64: "never",
      },
    ];
    expect(typeof attachments.getMetadata).toBe("function");
    const result = await attachments.getMetadata(actor, "attachment");
    expect(result).toMatchObject({
      id: "attachment",
      targetType: "PAGE",
      targetId: "page",
    });
    for (const key of [
      "storagePath",
      "storageBackend",
      "contentHash",
      "contentBase64",
    ])
      expect(result).not.toHaveProperty(key);
    state.acl = false;
    await expect(
      attachments.getMetadata(actor, "attachment"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("精确角色指派读取要求role管理权", async () => {
    state.rows = [
      {
        id: "assignment",
        memberId: "target",
        roleId: "role",
        roleKey: "member",
        roleName: "成员",
        roleIsBuiltin: true,
        scopeType: "ORG",
        scopeId: null,
      },
    ];
    expect(typeof roles.getRoleAssignment).toBe("function");
    await expect(
      roles.getRoleAssignment(actor, "assignment"),
    ).resolves.toMatchObject({
      id: "assignment",
      memberId: "target",
      scopeName: null,
    });
    state.allowed = false;
    await expect(
      roles.getRoleAssignment(actor, "assignment"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
