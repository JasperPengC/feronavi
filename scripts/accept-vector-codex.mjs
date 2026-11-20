/** 本机真实向量验收的只读 Codex 阶段；不改全局配置、不归档原始事件。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {sql} from '../src/db/index.ts';
export async function runVectorCodex({folder,base,projectId,token,tokenId}) {
 const secret=path.join(folder,'bridge-secret.json'),bridge=path.join(folder,'bridge.mjs');
 await fs.writeFile(secret,JSON.stringify({base,token}),{mode:0o600});
 await fs.writeFile(bridge,`import {readFileSync} from 'node:fs';\nconst s=JSON.parse(readFileSync(${JSON.stringify(secret)},'utf8'));\nprocess.env.FERONAVI_URL=s.base;process.env.FERONAVI_TOKEN=s.token;\nawait import(${JSON.stringify(path.resolve('packages/feronavi-mcp/bin/feronavi-mcp.mjs'))});\n`,{mode:0o600});
 const names=['whoami','meta.tool','project.context','page.get','page.list','knowledge.search','knowledge.ask'];
 const config=await fs.readFile(path.join(process.env.CODEX_HOME??path.join(homedir(),'.codex'),'config.toml'),'utf8').catch(()=>'');
 const others=[...config.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gmu)].map(m=>m[1]).filter(n=>n!=='feronavi');
 const prompt=`用户授权在本机演示项目进行只读验收。项目ID=${projectId}。全部为合成业务资料；只使用给定MCP，不使用shell、文件、浏览器或其他工具，不修改任何业务或配置。先whoami确认身份，再实际knowledge.search搜索“客户反复点击下单如何避免生成多笔订单”，必须检查mode为vector及返回的文档。实际knowledge.ask分别询问“财务收到开票申请后几个工作日开具电子发票？”和“P1故障的响应与恢复时限分别是多少？”。逐项核实真实返回的answer、mode与服务端citations，基于实际结果报告，不要靠自己编造预期答案或宣称通过。至少读取一篇引用page.get核对原文。最后用中文给出两问答案、引用文档名、是否向量模式；任何失败如实报告。不得打印凭据。`;
 const args=['exec','--ephemeral','--json','--dangerously-bypass-approvals-and-sandbox','--disable','shell_tool','--skip-git-repo-check','-C',folder,...others.flatMap(n=>['-c',`mcp_servers.${n}.enabled=false`]),'-c',`mcp_servers.feronavi.command=${JSON.stringify(process.execPath)}`,'-c',`mcp_servers.feronavi.args=${JSON.stringify([bridge])}`,'-c',`mcp_servers.feronavi.enabled_tools=${JSON.stringify(names)}`,prompt];
 const [before]=await sql`select coalesce(sum(call_count),0)::int as n from mcp_client where token_id=${tokenId}`;
 let buffer='',final='',stderrChars=0,timedOut=false;const observed=[];
 const child=spawn('codex',args,{cwd:folder,env:{...process.env,FERONAVI_TOKEN:'',FERONAVI_URL:''},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{buffer+=String(chunk);if(buffer.length>2_000_000){child.kill('SIGTERM');return;}const lines=buffer.split(/\r?\n/u);buffer=lines.pop()??'';for(const line of lines){try{const e=JSON.parse(line);if(e.type==='item.completed'&&e.item?.type==='mcp_tool_call'){const i=e.item;observed.push({tool:i.tool,status:i.status});console.log(`Codex ${i.tool}: ${i.status}`);}if(e.type==='item.completed'&&e.item?.type==='agent_message')final=String(e.item.text??'').replaceAll(token,'[redacted]');}catch{/* 忽略非JSON进度行，不记录原始事件。 */}}});
 child.stderr.on('data',chunk=>{stderrChars+=chunk.length;});
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},360_000);
 let exitCode;
 try {exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',c=>resolve(c??1));});}
 finally {clearTimeout(timer);await fs.rm(secret,{force:true});}
 const [after]=await sql`select coalesce(sum(call_count),0)::int as n from mcp_client where token_id=${tokenId}`;
 const result={exitCode,timedOut,mcpCalls:after.n-before.n,observed,final,stderrChars,finishedAt:new Date().toISOString()};
 await fs.writeFile(path.join(folder,'codex-result.json'),JSON.stringify(result,null,2),{mode:0o600});return result;
}
