/** OpenAPI 3.1：输入由运行时Zod契约生成，结果与MCP共用结构。 */
import { z } from "zod";
import {
  ragConversationPaths,
  ragConversationSchemas,
} from "./rag-conversation-openapi.ts";
import { ragChatSchema, ragSearchSchema } from "../../shared/rag.ts";
import {ragArtifactSchemas,ragArtifactPaths} from "./rag-artifact-openapi.ts";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const text = { type: "string" },
  uuid = { type: "string", format: "uuid" };
const scope = object({
  projectIds: { type: "array", items: uuid },
  projectCount: { type: "integer", minimum: 0 },
});
const citation = object({
  pageId: uuid,
  projectId: uuid,
  projectName: text,
  title: text,
  headingPath: { type: ["string", "null"] },
  snippet: text,
});
const response = (name: string) => ({
  description: "操作结果；ok=false时返回降级说明与可用引用。",
  content: { "application/json": { schema: ref(name) } },
});
const errors = {
  400: response("Error"),
  401: response("Error"),
  403: response("Error"),
  413: response("Error"),
  429: response("Error"),
  500: response("Error"),
};
const operation = (
  operationId: string,
  summary: string,
  input: string,
  result: string,
) => ({
  operationId,
  summary,
  tags: ["RAG"],
  security: [{ bearerAuth: [] }, { sessionAuth: [], csrfHeader: [] }],
  parameters: [
    {
      in: "header",
      name: "X-CSRF-Token",
      required: false,
      description: "Cookie会话POST必须提供；Bearer认证无需此头。",
      schema: text,
    },
  ],
  requestBody: {
    required: true,
    content: { "application/json": { schema: ref(input) } },
  },
  responses: { 200: response(result), ...errors },
});
const mode = { type: "string", enum: ["vector", "keyword", "none"] };
const verificationReads={type:"array",items:object({toolName:text,parameters:{type:"object",additionalProperties:true}})};
const businessScope={oneOf:[
  object({kind:{enum:["personal","account"]},ownerId:uuid}),
  object({kind:{enum:["project","project-set"]},projectIds:{type:"array",items:uuid}}),
]};
const resource = object({
  kind: {
    type: "string",
    enum: [
      "workItem",
      "milestone",
      "iteration",
      "release",
      "module",
      "page",
      "comment",
      "idea",
    ],
  },
  id: uuid,
});
const actionProperties = {
  id: uuid,
  toolName: text,
  projectId: {type:["string","null"],format:"uuid"},
  targetId: { type: ["string", "null"] },
  parameters: { type: "object", additionalProperties: true },
  expectedVersion: { type: ["integer", "null"] },
  status: {
    type: "string",
    enum: ["pending", "confirmed", "rejected", "expired", "queued", "running", "failed", "uncertain"],
  },
  createdAt: { type: "string", format: "date-time" },
  expiresAt: { type: "string", format: "date-time" },
};
export const ragOpenApi = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "Feronavi RAG API",
    version: "1.1.0",
    description:
      "跨授权项目的知识检索与多轮问答。省略projectIds表示当前身份与令牌白名单交集内的全部非归档项目。引用始终执行Wiki权限检查。该描述覆盖RAG公共API，不代表平台其他业务接口。",
  },
  servers: [{ url: "/" }],
  tags: [{ name: "RAG", description: "知识助手" }],
  paths: {
    ...ragArtifactPaths,
    ...ragConversationPaths,
    "/api/v1/rag/projects": {
      get: {
        operationId: "ragProjects",
        summary: "获取当前身份与令牌有权搜索的项目",
        tags: ["RAG"],
        security: [{ bearerAuth: [] }, { sessionAuth: [] }],
        responses: { 200: response("Projects"), ...errors },
      },
    },
    "/api/v1/rag/reports/{projectId}.pdf": {
      get: {
        operationId: "ragProjectReport",
        summary: "下载项目报告；会话与Bearer均重验当前项目和project.report策略",
        tags: ["RAG"],
        security: [{ bearerAuth: [] }, { sessionAuth: [] }],
        parameters: [
          { in: "path", name: "projectId", required: true, schema: uuid },
        ],
        responses: {
          200: {
            description: "当前项目事实生成的PDF报告",
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          ...errors,
        },
      },
    },
    "/api/v1/rag/search": {
      post: operation(
        "ragSearch",
        "在授权范围检索知识片段",
        "SearchInput",
        "SearchResult",
      ),
    },
    "/api/v1/rag/chat": {
      post: {
        ...operation(
          "ragChat",
          "依据项目资料进行带引用的多轮对话",
          "ChatInput",
          "ChatResult",
        ),
        description:
          "history中的assistant消息不作为知识依据；仅用户历史问题参与上下文。更换范围应开启新会话。未配置/供应商故障时HTTP200、ok=false，证据和说明仍可用。",
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "平台API令牌，遵守过期、撤销、IP和项目白名单；只读档位可用。",
      },
      sessionAuth: { type: "apiKey", in: "cookie", name: "feronavi_session" },
      csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
    },
    schemas: {
      ...ragArtifactSchemas,
      ...ragConversationSchemas,
      SearchInput: z.toJSONSchema(ragSearchSchema, { target: "draft-2020-12" }),
      ChatInput: z.toJSONSchema(ragChatSchema, { target: "draft-2020-12" }),
      Project: object({ id: uuid, key: text, name: text,archived:{type:"boolean"} },["id","key","name"]),
      Projects: object({ items: { type: "array", items: ref("Project") } }),
      Scope: scope,
      Citation: citation,
      Hit: object({
        ...citation.properties,
        chunkId: uuid,
        score: { type: "number" },
        mode: { type: "string", enum: ["vector", "keyword"] },
      }),
      SearchResult: object(
        {
          mode,
          scope: ref("Scope"),
          hits: { type: "array", items: ref("Hit") },
          note: text,
        },
        ["mode", "scope", "hits"],
      ),
      BusinessEvidence: object(
        {
          readTools: { type: "array", items: text },
          id: uuid,
          toolName: text,
          projectId: {type:["string","null"],format:"uuid"},
          scope:businessScope,
          verificationReads,
          observedAt: { type: "string", format: "date-time" },
          resources: { type: "array", items: resource },
          summary: text,
        },
        ["id", "toolName", "projectId", "observedAt", "resources", "summary"],
      ),
      ActionProposal: object(
        {
          ...actionProperties,
          scope:businessScope,
          verificationReads,
          presentation: object({
            title: text,
            fields: {
              type: "array",
              items: object({ label: text, value: text }),
            },
          }),
          observations: {
            type: "array",
            items: object({
              toolName: text,
              parameters: { type: "object", additionalProperties: true },
              fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
            }),
          },
          target: object(
            {
              ...resource.properties,
              fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
              preview: {
                type: "object",
                additionalProperties: { type: ["string", "number", "null"] },
              },
            },
            ["kind", "id", "fingerprint"],
          ),
          resources: { type: "array", items: resource },
          result: object(
            {
              observedAt: { type: "string", format: "date-time" },
              verificationReads,
              projectIds:{type:"array",items:uuid},
              resources: { type: "array", items: resource },
              value: { type: "object", additionalProperties: true },
              outcome: { type: "string", enum: ["approval_pending"] },
              approval: object({
                status: { type: "string", enum: ["PENDING"] },
              }),
            },
            ["observedAt", "resources", "value"],
          ),
        },
        Object.keys(actionProperties),
      ),
      ChatResult: object(
        {
          evidence: { type: "array", items: ref("BusinessEvidence") },
          actions: { type: "array", items: ref("ActionProposal") },
          ok: { type: "boolean" },
          answer: { type: ["string", "null"] },
          mode,
          citations: { type: "array", items: ref("Citation") },
          scope: ref("Scope"),
          note: text,
        },
        ["ok", "answer", "mode", "citations", "scope"],
      ),
      Error: object({ code: text, message: text, details: {} }),
    },
  },
} as const;
export const ragResultSchemas = ragOpenApi.components.schemas;
