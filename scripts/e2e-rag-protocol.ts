/** 一次性库：真实Fastify/session/Bearer/MCP/OpenAPI互通验收。 */
import './_env.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {db,sql} from '../src/db/index.ts';
import {member,role,roleAssignment} from '../src/db/schema.ts';
import {loadActor} from '../src/server/auth/actor-loader.ts';
import {createSession} from '../src/server/auth/session.ts';
import {createProject} from '../src/server/services/project.service.ts';
import {createPage} from '../src/server/services/wiki.service.ts';
import {reindexPage} from '../src/server/services/knowledge.service.ts';
import {createToken,revokeToken} from '../src/server/services/token.service.ts';
import {buildApp} from '../src/server/app.ts';
import {ensureInitialized} from './_test-helpers.ts';
import {closeCache} from '../src/server/auth/cache.ts';
assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/feronavi_test_[a-f0-9]{32}$/u);
let app:Awaited<ReturnType<typeof buildApp>>|undefined,passed=0;
const check=(name:string,ok:unknown)=>{assert.ok(ok,name);passed++;console.log(`PASS ${name}`);};
try{
 await ensureInitialized();
 const [m]=await db.insert(member).values({username:`rag-protocol-${randomUUID().slice(0,8)}`,name:'RAG协议验收',passwordHash:'no-login',status:'ACTIVE'}).returning();
 const [r]=await db.select().from(role).where(eq(role.key,'ADMIN'));await db.insert(roleAssignment).values({memberId:m!.id,roleId:r!.id,scopeType:'ORG'});
 const actor=(await loadActor(m!.id))!;
 const a=await createProject(actor,{key:'RAGHTTPA',name:'协议甲'}),b=await createProject(actor,{key:'RAGHTTPB',name:'协议乙'});
 for(const project of [a,b]){const page=await createPage(actor,project.id,{title:'合成结账规则',content:'# 结账\n银桥月结账单每月第三个工作日完成。'});await reindexPage(actor,page.id,'FULL',{skipEmbedding:true});}
 app=await buildApp({logger:false});await app.ready();
 check('匿名读取拒绝',(await app.inject('/api/v1/rag/projects')).statusCode===401);
 const token=await createToken(actor,{name:'临时RAG协议测试',tier:'READ_ONLY',projectWhitelist:[a.id],allowedIpCidrs:['127.0.0.1/32']});const headers={authorization:`Bearer ${token.token}`};
 const projects=(await app.inject({url:'/api/v1/rag/projects',headers})).json();check('真实Bearer项目白名单收窄',projects.items.length===1&&projects.items[0].id===a.id);
 const search=await app.inject({method:'POST',url:'/api/v1/rag/search',headers,payload:{q:'银桥月结'}});const found=search.json();check('Bearer POST无CSRF真实检索',search.statusCode===200&&found.hits.length>0&&found.hits.every((h:{projectId:string})=>h.projectId===a.id));
 check('显式越白名单项目拒绝',(await app.inject({method:'POST',url:'/api/v1/rag/chat',headers,payload:{question:'银桥月结',projectIds:[b.id]}})).statusCode===403);
 const asked=await app.inject({method:'POST',url:'/api/v1/rag/chat',headers,payload:{question:'银桥月结'}});check('无对话模型时明确关闭生成，独立检索仍保留来源',asked.statusCode===200&&!asked.json().ok&&asked.json().citations.length===0&&/未配置对话模型/.test(asked.json().note));
 const doc=(await app.inject('/api/v1/openapi.json')).json();
 const resolve=(node:unknown):void=>{if(!node||typeof node!=='object')return;for(const [key,value]of Object.entries(node)){if(key==='$ref'){assert.equal(typeof value,'string');assert.ok(String(value).startsWith('#/components/schemas/'));assert.ok(doc.components.schemas[String(value).split('/').at(-1)!]);}else resolve(value);}};resolve(doc);
 check('OpenAPI3.1所有schema引用可解析',doc.openapi==='3.1.0'&&['/api/v1/rag/projects','/api/v1/rag/search','/api/v1/rag/chat','/api/v1/rag/conversations','/api/v1/rag/conversations/{conversationId}'].every(path=>Object.hasOwn(doc.paths,path)));
 const session=await createSession({memberId:m!.id,remember:false,userAgent:'RAG QA',ip:'127.0.0.1'});const cookie=`feronavi_session=${session.token}`;
 check('session POST缺CSRF拒绝',(await app.inject({method:'POST',url:'/api/v1/rag/chat',headers:{cookie},payload:{question:'银桥月结'}})).statusCode===403);
 const csrf=await app.inject({url:'/api/v1/auth/csrf',headers:{cookie}});const extra=csrf.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
 const sessionHeaders={cookie:`${cookie}; ${extra}`,'x-csrf-token':csrf.json().csrfToken};
 const sessionResult=await app.inject({method:'POST',url:'/api/v1/rag/search',headers:sessionHeaders,payload:{q:'银桥月结'}});check('session+CSRF跨项目实际聚合',sessionResult.statusCode===200&&new Set(sessionResult.json().hits.map((h:{projectId:string})=>h.projectId)).size===2);
 check('无效Bearer不能回退合法session',(await app.inject({url:'/api/v1/rag/projects',headers:{cookie,authorization:'Bearer invalid'}})).statusCode===401);
 for(const payload of [{question:'  '},{question:'x',projectIds:[]},{question:'x',history:[{role:'system',content:'x'}]},{question:'x',unexpected:true}])check('无效输入400',(await app.inject({method:'POST',url:'/api/v1/rag/chat',headers,payload})).statusCode===400);
 let seq=0;const mcp=async(method:string,params:unknown)=>{const res=await app!.inject({method:'POST',url:'/api/v1/mcp',headers:{...headers,accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:++seq,method,params}});assert.equal(res.statusCode,200);return res.json();};
 const list=await mcp('tools/list',{});check('MCP可发现三个新工具和具体结果契约',['rag.projects','rag.search','rag.chat'].every(name=>list.result.tools.some((t:{name:string,outputSchema:unknown})=>t.name===name&&t.outputSchema)));
 const called=await mcp('tools/call',{name:'rag.search',arguments:{q:'银桥月结'}});const data=JSON.parse(called.result.content[0].text);check('真实MCP复用授权跨项目服务',!called.result.isError&&data.scope.projectCount===1&&data.hits.every((h:{projectId:string})=>h.projectId===a.id));
 await revokeToken(actor,token.row.id);check('撤销Bearer立即失效',(await app.inject({url:'/api/v1/rag/projects',headers})).statusCode===401);
 console.log(`RAG协议验收：${passed}项通过`);
}finally{await app?.close();await closeCache();await sql.end();}
