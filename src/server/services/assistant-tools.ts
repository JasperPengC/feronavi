/** A deliberately curated gateway over the actual guarded MCP registry. */
import {
  collectAssistantResources,
  summarizeAssistantClosureValue,
} from "./assistant-projection.ts";
import {
  ASSISTANT_CLOSURE_POLICIES,
  assistantClosureReads,
  assistantClosurePresentation,
  type AssistantClosureRead,
} from "./assistant-closure.ts";
import { randomUUID } from "node:crypto";
import { DomainError } from "../../shared/errors.ts";
import type {
  RagActionProposal,
  RagBusinessEvidence,
} from "../../shared/rag.ts";
import type { ToolDef } from "../application/capabilities/tools.ts";
import {
  assistantActionTarget,
  assistantResourceFingerprint,
  readAssistantResource,
} from "./assistant-resource.ts";
import {
  ASSISTANT_WORKFLOW_CONTRACTS,
  assistantWorkflowReads,
  type AssistantWorkflowContext,
} from "./assistant-workflow-contracts.ts";
import { assistantInputSchema } from "./assistant-model-tools.ts";
import { assistantRegistry } from "./assistant-tool-catalogue.ts";
import {
  authorizeAssistantTool,
  type AssistantAccess,
} from "./assistant-tool-authorization.ts";
import { hydrateAssistantParameters } from "./assistant-artifact-parameters.ts";
import { workflowPresentation } from "./assistant-workflow-presentation.ts";
export async function executeAssistantTool(
  access: AssistantAccess,
  tool: ToolDef,
  args: Record<string, unknown>,
) {
  const authorized = await authorizeAssistantTool(access, tool, args);
  const hydrated = await hydrateAssistantParameters(
    access,
    tool,
    args,
    authorized.projectId,
  );
  const result = await tool.handler(authorized.ctx, hydrated);
  const raw = tool.resultEnvelope ? (result as { result: unknown }).result : result;
  // 二进制报告保持在下载端点，不占用模型上下文；外部MCP仍返回原有base64契约。
  const value =
    tool.name === "project.report"
      ? {
          filename: (raw as { filename: string }).filename,
          mimeType: "application/pdf",
          sizeBytes: (raw as { sizeBytes: number }).sizeBytes,
          downloadUrl: `/api/v1/rag/reports/${encodeURIComponent(authorized.projectId!)}.pdf`,
          note: "报告已生成，可通过下载链接查看；报告统计须以实际文件为准，不据文件名推测数字。",
        }
      : tool.name === "attachment.download"
        ? {
            filename: (raw as { originalName: string }).originalName,
            mimeType: (raw as { mimeType: string }).mimeType,
            sizeBytes: (raw as { sizeBytes: number }).sizeBytes,
            downloadUrl: `/api/v1/rag/attachments/${encodeURIComponent(String(args.attachmentId))}/download`,
          }
        : raw;
  return { value, parameters: hydrated, ...authorized };
}
export async function proposeAssistantAction(
  access: AssistantAccess,
  tool: ToolDef,
  args: Record<string, unknown>,
): Promise<RagActionProposal> {
  if (Object.hasOwn(args, "userConfirmed")) throw new DomainError("VALIDATION", "确认状态只能由服务端记录", null);
  if (tool.kind !== "write")
    throw new DomainError("VALIDATION", "只能为写操作生成建议", null);
  const { ctx, projectId, resources, scope } = await authorizeAssistantTool(
    access,
    tool,
    args,
  );
  // No handlers run here: business mutations occur only after explicit server confirmation.
  const { AjvJsonSchemaValidator } =
    await import("@modelcontextprotocol/sdk/validation/ajv");
  const validated = new AjvJsonSchemaValidator().getValidator<
    Record<string, unknown>
  >(assistantInputSchema(tool) as typeof tool.inputSchema)(args);
  if (!validated.valid)
    throw new DomainError("VALIDATION", "操作参数不合法", null);
  await hydrateAssistantParameters(access, tool, args, projectId);
  const { authorizeMcpOperation } =
    await import("./mcp-operation-authorization.service.ts");
  await authorizeMcpOperation(ctx.actor, tool.name, args);
  const target =
    assistantActionTarget(tool.name, args) ??
    (ASSISTANT_CLOSURE_POLICIES[tool.name] ? resources[0] : undefined);
  const snapshot = target
    ? await readAssistantResource(ctx.actor, target)
    : null;
  if (
    snapshot &&
    ((args.expectedVersion !== undefined &&
      args.expectedVersion !== snapshot.version) ||
      (args.version !== undefined && args.version !== snapshot.version))
  )
    throw new DomainError(
      tool.name === "customField.setValues" ? "VERSION_CONFLICT" : "CONFLICT",
      "工作项版本已变化",
      null,
    );
  if (
    snapshot &&
    args.expectedRevisionId !== undefined &&
    args.expectedRevisionId !== snapshot.currentRevisionId
  )
    throw new DomainError("CONFLICT", "文档版本已变化", null);
  if (tool.name === "page.restore" && snapshot) args = { ...args, expectedRevisionId: snapshot.currentRevisionId };
  const workflow = ASSISTANT_WORKFLOW_CONTRACTS[tool.name];
  const reads = workflow
    ? assistantWorkflowReads(tool.name, args, projectId)
    : assistantClosureReads(tool.name, args, projectId!, resources);
  const observations = reads
    ? await observeAssistantReads(access, withResourceReads(reads, resources))
    : undefined;
  const references = [];
  if (reads && !workflow) {
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== "string" || !key.endsWith("Id")) continue;
      const resource = resources.find((r) => r.id === value);
      if (resource) {
        const current = await readAssistantResource(ctx.actor, resource);
        references.push({
          key,
          label:
            [current.key, current.title ?? current.name ?? current.body]
              .filter(Boolean)
              .join(" · ") || "业务对象",
        });
      }
    }
    for (const resource of resources) {
      if (references.some((row) => args[row.key] === resource.id)) continue;
      const current = await readAssistantResource(ctx.actor, resource);
      references.push({
        key: `${resource.kind}Id`,
        label:
          [current.key, current.title ?? current.name ?? current.body]
            .filter(Boolean)
            .join(" · ") || "业务对象",
      });
    }
    if (
      typeof args.revisionId === "string" &&
      typeof args.pageId === "string"
    ) {
      const definition = (await assistantRegistry()).find(
        (t) => t.name === "page.revisions",
      )!;
      const result = (
        await executeAssistantTool(access, definition, { pageId: args.pageId })
      ).value as { revisions: { id: string; revisionNo: number }[] };
      const revision = result.revisions.find((r) => r.id === args.revisionId);
      if (!revision)
        throw new DomainError("NOT_FOUND", "文档历史版本不存在", null);
      references.push({
        key: "revisionId",
        label: `第 ${revision.revisionNo} 版`,
      });
    }
    // 子记录ID不直接给人审批，显示其复读快照中的实际内容。
    const findRecord = (
      node: unknown,
      id: string,
    ): Record<string, unknown> | undefined => {
      if (!node || typeof node !== "object") return undefined;
      if (!Array.isArray(node) && (node as Record<string, unknown>).id === id)
        return node as Record<string, unknown>;
      for (const value of Object.values(node)) {
        const found = findRecord(value, id);
        if (found) return found;
      }
      return undefined;
    };
    for (const key of [
      "relationId",
      "timeLogId",
      "approvalId",
      "workItemProgressUpdateId",
      "milestoneProgressUpdateId",
    ]) {
      if (typeof args[key] !== "string") continue;
      const row = observations
        ?.map((observation) => findRecord(observation.value, String(args[key])))
        .find(Boolean);
      if (!row)
        throw new DomainError("NOT_FOUND", "待操作记录不存在或不可访问", null);
      references.push({
        key,
        label:
          [
            row.key,
            row.title,
            row.summary,
            row.note,
            row.loggedDate,
            row.minutes === undefined ? undefined : `${row.minutes} 分钟`,
            row.fromStateName && row.toStateName
              ? `${row.fromStateName} → ${row.toStateName}`
              : undefined,
            row.status,
          ]
            .filter((value) => value != null && value !== "")
            .join(" · ") || "所选业务记录",
      });
    }
    if (
      tool.name === "customField.setValues" &&
      args.values &&
      typeof args.values === "object"
    ) {
      const definition = (await assistantRegistry()).find(
        (t) => t.name === "customField.definitions",
      )!;
      const result = (
        await executeAssistantTool(access, definition, { projectId })
      ).value as { definitions: { id: string; name: string }[] };
      for (const id of Object.keys(args.values)) {
        const field = result.definitions.find((row) => row.id === id);
        if (!field)
          throw new DomainError(
            "NOT_FOUND",
            "自定义字段不存在或不可访问",
            null,
          );
        references.push({
          key: "values",
          label: `${field.name}：${JSON.stringify((args.values as Record<string, unknown>)[id])}`,
        });
      }
    }
    for (const key of ["memberId", "assigneeId"]) {
      if (typeof args[key] !== "string") continue;
      const definition = (await assistantRegistry()).find(
        (t) => t.name === "project.members",
      )!;
      const result = (
        await executeAssistantTool(access, definition, { projectId })
      ).value as { members: { id: string; name: string; username: string }[] };
      const member = result.members.find((row) => row.id === args[key]);
      if (!member) throw new DomainError("NOT_FOUND", "成员不在项目中", null);
      references.push({ key, label: `${member.name}（${member.username}）` });
    }
  }
  return {
    ...(observations
      ? {
          observations: observations.map(
            ({ toolName, parameters, fingerprint }) => ({
              toolName,
              parameters,
              fingerprint,
            }),
          ),
          presentation: workflow
            ? workflowPresentation(workflow.title, args, observations ?? [])
            : assistantClosurePresentation(tool.name, args, references),
        }
      : {}),
    id: randomUUID(),
    toolName: tool.name,
    projectId,
    scope,
    ...(workflow ? { verificationReads: observations?.map(({ toolName, parameters }) => ({ toolName, parameters })) } : {}),
    targetId: target?.id ?? null,
    ...(target && snapshot
      ? {
          target: {
            ...target,
            fingerprint: assistantResourceFingerprint(snapshot),
            preview: Object.fromEntries(
              [
                "key",
                "title",
                "name",
                "body",
                "version",
                "revisionNo",
                "targetType",
                "targetId",
              ].flatMap<[string, string | number]>((key) => {
                const value = snapshot[key];
                return typeof value === "string"
                  ? [[key, value.slice(0, 1000)]]
                  : typeof value === "number"
                    ? [[key, value]]
                    : [];
              }),
            ),
          },
        }
      : {}),
    resources,
    parameters: args,
    expectedVersion:
      typeof snapshot?.version === "number" ? snapshot.version : null,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
  };
}

/** 为每个被确认引用保留当前领域读取，而不是只对主对象做版本检查。 */
function withResourceReads(
  reads: AssistantClosureRead[],
  resources: RagBusinessEvidence["resources"],
) {
  const names = {
    workItem: "workitem.get",
    page: "page.get",
    idea: "idea.get",
    milestone: "plan.getMilestone",
    iteration: "plan.getIteration",
    release: "plan.getRelease",
    module: "plan.getModule",
  };
  const result = [...reads];
  for (const resource of resources) {
    if (resource.kind === "comment") continue;
    const toolName = names[resource.kind];
    const parameters = { [`${resource.kind}Id`]: resource.id };
    if (
      !result.some(
        (row) =>
          row.toolName === toolName &&
          JSON.stringify(row.parameters) === JSON.stringify(parameters),
      )
    )
      result.push({ toolName, parameters });
  }
  return result;
}
export async function observeAssistantReads(
  access: AssistantAccess,
  reads: AssistantClosureRead[],
) {
  const registry = await assistantRegistry();
  const observations = [];
  for (const request of reads) {
    const tool = registry.find(
      (t) => t.name === request.toolName && t.kind === "read",
    );
    if (!tool) throw new DomainError("FORBIDDEN", "操作复核能力已不可用", null);
    const executed = await executeAssistantTool(
      access,
      tool,
      request.parameters,
    );
    let value: unknown = executed.value;
    // 确认检查覆盖所有分页，不能只确认前100项的结转或想法列表。
    if (["workitem.list", "idea.list"].includes(tool.name)) {
      const first = value as { items: unknown[]; total: number };
      const items = [...first.items];
      let page = 1;
      while (items.length < first.total) {
        const next = (
          await executeAssistantTool(access, tool, {
            ...request.parameters,
            page: ++page,
          })
        ).value as typeof first;
        if (!next.items.length || next.total !== first.total)
          throw new DomainError("CONFLICT", "列表已变化，请重新生成操作", null);
        items.push(...next.items);
      }
      value = { ...first, items };
    }
    observations.push({
      ...request,
      parameters: executed.parameters,
      value,
      fingerprint: assistantResourceFingerprint({ value }),
      resources: collectAssistantResources(
        tool.name,
        value,
        executed.projectId,
        executed.resources,
      ),
    });
  }
  return observations;
}
export async function assertAssistantObservationsCurrent(
  access: AssistantAccess,
  action: RagActionProposal,
) {
  if (!action.observations?.length) return [];
  const current = await observeAssistantReads(access, action.observations);
  if (
    current.some(
      (row, index) =>
        row.fingerprint !== action.observations![index]!.fingerprint,
    )
  )
    throw new DomainError(
      "CONFLICT",
      "操作涉及的业务事实已变化，请重新生成",
      null,
    );
  return current;
}
export async function rereadAssistantClosureResult(
  access: AssistantAccess,
  action: RagActionProposal,
  raw: unknown,
  context?: AssistantWorkflowContext,
) {
  const contract = ASSISTANT_WORKFLOW_CONTRACTS[action.toolName];
  const workflowReads = contract
    ? assistantWorkflowReads(
        action.toolName,
        action.parameters,
        action.projectId,
        raw,
        context,
      )
    : undefined;
  if (contract) {
    const resultProjects: string[] = [];
    if (
      ["project.create", "projectTemplate.createProject"].includes(
        action.toolName,
      )
    ) {
      for (const read of workflowReads ?? [])
        if (
          read.toolName === "project.get" &&
          typeof read.parameters.projectId === "string"
        )
          resultProjects.push(read.parameters.projectId);
      const { listRagProjects } = await import("./rag-projects.ts");
      const visible = await listRagProjects(
        access.actor,
        access.token?.projectWhitelist.length
          ? access.token.projectWhitelist
          : undefined,
        true,
      );
      if (resultProjects.some((id) => !visible.some((p) => p.id === id)))
        throw new DomainError("NOT_FOUND", "新项目不可访问", null);
      access = {
        ...access,
        projectIds: [...new Set([...access.projectIds, ...resultProjects])],
      };
    }
    const observed = await observeAssistantReads(access, workflowReads ?? []);
    return {
      observedAt: new Date().toISOString(),
      resources: observed.flatMap((r) => r.resources),
      verificationReads: observed.map(({ toolName, parameters }) => ({ toolName, parameters })),
      projectIds: resultProjects,
      value: {
        observations: observed.map(({ toolName, value }) => ({
          toolName,
          value: summarizeAssistantClosureValue(value),
        })),
      },
    };
  }
  const reads = assistantClosureReads(
    action.toolName,
    action.parameters,
    action.projectId!,
    action.resources ?? [],
  );
  if (!reads) return undefined;
  let observations = await observeAssistantReads(
    access,
    withResourceReads(reads, action.resources ?? []),
  );
  if (action.toolName === "idea.submit") {
    let row = raw as Record<string, unknown>;
    for (
      let depth = 0;
      depth < 3 && row && typeof row.result === "object";
      depth++
    )
      row = row.result as Record<string, unknown>;
    if (typeof row?.id !== "string")
      throw new DomainError("INTERNAL", "新增想法缺少可复读身份", null);
    observations = await observeAssistantReads(access, [
      { toolName: "idea.get", parameters: { ideaId: row.id } },
    ]);
  }
  if (action.toolName === "idea.promote") {
    const idea = observations.find((row) => row.toolName === "idea.get")
      ?.value as { promotedWorkItemId?: string };
    if (!idea.promotedWorkItemId)
      throw new DomainError("INTERNAL", "转化结果缺少工作项", null);
    observations.push(
      ...(await observeAssistantReads(access, [
        {
          toolName: "workitem.get",
          parameters: { workItemId: idea.promotedWorkItemId },
        },
      ])),
    );
  }
  const resources = observations
    .flatMap((row) => row.resources)
    .filter(
      (r, index, all) =>
        all.findIndex((other) => other.kind === r.kind && other.id === r.id) ===
        index,
    );
  return {
    observedAt: new Date().toISOString(),
    resources,
    value: {
      observations: observations.map(({ toolName, value }) => ({
        toolName,
        value: summarizeAssistantClosureValue(value),
      })),
    },
  };
}

export {
  assistantRegistry,
  ASSISTANT_READ_TOOLS,
  ASSISTANT_WRITE_TOOLS,
  ASSISTANT_BASE_TOOLS,
} from "./assistant-tool-catalogue.ts";
export {
  authorizeAssistantTool,
  type AssistantAccess,
} from "./assistant-tool-authorization.ts";
export { hydrateAssistantParameters } from "./assistant-artifact-parameters.ts";
export { lockAssistantWorkflowRecords } from "./assistant-workflow-locks.ts";
