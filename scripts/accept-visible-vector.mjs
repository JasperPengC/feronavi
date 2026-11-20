/** 显式授权的本机真实向量验收；保留演示项目的新文档，不清除业务数据。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sql} from '../src/db/index.ts';
import {loadActor} from '../src/server/auth/actor-loader.ts';
import {createToken,revokeToken} from '../src/server/services/token.service.ts';
import {createPage,getPage,updatePage} from '../src/server/services/wiki.service.ts';
import {reindexPage,listPageChunks,searchKnowledge} from '../src/server/services/knowledge.service.ts';
import {closeCache} from '../src/server/auth/cache.ts';
import {runVectorCodex} from './accept-vector-codex.mjs';
const base=process.env.VISIBLE_ACCEPTANCE_BASE;
assert.equal(base,'http://127.0.0.1:51476');assert.equal(process.env.VISIBLE_ACCEPTANCE_CONFIRM,'CREATE_DEMO_ONLY');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/feronavi_test_d367a4bb86c44c80b2ecf895f46241d6');
const projectId='81a27ffc-80eb-48d5-bc71-d6bc0471ea9d';
const folder=path.resolve('.cache/vector-acceptance-20261115');await fs.mkdir(folder,{recursive:true,mode:0o700});
const file=path.join(folder,'state.json');
const state=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>({projectId,resources:{},checks:[],calls:[],startedAt:new Date().toISOString()}));
const save=()=>fs.writeFile(file,JSON.stringify(state,null,2),{mode:0o600});
const check=(name,ok,details)=>{const row={name,passed:Boolean(ok),...(details===undefined?{}:{details})};const at=state.checks.findIndex(c=>c.name===name);if(at<0)state.checks.push(row);else state.checks[at]=row;console.log(`${ok?'PASS':'FAIL'} ${name}`);assert.ok(ok,name);};
let actor,token;let seq=0;
async function mcp(name,args){const started=Date.now();const r=await fetch(`${base}/api/v1/mcp`,{method:'POST',headers:{authorization:`Bearer ${token.token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(120_000)});assert.equal(r.status,200);const body=await r.json();const result=body.result;const data=result?.content?.[0]?.text?JSON.parse(result.content[0].text):body.error;state.calls.push({name,ms:Date.now()-started,failed:Boolean(body.error||result?.isError)});await save();assert.ok(!body.error&&!result?.isError,JSON.stringify(data));return data;}
async function ensure(key,title,content,visibility='PROJECT'){if(state.resources[key])return state.resources[key];const page=await createPage(actor,projectId,{title,content,visibility});state.resources[key]={id:page.id,title};await save();return state.resources[key];}
try{
 if(state.error){(state.attemptErrors??=[]).push(state.error);delete state.error;}
 const [owner]=await sql`select id from member where username='demo'`;actor=await loadActor(owner.id);assert.ok(actor);
 const [member]=await sql`select id from member where username='demo-portal-po'`;const limited=await loadActor(member.id);assert.ok(limited);
 token=await createToken(actor,{name:'真实向量验收（临时只读）',tier:'READ_ONLY',projectWhitelist:[projectId],allowedIpCidrs:['127.0.0.1/32'],expiresAt:new Date(Date.now()+3600_000).toISOString()});
 state.tokenId=token.row.id;await save();
 const invoice=await ensure('invoice','10A｜电子发票规则（合成演示）','# 电子发票\n本页为合成业务验收资料。财务收到开票申请后，5个工作日内开具电子发票；抬头或税号错误退回申请人补正。\n\n# 退款后红冲\n全额退款完成后，2个工作日内发起发票红冲；部分退款由财务人工复核。');
 const duplicate=await ensure('duplicate','10B｜重复下单与幂等规则（合成演示）','# 重复下单\n本页为合成业务验收资料。客户反复点击提交时，同一requestId在24小时内必须返回原订单；不得新增第二笔订单。前端按钮禁用只是体验措施，服务端以requestId唯一约束保证幂等。\n\n# 超时重试\n弱网超时后使用同一requestId重试，读取已提交的订单结果；不能生成新的支付请求。');
 const sla=await ensure('sla','10C｜故障服务时限（合成演示）','# P1故障\n本页为合成业务验收资料。P1故障应在15分钟内响应，并在2小时内恢复服务；每30分钟更新一次处理进展。\n\n# P2故障\nP2故障应在2小时内响应，并在1个工作日内提供处理方案。');
 const restricted=await ensure('restricted','10D｜受限资料隔离样本（合成演示）','# 内部渠道折扣\n合成隔离样本QA-VECTOR-ACL：内部渠道折扣上限为17%，仅限获得本页权限的成员查阅。','RESTRICTED');
 const pages=await sql`select id,title from page where project_id=${projectId} and deleted_at is null order by created_at,id`;
 state.indexes=[];
 for(const page of pages){const result=await reindexPage(actor,page.id,'INCREMENTAL');state.indexes.push({pageId:page.id,title:page.title,...result});await save();check(`向量索引：${page.title}`,result.failed===0&&result.embedded===result.total&&result.embedReason===null,{total:result.total,embedded:result.embedded,reused:result.reused});}
 const repeated=await reindexPage(actor,invoice.id,'INCREMENTAL');
 check('重复索引复用内容和向量',repeated.inserted===0&&repeated.reused===2&&repeated.embedded===2);
 for(const page of pages){const c=await listPageChunks(actor,page.id);check(`当前切片可见：${page.title}`,c.chunks.length>0&&c.chunks.every(x=>x.hasVector));}
 const searches=[['财务开票要等多久',invoice.id],['客户反复点击下单按钮，怎样避免多笔订单',duplicate.id],['最高优先级故障多久响应和恢复',sla.id]];
 state.searches=[];
 for(const [q,pageId] of searches){const r=await mcp('knowledge.search',{projectId,q,limit:3});state.searches.push({q,...r});check(`语义检索命中：${q}`,r.mode==='vector'&&r.hits.some(h=>h.pageId===pageId));await save();}
 state.answers=[];
 for(const [question,expected] of [['财务收到开票申请后几个工作日开具电子发票？',/5\s*个?\s*工作日|五个工作日/u],['P1故障的响应与恢复时限分别是多少？',/15\s*分钟|十五分钟/u],['退款审核通过后几个工作日内发起？',/3\s*个?\s*工作日|三个工作日/u]]){const r=await mcp('knowledge.ask',{projectId,question,limit:3});state.answers.push({question,...r});check(`真实问答：${question}`,r.ok&&r.mode==='vector'&&Boolean(r.answer)&&expected.test(r.answer)&&r.citations.length>0);if(question.startsWith('P1'))check('故障问答包含2小时恢复时限',/2\s*小时|两小时/u.test(r.answer??''));await save();}
 const adminResult=await searchKnowledge(actor,projectId,'QA-VECTOR-ACL 内部渠道折扣上限',3);
 check('管理员能够检索受限样本',adminResult.mode==='vector'&&adminResult.hits.some(h=>h.pageId===restricted.id));
 const limitedResult=await searchKnowledge(limited,projectId,'QA-VECTOR-ACL 内部渠道折扣上限',20);
 check('项目成员向量检索不泄露受限文档',limitedResult.mode==='vector'&&limitedResult.hits.every(h=>h.pageId!==restricted.id&&!h.snippet.includes('QA-VECTOR-ACL')));
 const outside=await mcp('knowledge.ask',{projectId,question:'资料未录入的2028年第四季度营业收入精确金额是多少？请不要猜测。',limit:3});state.unknownAnswer=outside;
 check('资料不足的真实问答明确不确定',outside.ok&&outside.answer&&/没有|未提供|未包含|无法|不知道|不足|未录入/u.test(outside.answer));
 const concurrent=await Promise.all(Array.from({length:3},()=>mcp('knowledge.search',{projectId,q:'重复下单怎么保证订单唯一',limit:3})));
 check('3路并发真实向量检索稳定命中',concurrent.every(r=>r.mode==='vector'&&r.hits.some(h=>h.pageId===duplicate.id)));
 const dims=await sql`select distinct vector_dims(e.vector)::int as dimensions from chunk_embedding e join page_chunk c on c.id=e.chunk_id join page p on p.id=c.page_id where p.project_id=${projectId}`;
 check('数据库向量维度独立核对1024',dims.length===1&&dims[0].dimensions===1024);
 if(!state.agent){state.agent=await runVectorCodex({folder,base,projectId,token:token.token,tokenId:token.row.id});await save();}
 check('真实Codex通过MCP完成向量检索与问答',state.agent.exitCode===0&&!state.agent.timedOut&&state.agent.mcpCalls>=5&&state.agent.observed.some(c=>c.tool==='knowledge.search')&&state.agent.observed.filter(c=>c.tool==='knowledge.ask').length>=2);
 const report=await ensure('report','11｜真实向量检索与问答验收','# 真实向量检索与问答验收\n验收正在进行，所有业务资料为合成演示。');
 const current=await getPage(actor,report.id);
 const content=`# 真实向量检索与问答验收\n\n全部业务规则为合成演示；向量服务、数据库索引、MCP和Codex调用均为真实执行。\n\n## 结果\n- 硅基流动 BAAI/bge-m3 真实返回1024维有效向量，余额恢复后不再返回402。\n- ${pages.length}篇业务文档完成向量索引，重复索引复用内容与向量，多页连续索引后仍可检索。\n- 自然语言改写检索3项命中，3路并发检索通过；管理员/项目成员受限文档隔离通过。\n- 真实问答：开票5个工作日；P1响应15分钟、恢复2小时；退款审核通过后3个工作日发起；都有服务端引用。\n- 资料未录入的营业收入问题明确不确定。\n- 真实Codex退出${state.agent.exitCode}，本轮MCP调用${state.agent.mcpCalls}次。\n\n## 发现并修复\n每页使用已激活的最近成功索引代，防止其他页面索引隐藏本页；增量重建完整复用未变切片和有效向量；暂存代明确标记激活；恢复重建统一激活。\n\n## 断言\n${state.checks.map(c=>`- ${c.passed?'通过':'失败'}：${c.name}`).join('\n')}\n\n## Codex实际答复\n${state.agent.final}\n\n## 范围\n邮件、IM、Webhook按用户安排稍后测试。临时只读令牌在结束时撤销，不保留明文。\n`;
 await updatePage(actor,report.id,{content,expectedRevisionId:current.currentRevisionId,changeSummary:'真实硅基向量、讯飞问答和Codex MCP验收结果'});
 const indexedReport=await reindexPage(actor,report.id,'FULL');check('验收报告也已生成有效向量',indexedReport.failed===0&&indexedReport.embedded===indexedReport.total);
 state.report=report;state.finishedAt=new Date().toISOString();await save();console.log(`完成：${base}/projects/${projectId}/wiki?page=${report.id}`);
}catch(e){state.error={name:e.name,message:e.message.slice(0,1500),at:new Date().toISOString()};await save();console.error(state.error);process.exitCode=1;}
finally{if(token){await revokeToken(actor,token.row.id);state.tokenRevokedAt=new Date().toISOString();await save();}await fs.rm(path.join(folder,'bridge-secret.json'),{force:true});await closeCache();await sql.end();}
