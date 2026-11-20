/** 助手覆盖库存：验证入口/复读契约实际存在，逐流程显示未开放步骤。 */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
// 只导入元数据；不连接或操作实例数据库。
process.env.DATABASE_URL ??= "postgres://inventory:unused@127.0.0.1:1/inventory";
await import("../src/server/application/capabilities/tools.ts");
const { assistantRegistry, ASSISTANT_READ_TOOLS, ASSISTANT_WRITE_TOOLS,ASSISTANT_BASE_TOOLS } = await import("../src/server/services/assistant-tools.ts");
const {AssistantModelTools}=await import("../src/server/services/assistant-model-tools.ts");
const { ASSISTANT_CLOSURE_POLICIES } = await import("../src/server/services/assistant-closure.ts");
const { BUSINESS_WORKFLOWS } = await import("../src/server/application/capabilities/intelligence-tools.ts");
const { sql } = await import("../src/db/index.ts");
try {
  const tools = await assistantRegistry();
  const names = new Set(tools.map(tool => tool.name));
  for (const name of [...ASSISTANT_READ_TOOLS, ...ASSISTANT_WRITE_TOOLS]) assert(names.has(name), `Missing assistant tool: ${name}`);
  for (const [name, policy] of Object.entries(ASSISTANT_CLOSURE_POLICIES)) {
    assert(ASSISTANT_WRITE_TOOLS.has(name), `Closure write not available: ${name}`);
    for (const read of policy.reads({}, "inventory", [])) assert(ASSISTANT_READ_TOOLS.has(read.toolName), `Missing reread for ${name}: ${read.toolName}`);
  }
  const model=new AssistantModelTools(tools,ASSISTANT_BASE_TOOLS,true);
  const activeToolCounts={initial:model.definitions().length};
  for(const flow of BUSINESS_WORKFLOWS){model.load(flow.id);activeToolCounts[flow.id]=model.definitions().length;assert(activeToolCounts[flow.id]<=128,`模型单轮工具超限 ${flow.id}`);}
  const workflows = BUSINESS_WORKFLOWS.map(flow => ({...flow, missingTools:[...new Set(flow.steps.filter(name=>!names.has(name)))]}));
  for (const flow of workflows) assert.equal(flow.missingTools.length, 0, `助手流程 ${flow.id} 缺少工具: ${flow.missingTools.join(", ")}`);
  const inventory = {observedAt:new Date().toISOString(),activeToolCounts,readTools:[...ASSISTANT_READ_TOOLS].sort(),writeTools:[...ASSISTANT_WRITE_TOOLS].sort(),directWorkflows:workflows.filter(flow=>!flow.missingTools.length).map(flow=>flow.id),workflows};
  const outputIndex = process.argv.indexOf("--out");
  if (outputIndex >= 0) await fs.writeFile(process.argv[outputIndex+1], JSON.stringify(inventory,null,2)+"\n");
  console.log(JSON.stringify({reads:ASSISTANT_READ_TOOLS.size,writes:ASSISTANT_WRITE_TOOLS.size,directWorkflows:inventory.directWorkflows,workflowCount:workflows.length}));
} finally { await sql.end({timeout:1}); }
