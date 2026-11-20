import { z } from "zod";
import { ragActionDecisionSchema, ragConversationCreateSchema, ragConversationUpdateSchema, ragMessageCreateSchema } from "../../shared/rag-conversations.ts";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const uuid = { type: "string", format: "uuid" }, text = { type: "string" }, date = { type: "string", format: "date-time" }, nullableText = { type: ["string", "null"] };
export const ragConversationResultSchemas = {
  Conversation: object({ id: uuid, title: text, projectId: { type: ["string", "null"], format: "uuid" }, projectName: nullableText, available: { type: "boolean" }, createdAt: date, updatedAt: date, deletedAt: { type: ["string", "null"], format: "date-time" } }),
  Message: object({ references:object({artifactIds:{type:"array",items:uuid,maxItems:10},credentialRefs:{type:"array",items:uuid,maxItems:10}},[]),id: uuid, conversationId: uuid, requestId: uuid, question: text, status: { type: "string", enum: ["pending", "completed", "failed", "cancelled", "unavailable"] }, reply: { anyOf: [ref("ChatResult"), { type: "null" }] }, createdAt: date, updatedAt: date },["id","conversationId","requestId","question","status","reply","createdAt","updatedAt"]),
  ConversationList: object({ items: { type: "array", items: ref("Conversation") }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" } }),
  ConversationDetail: object({ conversation: ref("Conversation"), messages: { type: "array", items: ref("Message") }, hasMore: { type: "boolean" } }),
  MessageResult: object({ conversation: ref("Conversation"), message: ref("Message") }),
};
export const ragConversationSchemas = {
  ...ragConversationResultSchemas,
  ActionDecision: z.toJSONSchema(ragActionDecisionSchema,{target:'draft-2020-12'}),
  AssistantStreamEvent: {oneOf:[
    object({type:{const:'accepted'},result:ref('MessageResult')}),
    object({type:{const:'status'},phase:{enum:['thinking','tool','answering']},toolName:text},['type','phase']),
    object({type:{const:'delta'},text}),object({type:{const:'reset'}}),
    object({type:{const:'result'},result:ref('MessageResult')}),object({type:{const:'error'},message:text})
  ]},
  ConversationInput: z.toJSONSchema(ragConversationCreateSchema, { target: "draft-2020-12" }),
  // refine的非空约束使用minProperties表达，Zod在运行时仍做最终校验。
  ConversationUpdate: { ...z.toJSONSchema(ragConversationUpdateSchema, { target: "draft-2020-12" }), minProperties: 1 },
  MessageInput: z.toJSONSchema(ragMessageCreateSchema, { target: "draft-2020-12" }),
};
const response = (name: string) => ({ description: "按账号归属且已按当前权限过滤的会话数据。", content: { "application/json": { schema: ref(name) } } });
const pathId = { in: "path", name: "conversationId", required: true, schema: uuid };
const csrf = { in: "header", name: "X-CSRF-Token", required: false, description: "Cookie会话写操作必需；Bearer写操作需要READ_WRITE/ADMIN档位。", schema: text };
const errors = Object.fromEntries([400, 401, 403, 409, 413, 429, 500].map(code => [code, response("Error")]));
function operation(id: string, summary: string, result: string, input?: string, parameters: unknown[] = []) {
  return { operationId: id, summary, tags: ["RAG"], security: [{ bearerAuth: [] }, { sessionAuth: [], ...(input ? { csrfHeader: [] } : {}) }], parameters: [...parameters, ...(input ? [csrf] : [])], ...(input ? { requestBody: { required: true, content: { "application/json": { schema: ref(input) } } } } : {}), responses: { 200: response(result), ...errors } };
}
export const ragConversationPaths = {
  '/api/v1/rag/conversations/{conversationId}/messages/stream':{post:{...operation('ragConversationStream','真实供应商流；每个SSE事件数据都是带匹配type的JSON。accepted/result内含result，delta含text，reset清空旧增量；断网仍可按requestId恢复。','MessageResult','MessageInput',[pathId]),responses:{200:{description:'accepted/status/delta/reset/result/error；不输出内部思考或工具参数增量。',content:{'text/event-stream':{schema:ref('AssistantStreamEvent')}}},...errors}}},
  '/api/v1/rag/conversations/{conversationId}/requests/{requestId}/actions/{actionId}':{post:operation('ragConversationAction','确认/拒绝服务端保存的操作建议；参数不可替换、权限版本重验、并发幂等。','MessageResult','ActionDecision',[pathId,{in:'path',name:'requestId',required:true,schema:uuid},{in:'path',name:'actionId',required:true,schema:uuid}])},
  "/api/v1/rag/conversations": {
    get: operation("ragConversationList", "分页列出本账号会话；deleted=true查看可恢复的已删除会话", "ConversationList", undefined, [
      { in: "query", name: "deleted", schema: { type: "boolean", default: false } },
      { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } },
      { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 50, default: 50 } },
    ]),
    post: operation("ragConversationCreate", "新建本人会话，范围固定；旧会话保留", "Conversation", "ConversationInput"),
  },
  "/api/v1/rag/conversations/{conversationId}": {
    get: operation("ragConversationGet", "恢复会话及最近100条消息；引用权限撤销则隐藏历史答案", "ConversationDetail", undefined, [pathId, { in: "query", name: "before", schema: uuid }]),
    patch: operation("ragConversationUpdate", "重命名、软删除或恢复本人会话；不能修改范围和所有者", "Conversation", "ConversationUpdate", [pathId]),
  },
  "/api/v1/rag/conversations/{conversationId}/messages": {
    post: operation("ragConversationSend", "提交问题并保存真实回答；requestId幂等，上下文由服务器读取", "MessageResult", "MessageInput", [pathId]),
  },
  "/api/v1/rag/conversations/{conversationId}/requests/{requestId}/cancel": {
    post: { ...operation("ragConversationCancel", "停止等待；迟到回答不再写入，可继续提问", "MessageResult", undefined, [pathId, { in: "path", name: "requestId", required: true, schema: uuid }, csrf]), security: [{ bearerAuth: [] }, { sessionAuth: [], csrfHeader: [] }] },
  },
};
