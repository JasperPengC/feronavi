/** 能力目录只维护工具清单；单轮模型预算由assistant-model-tools控制。 */
import { assistantCapabilities } from "./assistant-capabilities.ts";
import {
  ASSISTANT_CLOSURE_POLICIES,
  ASSISTANT_CLOSURE_READ_TOOLS,
} from "./assistant-closure.ts";
import {
  ASSISTANT_WORKFLOW_CONTRACTS,
  ASSISTANT_WORKFLOW_READ_TOOLS,
} from "./assistant-workflow-contracts.ts";
export const ASSISTANT_READ_TOOLS = new Set([
  ...ASSISTANT_CLOSURE_READ_TOOLS,
  "project.get",
  "project.context",
  "project.members",
  "workitem.list",
  "workitem.get",
  "workitem.comments",
  "workitem.children",
  "plan.listMilestones",
  "plan.getMilestone",
  "plan.listIterations",
  "plan.listReleases",
  "plan.getIteration",
  "plan.getRelease",
  "plan.listModules",
  "plan.getModule",
  "meta.workflow",
  "knowledge.search",
  "page.get",
  "page.list",
  "page.revisions",
]);
export const ASSISTANT_WRITE_TOOLS = new Set([
  ...Object.keys(ASSISTANT_CLOSURE_POLICIES),
  "workitem.create",
  "workitem.update",
  "workitem.transition",
  "workitem.assign",
  "workitem.comment",
  "comment.update",
  "page.create",
  "page.update",
  "plan.createMilestone",
  "plan.updateMilestone",
  "plan.createIteration",
  "plan.updateIteration",
  "plan.createRelease",
  "plan.updateRelease",
  "plan.createModule",
  "plan.updateModule",
]);
export const ASSISTANT_BASE_TOOLS = new Set([
  ...ASSISTANT_READ_TOOLS,
  ...ASSISTANT_WRITE_TOOLS,
]);
for (const name of ASSISTANT_WORKFLOW_READ_TOOLS)
  ASSISTANT_READ_TOOLS.add(name);
ASSISTANT_READ_TOOLS.add("attachment.download");
for (const name of Object.keys(ASSISTANT_WORKFLOW_CONTRACTS))
  ASSISTANT_WRITE_TOOLS.add(name);
for (const directory of [ASSISTANT_READ_TOOLS, ASSISTANT_WRITE_TOOLS, ASSISTANT_BASE_TOOLS])
  for (const name of directory)
    if (/^(integration|webhook|im)\./u.test(name)) directory.delete(name);
export async function assistantRegistry() {
  return assistantCapabilities().filter(
    (t) =>
      ASSISTANT_READ_TOOLS.has(t.name) || ASSISTANT_WRITE_TOOLS.has(t.name),
  );
}
