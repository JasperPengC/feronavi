/** 持久会话复用RAG身份：服务端归属与权限投影，不接受客户端历史/所有者。 */
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import { ragActionIdSchema, ragActionDecisionSchema, ragConversationCreateSchema, ragConversationDetailSchema, ragConversationIdSchema, ragConversationListSchema, ragConversationUpdateSchema, ragMessageCreateSchema, ragRequestIdSchema } from "../../shared/rag-conversations.ts";
import * as conversations from "../services/rag-conversation.service.ts";
import { tierAllows } from "../services/token.service.ts";
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "会话参数不合法", parsed.error.issues);
  return parsed.data;
}
export function registerRagConversationRoutes(app: FastifyInstance, auth: preHandlerHookHandler, csrf: preHandlerHookHandler) {
  const writable: preHandlerHookHandler = async req => {
    const identity = req.ragIdentity!;
    if (identity.bearer && (!identity.token || !tierAllows(identity.token, "write"))) throw new DomainError("FORBIDDEN", "当前令牌档位不允许保存会话", null);
  };
  const read = { preHandler: auth };
  const write = { preHandler: [auth, csrf, writable], bodyLimit: 40_000 };
  app.get("/api/v1/rag/conversations", read, async req => {
    const { actor, projectIds } = req.ragIdentity!;
    return conversations.listConversations(actor, parse(ragConversationListSchema, req.query), projectIds);
  });
  app.post("/api/v1/rag/conversations", write, async req => {
    const { actor, projectIds } = req.ragIdentity!;
    return conversations.createConversation(actor, parse(ragConversationCreateSchema, req.body), projectIds);
  });
  app.get("/api/v1/rag/conversations/:conversationId", read, async req => {
    const { actor, projectIds } = req.ragIdentity!;
    return conversations.getConversation(actor, parse(ragConversationIdSchema, req.params).conversationId, parse(ragConversationDetailSchema, req.query).before, projectIds,req.ragIdentity!.token);
  });
  app.patch("/api/v1/rag/conversations/:conversationId", write, async req => {
    const { actor, projectIds } = req.ragIdentity!;
    return conversations.updateConversation(actor, parse(ragConversationIdSchema, req.params).conversationId, parse(ragConversationUpdateSchema, req.body), projectIds);
  });
  app.post("/api/v1/rag/conversations/:conversationId/messages", { ...write, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async req => {
    const { actor, projectIds } = req.ragIdentity!;
    return conversations.sendMessage(actor, parse(ragConversationIdSchema, req.params).conversationId, parse(ragMessageCreateSchema, req.body), projectIds, {token:req.ragIdentity!.token});
  });
  app.post("/api/v1/rag/conversations/:conversationId/requests/:requestId/cancel", write, async req => {
    const { actor, projectIds } = req.ragIdentity!;
    const { conversationId, requestId } = parse(ragRequestIdSchema, req.params);
    parse(z.object({}).strict(), req.body ?? {});
    return conversations.cancelMessage(actor, conversationId, requestId, projectIds,req.ragIdentity!.token);
  });
  app.post('/api/v1/rag/conversations/:conversationId/messages/stream',{...write,config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(req,reply)=>{
    const {actor,projectIds,token}=req.ragIdentity!;
    const {conversationId}=parse(ragConversationIdSchema,req.params),input=parse(ragMessageCreateSchema,req.body);
    // Validate owner and scope before committing SSE headers. Transport loss does not cancel a durable request.
    await conversations.getConversation(actor,conversationId,undefined,projectIds,token);
    reply.hijack();reply.raw.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no','connection':'keep-alive'});
    const emit=async(event:import('../../shared/rag-conversations.ts').RagAssistantStreamEvent)=>{
      if(!reply.raw.destroyed&&!reply.raw.writableEnded)reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    try{const result=await conversations.sendMessage(actor,conversationId,input,projectIds,{token,emit});await emit({type:'result',result});}
    catch{await emit({type:'error',message:'本轮回答未完成，请刷新会话查看状态或重试。'});}
    finally{reply.raw.end();}
  });
  app.post('/api/v1/rag/conversations/:conversationId/requests/:requestId/actions/:actionId',write,async req=>{
    const {actor,projectIds,token}=req.ragIdentity!;
    const {conversationId,requestId,actionId}=parse(ragActionIdSchema,req.params);
    const {decision}=parse(ragActionDecisionSchema,req.body);
    return conversations.decideAction(actor,conversationId,requestId,actionId,decision,projectIds,token);
  });

}
