/** MCP 对外输出与操作提示；文本结果保持兼容，结构化结果按同一契约校验。 */
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef } from "./tools.ts";

type Schema = Record<string, unknown>;
const string = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const object = { type: "object", additionalProperties: true };
const array = { type: "array", items: object };
const shape = (properties: Record<string, Schema>): NonNullable<Tool["outputSchema"]> => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: true,
});
const entity = shape({ id: string });
const paged = shape({ items: array, total: number });
const replay = shape({ replayed: boolean, result: {} });

const outputs: Record<string, NonNullable<Tool["outputSchema"]>> = {
  ping: shape({ ok: boolean, server: string }),
  whoami: shape({ member: object, tokenTier: string, visibleProjects: array }),
  "collab.inspect": shape({ roomId: string, projectId: string, mode: string, sequence: number, canWrite: boolean }),
  "collab.command": replay,
  "collab.update": shape({ sequence: number, duplicate: boolean, stateVectorHash: string }),
  "collab.publishPage": replay,
  "project.list": paged,
  "project.get": entity,
  "project.members": shape({ members: array }),
  "workitem.list": paged,
  "workitem.get": shape({ workItem: entity, allowedTransitions: array }),
  "workitem.comments": shape({ comments: array }),
  "workitem.create": replay,
  "workitem.update": entity,
  "workitem.transition": entity,
  "workitem.assign": replay,
  "workitem.comment": replay,
  "workitem.link": entity,
  "comment.update": entity,
  "comment.delete": shape({ ok: boolean }),
  "plan.listMilestones": shape({ milestones: array }),
  "plan.getMilestone": shape({ milestone: entity, workItems: array }),
  "plan.listIterations": shape({ iterations: array }),
  "plan.listReleases": shape({ releases: array }),
  "plan.createMilestone": replay,
  "plan.createIteration": replay,
  "plan.createRelease": replay,
  "plan.createModule": replay,
  "notification.list": shape({ items: array, unreadCount: number }),
  "notification.markRead": shape({ ok: boolean, scope: string }),
  "notification.setPrefs": shape({ memberId: string }),
  "activity.project": paged,
  "meta.workflow": shape({ projectId: string, workflows: array }),
  "meta.fields": shape({ fields: array, note: string }),
  "page.list": shape({ pages: array }),
  "page.get": entity,
  "page.create": replay,
  "page.update": shape({ replayed: boolean, result: shape({ page: entity, sequence: number, publishedRevisionId: string }) }),
  "knowledge.search": shape({ mode: string, hits: array }),
  "knowledge.ask": shape({ ok: boolean, answer: { type: ["string", "null"] }, citations: array, mode: string }),
  "idea.submit": replay,
  "idea.vote": shape({ ideaId: string, weight: number, score: { type: "string", pattern: "^-?[0-9]+(?:\\.[0-9]+)?$" } }),
  "idea.promote": shape({ workItem: { anyOf: [entity, { type: "null" }] }, alreadyPromoted: boolean }),
  "sla.get": shape({ sla: { anyOf: [object, { type: "null" }] } }),
  "sla.pause": replay,
  "sla.resume": replay,
  "approval.list": shape({ approvals: array }),
  "approval.approve": replay,
  "approval.reject": replay,
  "automation.listRules": shape({ rules: array }),
  "automation.listRuns": shape({ runs: array }),
  "automation.createRule": replay,
  "announcement.send": replay,
  "announcement.revoke": entity,
};

export function describeTool(tool: ToolDef): Tool {
  const outputSchema = tool.outputSchema ?? outputs[tool.name];
  if (!outputSchema) throw new Error(`MCP 工具缺少输出契约：${tool.name}`);
  const read = tool.kind === "read";
  const annotations: ToolAnnotations = {
    readOnlyHint: read,
    destructiveHint: !read,
    // 可选幂等键不能保证无键调用安全重试；默认保持保守。
    idempotentHint: read || ["collab.update", "workitem.link", "notification.markRead"].includes(tool.name),
    openWorldHint: !read || ["knowledge.search", "knowledge.ask"].includes(tool.name),
    ...tool.annotations,
  };
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Tool["inputSchema"], outputSchema, annotations };
}

// 保留旧发现API；协议输出仍由describeTool返回业务根对象契约。
export { annotationsFor, outputSchemaFor, validatedToolOutput } from "../tool-contracts.ts";
