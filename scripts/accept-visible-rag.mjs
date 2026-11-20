/** 用户授权的本机RAG验收：合成资料、真实供应商与协议；保留结果可见。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sql} from '../src/db/index.ts';
import {loadActor} from '../src/server/auth/actor-loader.ts';
import {createToken,revokeToken} from '../src/server/services/token.service.ts';
import {createPage,getPage,updatePage} from '../src/server/services/wiki.service.ts';
import {createProject} from '../src/server/services/project.service.ts';
import {reindexPage} from '../src/server/services/knowledge.service.ts';
import {listRagProjects} from '../src/server/services/rag.service.ts';
import {closeCache} from '../src/server/auth/cache.ts';
import {runRagCodex} from './accept-rag-codex.mjs';
const base=process.env.VISIBLE_ACCEPTANCE_BASE,projectId='81a27ffc-80eb-48d5-bc71-d6bc0471ea9d';
assert.equal(base,'http://127.0.0.1:51476');assert.equal(process.env.VISIBLE_ACCEPTANCE_CONFIRM,'CREATE_DEMO_ONLY');assert.equal(new URL(process.env.DATABASE_URL).pathname,'/feronavi_test_d367a4bb86c44c80b2ecf895f46241d6');
const folder=path.resolve('.cache/rag-workspace-20261115'),file=path.join(folder,'state.json');await fs.mkdir(folder,{recursive:true,mode:0o700});
const state=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>({startedAt:new Date().toISOString(),projectId,resources:{},checks:[],calls:[]}));
const save=()=>fs.writeFile(file,JSON.stringify(state,null,2),{mode:0o600});
const check=(name,passed,details)=>{const row={name,passed:Boolean(passed),...(details?{details}:{})};const n=state.checks.findIndex(c=>c.name===name);if(n<0)state.checks.push(row);else state.checks[n]=row;console.log(`${passed?'PASS':'FAIL'} ${name}`);assert.ok(passed,name);};
let actor,token,restrictedToken,seq=0;
async function http(route,body,credential=token.token){const start=Date.now();const r=await fetch(`${base}${route}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${credential}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const data=await r.json();state.calls.push({route,ms:Date.now()-start,status:r.status});await save();return {status:r.status,data};}
async function rpc(name,args){const r=await fetch(`${base}/api/v1/mcp`,{method:'POST',headers:{authorization:`Bearer ${token.token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(120000)});assert.equal(r.status,200);const data=await r.json();assert.ok(!data.error&&!data.result?.isError);return JSON.parse(data.result.content[0].text);}
async function ensurePage(key,pid,title,content){if(state.resources[key])return state.resources[key];const p=await createPage(actor,pid,{title,content});state.resources[key]={id:p.id,title,projectId:pid};await save();return state.resources[key];}
try{
 if(state.error){(state.attemptErrors??=[]).push(state.error);delete state.error;}
 const [m]=await sql`select id from member where username='demo'`;actor=await loadActor(m.id);assert.ok(actor);
 const snapshot=async()=>{const x={};for(const table of ['project','work_item','page','idea','milestone','iteration','release','module']){const col=table==='project'?'id':'project_id';x[table]=(await sql.unsafe(`select md5(coalesce(string_agg(row_to_json(t)::text, '' order by id),'')) as hash,count(*)::int as count from ${table} t where ${col}=(select id from project where key='FINOK')`))[0];}return x;};
 state.finokBefore??=await snapshot();
 if(!state.partner){const existing=await sql`select id,key from project where key='RAG2611'`;state.partner=existing[0]??await createProject(actor,{key:'RAG2611',name:'合成演示｜伙伴平台交付',description:'用于独立知识助手跨项目比较验收，全部规则均为合成。'});await save();}
 const a=await ensurePage('portal',projectId,'12A｜客户门户月结账单（合成演示）','# 客户门户月结账单\n本页全部规则为合成业务验收资料。客户门户月结账单的截止日为每月第3个工作日，节假日已按工作日历排除。\n\n# 责任人\n由客户门户财务组核对金额并确认账单。');
 const b=await ensurePage('partner',state.partner.id,'12B｜伙伴平台月结账单（合成演示）','# 伙伴平台月结账单\n本页全部规则为合成业务验收资料。伙伴平台月结账单的截止日为每月第6个工作日；如截止日遇法定节假日，额外顺延1个工作日。\n\n# 责任人\n由伙伴平台结算组核对金额并确认账单。');
 state.indexes=[];for(const p of [a,b]){const result=await reindexPage(actor,p.id,'INCREMENTAL');state.indexes.push({id:p.id,...result});check('合成文档真实向量索引：'+p.title,result.failed===0&&result.embedded===result.total);}
 token=await createToken(actor,{name:'独立RAG验收（临时只读）',tier:'READ_ONLY',projectWhitelist:[projectId,state.partner.id],allowedIpCidrs:['127.0.0.1/32'],expiresAt:new Date(Date.now()+3600000).toISOString()});state.tokenId=token.row.id;await save();
 const projects=await http('/api/v1/rag/projects');check('REST项目范围遵守令牌白名单',projects.status===200&&projects.data.items.length===2);
 const search=await http('/api/v1/rag/search',{q:'客户门户和伙伴平台月结账单截止日',limit:6});state.search=search.data;check('真实跨项目向量检索覆盖两份原文',search.status===200&&search.data.mode==='vector'&&[a.id,b.id].every(id=>search.data.hits.some(h=>h.pageId===id)));
 const single=await http('/api/v1/rag/search',{q:'月结账单截止日',projectIds:[state.partner.id],limit:6});check('指定项目不混入其他项目',single.status===200&&single.data.hits.length>0&&single.data.hits.every(h=>h.projectId===state.partner.id));
 const question='比较客户门户和伙伴平台月结账单的截止日，分别是多少？';
 const cross=await http('/api/v1/rag/chat',{question,limit:6});state.cross=cross.data;check('真实问答比较3和6工作日并带两项目引用',cross.status===200&&cross.data.ok&&cross.data.mode==='vector'&&/3|三/u.test(cross.data.answer??'')&&/6|六/u.test(cross.data.answer??'')&&[projectId,state.partner.id].every(id=>cross.data.citations.some(c=>c.projectId===id)));
 const follow=await http('/api/v1/rag/chat',{question:'后者遇法定节假日怎么处理？',history:[{role:'user',content:question},{role:'assistant',content:cross.data.answer}],limit:6});state.follow=follow.data;check('真实多轮追问理解后者并回答顺延1工作日',follow.status===200&&follow.data.ok&&/顺延/u.test(follow.data.answer??'')&&/1|一/u.test(follow.data.answer??'')&&follow.data.citations.some(c=>c.pageId===b.id));
 const doc=await fetch(`${base}/api/v1/openapi.json`).then(r=>r.json());check('公开OpenAPI3.1可发现三项协议',doc.openapi==='3.1.0'&&Object.keys(doc.paths).length===3);
 const mp=await rpc('rag.projects',{});const ms=await rpc('rag.search',{q:'月结账单截止日',limit:6});check('真实HTTP MCP与REST同源范围和跨项目检索',mp.items.length===2&&ms.mode==='vector'&&[projectId,state.partner.id].every(id=>ms.hits.some(h=>h.projectId===id)));
 restrictedToken=await createToken(actor,{name:'独立RAG范围隔离（临时只读）',tier:'READ_ONLY',projectWhitelist:[projectId],allowedIpCidrs:['127.0.0.1/32'],expiresAt:new Date(Date.now()+3600000).toISOString()});state.restrictedTokenId=restrictedToken.row.id;
 const narrow=await http('/api/v1/rag/search',{q:'伙伴平台月结账单截止日',limit:6},restrictedToken.token);check('默认跨项目不能越过Bearer白名单',narrow.status===200&&narrow.data.scope.projectCount===1&&narrow.data.hits.every(h=>h.projectId===projectId));
 const denied=await http('/api/v1/rag/chat',{question:'月结账单',projectIds:[state.partner.id]},restrictedToken.token);check('显式指定白名单外项目拒绝',denied.status===403);
 const [member]=await sql`select id from member where username='demo-portal-po'`;const limited=await loadActor(member.id);const limitedProjects=await listRagProjects(limited);check('普通项目成员看不到陌生伙伴项目',!limitedProjects.some(p=>p.id===state.partner.id));
 if(!state.agent){state.agent=await runRagCodex({folder,base,projectId,token:token.token,tokenId:token.row.id});await save();}
 check('真实Codex使用新RAG工具完成跨项目和追问',state.agent.exitCode===0&&!state.agent.timedOut&&state.agent.mcpCalls>=6&&state.agent.observed.filter(c=>c.tool==='rag.chat').length>=2&&state.agent.observed.some(c=>c.tool==='page.get'));
 const report=await ensurePage('report',projectId,'13｜独立知识助手与跨项目验收','# 验收进行中\n所有业务资料为合成演示。');
 const current=await getPage(actor,report.id);await updatePage(actor,report.id,{expectedRevisionId:current.currentRevisionId,changeSummary:'独立知识助手真实联调验收',content:`# 独立知识助手验收\n\n所有业务规则为合成演示；模型、HTTP API和Codex调用均真实执行。\n\n## 入口与范围\n知识助手独立地址：${base}/assistant 。左上导航固定入口，默认全部有权项目，也可选择指定项目。切换资料范围开启新对话；当前会话不跨设备保存。文档页保留资料及索引维护。\n\n## 真实跨项目比较\n${cross.data.answer}\n\n## 连续追问：后者遇法定节假日怎么处理\n${follow.data.answer}\n\n## 协议\nOpenAPI 3.1：${base}/api/v1/openapi.json 。MCP新增rag.projects、rag.search、rag.chat，均复用同一范围与权限服务。\n\n## 断言\n${state.checks.map(c=>`- ${c.passed?'通过':'失败'}：${c.name}`).join('\n')}\n\n## Codex实际答复\n${state.agent.final}\n\n## 边界\n邮件、IM、Webhook仍按用户要求暂缓。全部临时令牌在结束后撤销；本机试点不等同生产容量或长期稳定性认证。`});
 const indexed=await reindexPage(actor,report.id,'FULL');check('平台报告生成向量并可阅读',indexed.failed===0&&indexed.embedded===indexed.total);
 state.finokAfter=await snapshot();assert.deepEqual(state.finokAfter,state.finokBefore);check('原FINOK业务资料未变',true);state.report=report;state.finishedAt=new Date().toISOString();await save();console.log(`完成：${base}/assistant`);
}catch(e){state.error={name:e.name,message:e.message.slice(0,1200),at:new Date().toISOString()};await save();console.error(state.error);process.exitCode=1;}
finally{for(const t of [token,restrictedToken])if(t)await revokeToken(actor,t.row.id);state.tokensRevokedAt=new Date().toISOString();await fs.rm(path.join(folder,'bridge-secret.json'),{force:true});await save();await closeCache();await sql.end();}
