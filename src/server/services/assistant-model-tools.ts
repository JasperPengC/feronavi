/** 模型只装载当前业务工具；文件和凭据以服务端受控引用传递。 */
import type { ToolDef } from "../application/capabilities/tools.ts";
import { BUSINESS_WORKFLOWS } from "../application/capabilities/business-workflows.ts";
import { assistantModelToolName } from "./assistant-execution.ts";
import { DomainError } from "../../shared/errors.ts";
type InputSchema = Record<string, unknown> & {
  properties?: Record<string, unknown>;
  required?: string[];
};
export function assistantInputSchema(tool: ToolDef): InputSchema {
  const schema = structuredClone(tool.inputSchema) as InputSchema;
  const properties = schema.properties ?? {};
  // 确认只属于服务器保存的操作卡；模型既看不到该字段，也不能自行声明确认。
  delete properties.userConfirmed;
  schema.properties = properties;
  schema.required = (schema.required ?? []).filter((key) => key !== "userConfirmed");
  for (const combinator of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[combinator])) schema[combinator] = (schema[combinator] as InputSchema[]).map((branch) => ({ ...branch, ...(branch.required ? { required: branch.required.filter((key) => key !== "userConfirmed") } : {}) }));
  }
  // 有必填资源标识时，执行边界从真实归属解析projectId，避免旧读回链重复要求模型猜测。
  const resourceIds = ["workItemId", "pageId", "ideaId", "milestoneId", "iterationId", "releaseId", "moduleId", "commentId", "attachmentId", "ruleId", "formId", "submissionId", "fieldId", "dashboardId", "widgetId", "workflowId", "stateId", "transitionId", "batchId", "savedViewId", "policyId", "targetId"];
  if (schema.required.some((key) => resourceIds.includes(key)) || tool.name.startsWith("attachment.")) schema.required = schema.required.filter((key) => key !== "projectId");
  if (tool.name === "attachment.download") {
    schema.required = schema.required.filter((key) => !["targetId", "targetType"].includes(key));
    delete schema.oneOf;
  }
  if (tool.name === "page.restore") schema.required = schema.required.filter((key) => key !== "expectedRevisionId");
  const binary = ["attachment.upload", "import.create"].includes(tool.name);
  const credential = ["integration.create", "integration.update"].includes(tool.name);
  if (!binary && !credential) return schema;
  const originals = binary ? ["contentBase64", "dataBase64"] : ["token"];
  const replacement = binary ? "artifactId" : "credentialRef";
  const required = schema.required;
  for (const original of originals) delete properties[original];
  properties[replacement] = {
    type: "string", format: "uuid",
    description: binary ? "用户已上传的受控文件引用，不可自行编造" : "用户通过专用表单提交并绑定目标服务的凭据引用；不可从对话索取密钥",
  };
  schema.required = [...required.filter((key) => !originals.includes(key)), ...(binary || originals.some((key) => required.includes(key)) ? [replacement] : [])];
  return schema;
}
const discovery = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
export class AssistantModelTools {
  private active: ToolDef[];
  private registry: ToolDef[];
  private base: Set<string>;
  private persistent: boolean;
  constructor(registry: ToolDef[], base: Set<string>, persistent: boolean) {
    this.registry = registry;
    this.base = base;
    this.persistent = persistent;
    this.active = this.registry.filter(
      (t) => this.base.has(t.name) && (persistent || t.kind === "read"),
    );
  }
  definitions() {
    const definitions = [
      discovery(
        "assistant_workflows",
        "发现当前助手支持的业务流程；个人/组织/文件/导入等能力先发现并装载。",
      ),
      discovery(
        "assistant_loadWorkflow",
        "按流程id装载精确工具契约，下一轮即可调用；切换流程保留已获取证据及建议。",
        {
          workflow: {
            type: "string",
            enum: BUSINESS_WORKFLOWS.map((f) => f.id),
          },
        },
        ["workflow"],
      ),
      ...this.active.map((t) => ({
        type: "function",
        function: {
          name: assistantModelToolName(t),
          description:
            t.kind === "write"
              ? `登记待确认建议，不执行写入。成功登记后才有操作卡。${t.description}`
              : t.description,
          parameters: assistantInputSchema(t),
        },
      })),
    ];
    if (definitions.length > 128)
      throw new DomainError("INTERNAL", "模型工具预算超限", null);
    return definitions;
  }
  has(name: string) {
    return this.active.some((t) => assistantModelToolName(t) === name);
  }
  discover() {
    const names = new Set(
      this.registry
        .filter((t) => this.persistent || t.kind === "read")
        .map((t) => t.name),
    );
    return {
      workflows: BUSINESS_WORKFLOWS.map((f) => ({
        ...f,
        missingTools: f.steps.filter((n) => !names.has(n)),
      })),
      confirmationRequired: true,
    };
  }
  load(workflow: string) {
    const flow = BUSINESS_WORKFLOWS.find((f) => f.id === workflow);
    if (!flow) throw new DomainError("VALIDATION", "未知业务流程", null);
    const names = new Set<string>(flow.steps);
    const prefixes = new Set(flow.steps.map((n) => n.split(".")[0]));
    const eligible = this.registry.filter(
      (t) => this.persistent || t.kind === "read",
    );
    this.active = eligible.filter(
      (t) => this.base.has(t.name) || names.has(t.name),
    );
    if (this.active.length + 2 > 128)
      throw new DomainError("INTERNAL", "业务工具预算超限", null);
    for (const candidate of eligible) {
      if (this.active.length + 2 >= 128) break;
      if (
        prefixes.has(candidate.name.split(".")[0]) &&
        !this.active.includes(candidate)
      )
        this.active.push(candidate);
    }
    return {
      workflow,
      loaded: this.active
        .filter((t) => !this.base.has(t.name))
        .map((t) => ({
          name: t.name,
          modelName: assistantModelToolName(t),
          kind: t.kind,
        })),
      confirmationRequired: true,
    };
  }
}
