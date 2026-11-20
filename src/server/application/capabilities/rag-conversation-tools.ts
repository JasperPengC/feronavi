/** 持久RAG会话与REST共用服务；project-set守卫后仍在领域层检查账号所有权和白名单。 */
import { z } from "zod";
import { DomainError } from "../../../shared/errors.ts";
import { ragActionIdSchema, ragActionDecisionSchema, ragConversationCreateSchema, ragConversationDetailSchema, ragConversationIdSchema, ragConversationListSchema, ragConversationUpdateSchema, ragMessageCreateSchema, ragRequestIdSchema } from "../../../shared/rag-conversations.ts";
import * as service from "../../services/rag-conversation.service.ts";
import type { ToolDef } from "./tools.ts";
function parse<S extends z.ZodType>(schema: S, args: unknown): z.infer<S> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new DomainError("VALIDATION", "会话参数不合法", parsed.error.issues);
  return parsed.data;
}
const schema = (input: z.ZodType) => z.toJSONSchema(input, { target: "draft-7", io: "input" });
const detail = ragConversationIdSchema.merge(ragConversationDetailSchema);
const update = ragConversationUpdateSchema.safeExtend({ conversationId: z.string().uuid() });
const message = ragMessageCreateSchema.extend({ conversationId: z.string().uuid() });
const action=ragActionIdSchema.merge(ragActionDecisionSchema);
export const RAG_CONVERSATION_TOOLS: ToolDef[] = [
 {name:'rag.conversation.action',description:'确认或拒绝本人会话服务端保存的业务操作建议。只接收ID与decision，不能替换参数。重新验证当前权限、档位、范围和对象版本；并发幂等。',kind:'write',scope:'project-set',idempotent:true,inputSchema:schema(action),handler:(ctx,args)=>{const input=parse(action,args);return service.decideAction(ctx.actor,input.conversationId,input.requestId,input.actionId,input.decision,ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined,ctx.token);}},
  { name: "rag.conversation.list", description: "分页列出本账号持久知识对话，deleted='true'列出可恢复会话。受限项目令牌只见白名单内固定范围会话。", kind: "read", scope: "project-set", inputSchema: schema(ragConversationListSchema), handler: (ctx, args) => service.listConversations(ctx.actor, parse(ragConversationListSchema, args), (ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined)) },
  { name: "rag.conversation.get", description: "恢复本人知识会话和最近100条消息；before读取更早页。每次重验引用读权，失权历史不返回答案或来源快照。", kind: "read", scope: "project-set", inputSchema: schema(detail), handler: (ctx, args) => { const input = parse(detail, args); return service.getConversation(ctx.actor, input.conversationId, input.before, (ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined),ctx.token); } },
  { name: "rag.conversation.create", description: "新建按账号保存的知识会话，不丢弃旧记录。projectId固定范围，省略为全部当前有权项目；项目受限令牌必须指定白名单项目。", kind: "write", scope: "project-set", inputSchema: schema(ragConversationCreateSchema), handler: (ctx, args) => service.createConversation(ctx.actor, parse(ragConversationCreateSchema, args), (ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined)) },
  { name: "rag.conversation.update", description: "重命名本人知识会话或设置deleted=true软删除/false恢复。软删除可恢复，旧等待请求不会随恢复复活；不能更改所有者或资料范围。", kind: "write", scope: "project-set", destructive: true, inputSchema: schema(update), handler: (ctx, args) => { const { conversationId, ...input } = parse(update, args); return service.updateConversation(ctx.actor, conversationId, input, (ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined)); } },
  { name: "rag.conversation.send", description: "在本人会话内提问并保存真实回答和来源。必传UUID requestId，同会话同ID同问题幂等；上下文由服务端读取，不能传伪造history。", kind: "write", scope: "project-set", idempotent: true, inputSchema: schema(message), handler: (ctx, args) => { const { conversationId, ...input } = parse(message, args); return service.sendMessage(ctx.actor, conversationId, input, (ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined),{token:ctx.token}); } },
  { name: "rag.conversation.cancel", description: "停止本人会话中指定requestId的等待；保留问题，迟到模型结果不写入。重复取消安全。", kind: "write", scope: "project-set", idempotent: true, inputSchema: schema(ragRequestIdSchema), handler: (ctx, args) => { const input = parse(ragRequestIdSchema, args); return service.cancelMessage(ctx.actor, input.conversationId, input.requestId, (ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined),ctx.token); } },
];
