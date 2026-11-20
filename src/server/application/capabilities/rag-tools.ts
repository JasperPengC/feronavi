/** MCP和REST使用同一RAG输入契约、服务与输出结构。 */
import {z} from 'zod';
import {RAG_CONVERSATION_TOOLS} from './rag-conversation-tools.ts';
import {ragChatSchema,ragSearchSchema} from '../../../shared/rag.ts';
import * as rag from '../../services/rag.service.ts';
import type {ToolDef} from './tools.ts';
import {DomainError} from '../../../shared/errors.ts';
function parse<S extends z.ZodType>(schema:S,args:unknown):z.infer<S>{
 const input=schema.safeParse(args);
 if(!input.success)throw new DomainError('VALIDATION','RAG参数不合法',input.error.issues);
 return input.data;
}
export const RAG_TOOLS:ToolDef[]=[
 ...RAG_CONVERSATION_TOOLS,
 {name:'rag.projects',description:'列出本令牌可搜索的项目。跨项目知识助手冷启动先调用；不需要当前项目。',kind:'read',scope:'project-set',inputSchema:{type:'object',properties:{},additionalProperties:false},handler:async ctx=>({items:await rag.listRagProjects(ctx.actor,(ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined))})},
 {name:'rag.search',description:'跨有权项目或指定项目检索知识，返回所属项目与原文片段。省略projectIds搜索全部有权项目，严格遵守令牌范围与文档ACL。',kind:'read',scope:'project-set',inputSchema:z.toJSONSchema(ragSearchSchema,{target:'draft-7'}),handler:(ctx,args)=>rag.searchRag(ctx.actor,parse(ragSearchSchema,args),(ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined))},
 {name:'rag.chat',description:'独立知识助手：在授权项目范围内多轮问答，返回真实引用与项目来源。省略projectIds=全部有权项目；history仅用户问题提供上下文，assistant不作为事实依据。先确认范围，资料不足如实说明。',kind:'read',scope:'project-set',inputSchema:z.toJSONSchema(ragChatSchema,{target:'draft-7'}),handler:(ctx,args)=>rag.chatRag(ctx.actor,parse(ragChatSchema,args),(ctx.token.projectWhitelist.length?ctx.token.projectWhitelist:undefined),undefined,{token:ctx.token})},
];
