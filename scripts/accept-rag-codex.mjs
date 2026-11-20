/** 本机真实向量验收的只读 Codex 阶段；不改全局配置、不归档原始事件。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {sql} from '../src/db/index.ts';
export async function runRagCodex({folder,base,token,tokenId}) {
 const secret=path.join(folder,'bridge-secret.json'),bridge=path.join(folder,'bridge.mjs');
 await fs.writeFile(secret,JSON.stringify({base,token}),{mode:0o600});
 await fs.writeFile(bridge,`import {readFileSync} from 'node:fs';\nconst s=JSON.parse(readFileSync(${JSON.stringify(secret)},'utf8'));\nprocess.env.FERONAVI_URL=s.base;process.env.FERONAVI_TOKEN=s.token;\nawait import(${JSON.stringify(path.resolve('packages/feronavi-mcp/bin/feronavi-mcp.mjs'))});\n`,{mode:0o600});
 const names=['whoami','rag.projects','rag.search','rag.chat','page.get'];
 const config=await fs.readFile(path.join(process.env.CODEX_HOME??path.join(homedir(),'.codex'),'config.toml'),'utf8').catch(()=>'');
 const others=[...config.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gmu)].map(m=>m[1]).filter(n=>n!=='feronavi');
 const prompt=`用户授权本机RAG独立工作区只读验收，所有资料均是合成演示。仅使用给定MCP，不使用shell/文件/浏览器，不修改业务和配置，不打印凭据。先whoami确认身份，再rag.projects确认可搜索项目。实际rag.search搜索“客户门户和伙伴平台的月结账单截止日”，检查返回mode=vector及两个不同项目的来源。然后rag.chat提问“比较客户门户和伙伴平台月结账单的截止日，分别是多少？”，limit=6。再rag.chat追问“后者遇法定节假日怎么处理？”，history包含上一条用户问题，limit=6。检查两次真实answer、mode与citations，不能靠预期编造。至少page.get核对一篇实际引用。最终中文报告比较和追问的实际答案、引用所属项目、向量模式及失败（如果有）。`;

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
